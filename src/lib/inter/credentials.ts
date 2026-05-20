/**
 * inter/credentials.ts — leitura das credenciais Inter (decrypt via RPC).
 *
 * Os segredos ficam encrypted em `inter_credentials` (pgcrypto). Só o
 * service role consegue decriptar, via RPC `decrypt_inter_credentials`
 * passando a `BANK_ENCRYPTION_KEY`. Usado pelo InterPaymentProvider e
 * pelo webhook receiver.
 */
import 'server-only';
// SERVICE_ROLE: decrypt_inter_credentials é SECURITY DEFINER + service_role only;
// a credencial nunca trafega pro client.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import type { InterEnvironment } from './client';

export interface InterCredentials {
  clientId: string;
  clientSecret: string;
  certPem: string;
  keyPem: string;
  webhookSecret: string;
  webhookSecretPath: string;
  contaCorrente: string | null;
  environment: InterEnvironment;
}

/** Lê e decripta a credencial Inter ativa. `null` se não houver. */
export async function loadInterCredentials(): Promise<InterCredentials | null> {
  const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('BANK_ENCRYPTION_KEY ausente no servidor');
  }

  // RPC nova ainda não está nos types gerados — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = getAdminClient() as any;
  const { data, error } = await admin.rpc('decrypt_inter_credentials', {
    p_encryption_key: encryptionKey,
  });

  if (error) {
    throw new Error(`Falha ao ler credenciais Inter: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.client_id) return null;

  return {
    clientId: row.client_id,
    clientSecret: row.client_secret,
    certPem: row.cert_pem,
    keyPem: row.key_pem,
    webhookSecret: row.webhook_secret,
    webhookSecretPath: row.webhook_secret_path,
    contaCorrente: row.conta_corrente ?? null,
    environment: (row.environment === 'sandbox' ? 'sandbox' : 'producao') as InterEnvironment,
  };
}
