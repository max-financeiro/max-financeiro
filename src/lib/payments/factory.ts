/**
 * Factory que retorna o PaymentProvider correto baseado em env.
 *
 *   PAYMENT_PROVIDER=mock   → MockPaymentProvider (dev/staging)
 *   PAYMENT_PROVIDER=inter  → InterPaymentProvider (Sprint 5+, ainda não impl)
 *   PAYMENT_PROVIDER=btg    → reservado pra futuro (BTG executando pagamento)
 *
 * Em produção: forçar inter (verificação de NODE_ENV). Em dev/staging:
 * mock por default mas pode override via env.
 */
import 'server-only';
import type { PaymentProvider } from './provider';
import { MockPaymentProvider } from './providers/mock';

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const env = process.env.PAYMENT_PROVIDER ?? 'mock';
  const isProd = process.env.NEXT_PUBLIC_APP_ENV === 'production';

  if (isProd && env === 'mock') {
    // Sanity check: prod NUNCA deve rodar mock. Se chegar aqui, é
    // misconfiguração — falha cedo em vez de causar transações fake.
    throw new Error(
      'PAYMENT_PROVIDER=mock em ambiente production é proibido. Configurar inter.',
    );
  }

  switch (env) {
    case 'mock':
      _provider = new MockPaymentProvider();
      break;
    case 'inter':
      throw new Error('InterPaymentProvider ainda não implementado (Sprint 5).');
    case 'btg':
      throw new Error('BTG provider reservado pra futuro.');
    default:
      throw new Error(`PAYMENT_PROVIDER inválido: ${env}`);
  }

  return _provider!;
}
