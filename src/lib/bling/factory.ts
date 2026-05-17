/**
 * Factory pra Bling Provider.
 *
 * Escolha do provider:
 *  - BLING_PROVIDER=mock (default em dev sem credencial) → MockBlingProvider
 *  - BLING_PROVIDER=real → RealBlingProvider (precisa OAuth conectado + BANK_ENCRYPTION_KEY)
 *
 * Sprint 7-A liga mock; quando o Bling app dedicado for criado e
 * credenciais conectadas, BLING_PROVIDER=real entra em prod.
 */
import 'server-only';
// SERVICE_ROLE: RealBlingProvider precisa de service_role pra ler tokens encrypted via RPC.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { MockBlingProvider } from './providers/mock';
import { RealBlingProvider } from './providers/real';
import type { BlingProvider } from './provider';

export function createBlingProvider(organizationId: string): BlingProvider {
  const mode = process.env.BLING_PROVIDER ?? 'mock';

  if (mode === 'real') {
    const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('BLING_PROVIDER=real exige BANK_ENCRYPTION_KEY no .env');
    }
    return new RealBlingProvider({
      organizationId,
      admin: getAdminClient(),
      encryptionKey,
    });
  }

  return new MockBlingProvider();
}
