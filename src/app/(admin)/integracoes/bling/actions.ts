'use server';

import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl } from '@/lib/bling/oauth';

const Schema = z.object({
  organization_id: z.string().uuid(),
  client_id: z.string().trim().min(8),
  client_secret: z.string().trim().min(8),
});

export type State = { ok: false; error: string } | { ok: true } | null;

export async function connectBlingAction(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !['master', 'financial_manager'].includes(profile.role)) {
    return { ok: false, error: 'Apenas Master/Gestor pode conectar integrações' };
  }

  const parsed = Schema.safeParse({
    organization_id: formData.get('organization_id'),
    client_id: formData.get('client_id'),
    client_secret: formData.get('client_secret'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const h = await headers();
  const origin =
    h.get('origin') ??
    `https://${h.get('x-forwarded-host') ?? h.get('host') ?? 'www.financeiromaxfem.com.br'}`;
  const redirectUri = `${origin}/api/bling/oauth/callback`;

  // State: organization_id + nonce. Gravamos cookie pra validar no callback.
  const nonce = randomBytes(16).toString('hex');
  const state = `${parsed.data.organization_id}.${nonce}`;

  const cookieStore = await cookies();
  cookieStore.set('bling_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,                                   // 10min
    path: '/',
  });
  cookieStore.set('bling_oauth_client_id', parsed.data.client_id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  cookieStore.set('bling_oauth_client_secret', parsed.data.client_secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const authorizeUrl = buildAuthorizeUrl({
    clientId: parsed.data.client_id,
    redirectUri,
    state,
    scope: undefined,                              // Bling app config define escopo
  });

  redirect(authorizeUrl);
}
