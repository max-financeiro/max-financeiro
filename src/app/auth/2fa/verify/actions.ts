'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

const VerifySchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
  next: z.string().startsWith('/').default('/'),
});

export type VerifyState =
  | { ok: false; error: string }
  | null;

export async function verifyChallenge(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = VerifySchema.safeParse({
    factorId: formData.get('factorId'),
    code: formData.get('code'),
    next: formData.get('next') || '/',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challengeError || !challenge) {
    return { ok: false, error: 'Não foi possível iniciar a verificação. Tente novamente.' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    await logAuditEvent(supabase, {
      action: 'mfa.verify_failed',
      entityType: 'auth.users',
      afterState: { factorId: parsed.data.factorId },
    });
    return { ok: false, error: 'Código inválido. O código muda a cada 30s — confira no app.' };
  }

  await logAuditEvent(supabase, {
    action: 'mfa.verified',
    entityType: 'auth.users',
    afterState: { factorId: parsed.data.factorId },
  });

  redirect(parsed.data.next);
}
