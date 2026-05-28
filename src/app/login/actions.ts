'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: check_rate_limit muta rate_limit_buckets antes do auth estabelecido.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { getMfaState } from '@/lib/auth/mfa';

const LoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha muito curta'),
  next: z.string().startsWith('/').optional().default('/'),
});

const LOGIN_LIMIT_PER_HOUR = 10;             // 10 tentativas/email/hora
const LOGIN_FAILED_BURST_LIMIT = 5;          // 5 falhas seguidas em 5min trava

/**
 * Hash leve do email pra audit log (LGPD: titular pode pedir esquecimento,
 * audit WORM não pode reter PII clara). SHA-256 truncado dá unicidade pra
 * detectar tentativas seguidas sem revelar o email no banco.
 */
async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type LoginState =
  | { ok: false; error: string }
  | { ok: true };

export async function loginAction(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || '/',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const emailNorm = parsed.data.email.toLowerCase();
  const emailHash = await hashEmail(emailNorm);

  // Rate limit por email — 10 tentativas/hora. Roda via service_role pra
  // mutar rate_limit_buckets antes do auth ser estabelecido.
  const admin = getAdminClient();
  const { data: rl } = await admin.rpc('check_rate_limit', {
    p_bucket_key: `login:${emailNorm}`,
    p_limit: LOGIN_LIMIT_PER_HOUR,
    p_window_seconds: 3600,
  });
  if (rl && (rl as { allowed?: boolean }).allowed === false) {
    return {
      ok: false,
      error: 'Muitas tentativas. Tente novamente em alguns minutos.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Burst lock: 5 falhas em 5min → bloqueia esse email por 5min adicionais
    await admin.rpc('check_rate_limit', {
      p_bucket_key: `login_failed:${emailNorm}`,
      p_limit: LOGIN_FAILED_BURST_LIMIT,
      p_window_seconds: 300,
    });

    // Audit sem PII clara — email_hash permite correlacionar sem reter
    // o email completo (LGPD: audit WORM não pode armazenar PII direto).
    await logAuditEvent(supabase, {
      action: 'login.failed',
      entityType: 'auth.users',
      afterState: { email_hash: emailHash },
    });
    return { ok: false, error: 'Email ou senha incorretos.' };
  }

  // Login OK — registra audit
  await logAuditEvent(supabase, {
    action: 'login.success',
    entityType: 'auth.users',
    entityId: data.user.id,
  });

  // Decidir para onde mandar conforme estado MFA
  const state = await getMfaState(supabase);
  const nextUrl = parsed.data.next;

  if (state.kind === 'needs_enrollment') {
    redirect(`/auth/2fa/enroll?next=${encodeURIComponent(nextUrl)}`);
  }
  if (state.kind === 'needs_verification') {
    redirect(`/auth/2fa/verify?next=${encodeURIComponent(nextUrl)}`);
  }
  redirect(nextUrl);
}
