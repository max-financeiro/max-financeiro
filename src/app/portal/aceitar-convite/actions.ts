'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const Schema = z.object({
  code: z
    .string()
    .regex(/^\d{8}$/, 'Código deve ter 8 dígitos numéricos'),
});

export type State = { ok: false; error: string } | { ok: true } | null;

export async function aceitarConviteAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const parsed = Schema.safeParse({ code: formData.get('code') });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Código inválido' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada. Faça login novamente.' };

  // Forense: IP/UA reais capturados dos headers do edge (não inet_client_addr).
  const h = await headers();
  const rawIp =
    h.get('cf-connecting-ip') ??
    h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const ip = rawIp && /^[0-9a-fA-F:.]+$/.test(rawIp) ? rawIp : null;
  const userAgent = h.get('user-agent') ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('accept_supplier_invitation', {
    p_code: parsed.data.code,
    p_ip_address: ip,
    p_user_agent: userAgent,
  });

  if (error) {
    // Mensagens da RPC já são amigáveis em PT-BR
    return { ok: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.supplier_id) {
    return { ok: false, error: 'Resposta inválida do servidor. Tente novamente.' };
  }

  redirect('/portal?welcome=1');
}
