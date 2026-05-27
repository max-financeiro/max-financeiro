/**
 * Banner que avisa quando o período visualizado está fechado contabilmente.
 * Server Component — recebe organization_id + date e consulta is_period_closed.
 *
 * Não bloqueia nada (o trigger no banco já cuida disso) — só comunica visualmente
 * pro usuário entender por que algumas ações vão falhar.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

interface Props {
  /** Filial. Pode ser null pra checar o grupo via parent_id. */
  organizationId: string | null;
  /** Data de competência ou transação que você quer verificar. */
  date: string;
}

export async function ClosedPeriodBanner({ organizationId, date }: Props) {
  if (!organizationId) return null;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('is_period_closed', {
    p_organization_id: organizationId,
    p_date: date,
  });
  if (error || !data) return null;

  const d = new Date(date);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex items-center gap-2">
      <span className="text-emerald-600">🔒</span>
      <div>
        <strong>Período {label} está fechado contabilmente.</strong>{' '}
        Alterações em AP/AR/conciliação deste mês estão bloqueadas. Reabra em{' '}
        <Link href="/governanca/fechamento" className="underline hover:text-emerald-700">
          /governanca/fechamento
        </Link>
        {' '}se necessário (apenas master).
      </div>
    </div>
  );
}
