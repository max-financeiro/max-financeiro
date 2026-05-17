'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: check_rate_limit muta rate_limit_buckets antes do auth ser estabelecido; precisa bypassar RLS antes do user existir.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';

const MAGIC_LINK_LIMIT_PER_HOUR = 5;

const Schema = z.object({
  email: z.string().email('Email inválido').max(255),
  next: z.string().startsWith('/').optional().default('/portal'),
});

export type State = { ok: false; error: string } | { ok: true } | null;

export async function sendPortalMagicLinkAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const parsed = Schema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') || '/portal',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Email inválido' };
  }

  const supabase = await createClient();

  // Rate limit Maxfem (5 magic links/h por email). Roda via service_role pra
  // poder mutar rate_limit_buckets sem RLS — a função SECURITY DEFINER já valida.
  const admin = getAdminClient();
  const { data: rl } = await admin.rpc('check_rate_limit', {
    p_bucket_key: `magic_link:${parsed.data.email.toLowerCase()}`,
    p_limit: MAGIC_LINK_LIMIT_PER_HOUR,
    p_window_seconds: 3600,
  });
  if (rl && (rl as { allowed?: boolean }).allowed === false) {
    return {
      ok: false,
      error: 'Limite de 5 envios/hora atingido. Tente novamente mais tarde.',
    };
  }

  // Constrói redirectTo absoluto baseado no host atual
  const h = await headers();
  const origin =
    h.get('origin') ??
    `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`;

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // shouldCreateUser=false: o auth.user é pré-criado quando admin gera o
      // convite (action inviteSupplierAction usa service_role + email_confirm).
      // Se o email não tem convite, signInWithOtp falha — comportamento correto.
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  });

  // Audit (mesmo se erro, pra detectar abuse)
  await logAuditEvent(supabase, {
    action: error ? 'portal.magic_link.failed' : 'portal.magic_link.sent',
    entityType: 'auth.users',
    afterState: { email: parsed.data.email, error: error?.message },
  });

  if (error) {
    // Mostra mensagem específica conforme o tipo de erro do Supabase
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('signup') && msg.includes('disabled')) {
      return {
        ok: false,
        error:
          'Email não cadastrado no portal. Peça pra Maxfem te enviar um convite.',
      };
    }
    if (msg.includes('rate') || msg.includes('over_email_send_rate')) {
      return {
        ok: false,
        error: 'Muitos pedidos seguidos. Espere 1 minuto e tente de novo.',
      };
    }
    // Diagnóstico bruto pra investigação (esconder em produção depois)
    return { ok: false, error: `Erro Supabase: ${error.message}` };
  }

  redirect(`/portal/login?sent=1&next=${encodeURIComponent(parsed.data.next)}`);
}
