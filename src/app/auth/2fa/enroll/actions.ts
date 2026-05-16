'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';

export type EnrollInitResult =
  | { ok: true; factorId: string; qrCodeDataUrl: string; secret: string }
  | { ok: false; error: string };

/**
 * Inicia enrollment: chama supabase.auth.mfa.enroll que retorna QR code + secret.
 * UI renderiza o QR pro usuário escanear no Google Authenticator/Authy.
 */
export async function startEnrollment(): Promise<EnrollInitResult> {
  const supabase = await createClient();

  const { data: existingFactors } = await supabase.auth.mfa.listFactors();
  // Limpa factors unverified antigos (se usuário abandonou enrollment no meio)
  for (const f of existingFactors?.totp ?? []) {
    if (f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Financeiro Maxfem · ${new Date().toISOString().split('T')[0]}`,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Falha ao iniciar enrollment 2FA' };
  }

  // Gera QR como data URL no servidor a partir do otpauth URI.
  // Evita inserir SVG cru no DOM (que dispararia dangerouslySetInnerHTML).
  const qrCodeDataUrl = await QRCode.toDataURL(data.totp.uri, {
    margin: 1,
    width: 256,
    color: { dark: '#1A1A1A', light: '#FFFFFF' },
  });

  return {
    ok: true,
    factorId: data.id,
    qrCodeDataUrl,
    secret: data.totp.secret,
  };
}

const VerifyEnrollSchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
  next: z.string().startsWith('/').default('/'),
});

export type VerifyEnrollState =
  | { ok: false; error: string }
  | null;

/**
 * Verifica o código TOTP que o usuário digitou após escanear o QR.
 * Se OK, o factor vira `verified` e a sessão sobe pra AAL2.
 */
export async function verifyEnrollment(
  _prev: VerifyEnrollState,
  formData: FormData,
): Promise<VerifyEnrollState> {
  const parsed = VerifyEnrollSchema.safeParse({
    factorId: formData.get('factorId'),
    code: formData.get('code'),
    next: formData.get('next') || '/',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createClient();

  // Challenge é necessário antes de verify (Supabase exige par challenge+verify)
  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: parsed.data.factorId,
  });
  if (challengeError || !challengeData) {
    return { ok: false, error: 'Falha ao gerar challenge. Tente novamente.' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challengeData.id,
    code: parsed.data.code,
  });

  if (verifyError) {
    return { ok: false, error: 'Código inválido. Confira o app autenticador e tente novamente.' };
  }

  // Audit
  await logAuditEvent(supabase, {
    action: 'mfa.enrolled',
    entityType: 'auth.users',
    afterState: { factorId: parsed.data.factorId, factorType: 'totp' },
  });

  redirect(parsed.data.next);
}
