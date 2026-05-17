'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

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

  // Constrói redirectTo absoluto baseado no host atual
  const h = await headers();
  const origin =
    h.get('origin') ??
    `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`;

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // shouldCreateUser=true permite criar conta caso ainda não exista —
      // o vínculo com business_partner só acontece em accept_supplier_invitation
      // após o usuário inserir o código de 8 dígitos. Sem código, o user fica
      // órfão (sem role, sem acesso ao portal — sai pela 'pending' page).
      shouldCreateUser: true,
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
    // Não vazar info — resposta genérica
    return { ok: false, error: 'Não foi possível enviar o link. Tente novamente em 1 minuto.' };
  }

  redirect(`/portal/login?sent=1&next=${encodeURIComponent(parsed.data.next)}`);
}
