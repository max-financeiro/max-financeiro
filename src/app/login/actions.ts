'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { getMfaState } from '@/lib/auth/mfa';

const LoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha muito curta'),
  next: z.string().startsWith('/').optional().default('/'),
});

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Audit de tentativa falha (sem expor detalhes ao client)
    await logAuditEvent(supabase, {
      action: 'login.failed',
      entityType: 'auth.users',
      afterState: { email: parsed.data.email },
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
