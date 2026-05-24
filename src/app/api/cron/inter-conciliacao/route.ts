/**
 * GET / POST /api/cron/inter-conciliacao
 *
 * Sprint 7-B — sincroniza extrato Inter de todas as filiais com conta
 * cadastrada, insere em bank_transactions (idempotente) e roda o
 * matching engine contra payments. Disparado pelo Vercel Cron.
 *
 * Janela: últimos 10 dias por default (cobre processamentos atrasados,
 * PIX agendados, fim de semana). Configurável via ?days=N.
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 */
// SERVICE_ROLE: cron sem sessão; precisa bypass RLS pra iterar filiais
// e inserir/atualizar bank_transactions.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { listInterAccounts, syncInterExtract } from '@/lib/conciliacao/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

const DEFAULT_DAYS_BACK = 10;
const MAX_DAYS_BACK = 90;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days') ?? '');
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(daysParam, MAX_DAYS_BACK)
      : DEFAULT_DAYS_BACK;

  const endDate = todayISO();
  const startDate = addDays(endDate, -days);

  try {
    const admin = getAdminClient();
    const accounts = await listInterAccounts(admin);
    if (accounts.length === 0) {
      return Response.json({
        ok: true,
        warning: 'Nenhuma conta Inter cadastrada nem matriz Maxfem encontrada',
        results: [],
      });
    }

    const results = [];
    for (const acc of accounts) {
      const r = await syncInterExtract(admin, {
        organizationId: acc.organizationId,
        bankAccountId: acc.bankAccountId,
        startDate,
        endDate,
      });
      results.push({ account: acc.label, ...r });
    }

    return Response.json({ ok: true, range: { startDate, endDate }, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[inter-conciliacao] cron erro:', message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

// Vercel Cron dispara via GET — aceita ambos.
export const GET = POST;
