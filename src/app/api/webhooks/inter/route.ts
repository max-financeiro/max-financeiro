/**
 * POST /api/webhooks/inter
 *
 * Sprint 18 — recebe eventos de extrato Inter realtime. O Inter envia
 * 1 POST por movimentação, segundos após a transação acontecer.
 *
 * Fluxo:
 *   1. Valida assinatura via header X-Inter-Token vs INTER_WEBHOOK_SECRET
 *   2. Insere webhook_event (raw payload) — UNIQUE (provider, event_id) dedupe
 *   3. Parser extrai BankTransaction
 *   4. Resolve organization pelo CNPJ recebedor/pagador (fallback: única org Inter ativa)
 *   5. Insere bank_transactions (idempotente)
 *   6. Roda matching: debit→payments, credit→accounts_receivable
 *   7. Atualiza webhook_event com status=processed + bank_tx_id
 *
 * Tudo é best-effort: nunca retorna 5xx pro Inter (eles re-tentam e ficamos
 * com N eventos duplicados). Sempre 200 com result no body — falhas viram
 * webhook_event status=failed pro audit.
 *
 * Setup no painel Inter (uma vez):
 *   URL: https://financeiromaxfem.com.br/api/webhooks/inter
 *   Token: valor de INTER_WEBHOOK_SECRET
 *   Eventos: extrato (transações)
 */
// SERVICE_ROLE: sem sessão; precisa bypass RLS pra escrever em
// webhook_events e bank_transactions.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { parseInterExtractEvent } from '@/lib/webhooks/inter';
import { findMatchForBankTransaction } from '@/lib/conciliacao/match';
import { findArMatchForBankTransaction } from '@/lib/conciliacao/match-ar';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Auth: token compartilhado no header
  const expected = process.env.INTER_WEBHOOK_SECRET;
  const provided = req.headers.get('x-inter-token') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected) {
    console.error('[webhook-inter] INTER_WEBHOOK_SECRET não configurado');
    return Response.json({ ok: false, error: 'webhook not configured' }, { status: 503 });
  }
  if (!provided || !timingSafeEqual(provided, expected)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Lê payload
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Inter pode mandar 1 ou batch — normaliza pra array
  const events = Array.isArray(payload) ? payload : [payload];
  const admin = getAdminClient();
  const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const results: Array<{ event_id: string | null; status: string; reason?: string }> = [];

  for (const ev of events) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = parseInterExtractEvent(ev as any);
    if (!parsed.eventId) {
      results.push({ event_id: null, status: 'failed', reason: parsed.reason ?? 'sem id' });
      continue;
    }

    // 3. Insere webhook_event idempotente
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weInsert, error: weErr } = await (admin as any)
      .from('webhook_events')
      .insert({
        provider: 'inter',
        event_type: 'extrato',
        event_id: parsed.eventId,
        payload: ev,
        source_ip: sourceIp,
        status: 'processing',
      })
      .select('id')
      .single();

    if (weErr) {
      // 23505 = duplicate (já processado)
      if (weErr.code === '23505') {
        results.push({ event_id: parsed.eventId, status: 'duplicate' });
        continue;
      }
      console.error('[webhook-inter] insert webhook_event:', weErr);
      results.push({ event_id: parsed.eventId, status: 'failed', reason: weErr.message });
      continue;
    }

    const weId = weInsert.id;

    if (!parsed.bankTransaction) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('webhook_events').update({
        status: 'failed',
        error_message: parsed.reason ?? 'parser falhou',
        processed_at: new Date().toISOString(),
      }).eq('id', weId);
      results.push({ event_id: parsed.eventId, status: 'failed', reason: parsed.reason });
      continue;
    }

    // 4. Resolve organization
    // Estratégia: CNPJ da nossa filial (recebedor pra credit, pagador pra debit)
    // bate com organizations.cnpj. Se não bater, usa fallback (única org Inter ativa).
    let organizationId: string | null = null;
    let bankAccountId: string | null = null;

    if (parsed.organizationCnpj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: org } = await (admin as any)
        .from('organizations')
        .select('id')
        .in('type', ['company', 'branch'])
        .eq('cnpj', parsed.organizationCnpj)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (org) organizationId = org.id;
    }

    if (!organizationId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: account } = await (admin as any)
        .from('bank_accounts')
        .select('id, organization_id')
        .eq('bank_code', '077')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      organizationId = account?.organization_id ?? null;
      bankAccountId = account?.id ?? null;
    } else {
      // Tenta achar bank_account específica da org
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: account } = await (admin as any)
        .from('bank_accounts')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('bank_code', '077')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      bankAccountId = account?.id ?? null;
    }

    if (!organizationId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('webhook_events').update({
        status: 'failed',
        error_message: 'nenhuma organization Inter encontrada',
        processed_at: new Date().toISOString(),
      }).eq('id', weId);
      results.push({ event_id: parsed.eventId, status: 'failed', reason: 'org not found' });
      continue;
    }

    // 5. Insere bank_transactions
    const tx = parsed.bankTransaction;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: btInsert, error: btErr } = await (admin as any)
      .from('bank_transactions')
      .insert({
        organization_id: organizationId,
        bank_account_id: bankAccountId,
        external_id: tx.externalId,
        provider: 'inter',
        transaction_date: tx.date,
        amount: tx.amount,
        type: tx.type,
        description: tx.description,
        counterparty_name: tx.counterpartName ?? null,
        counterparty_document: tx.counterpartDocument ?? null,
        end_to_end_id: null,
        raw_payload: { ...tx, _webhook_event_id: weId },
      })
      .select('id')
      .single();

    let bankTxId: string | null = null;
    const resultSummary: Record<string, unknown> = {};
    if (btErr) {
      if (btErr.code === '23505') {
        // tx duplicada (cron já trouxe). Marca processed mesmo assim
        resultSummary.bank_tx = 'duplicate';
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('webhook_events').update({
          status: 'failed',
          error_message: `bank_tx insert: ${btErr.message}`,
          processed_at: new Date().toISOString(),
        }).eq('id', weId);
        results.push({ event_id: parsed.eventId, status: 'failed', reason: btErr.message });
        continue;
      }
    } else {
      bankTxId = btInsert.id;
      resultSummary.bank_tx = 'inserted';
    }

    // 6. Matching (apenas se foi novo insert — se duplicate, cron já tentou)
    if (bankTxId) {
      const txForMatch = {
        organizationId,
        externalId: tx.externalId,
        amount: tx.amount,
        transactionDate: tx.date,
        type: tx.type,
        endToEndId: null,
        counterpartyDocument: tx.counterpartDocument ?? null,
      };

      try {
        if (tx.type === 'credit') {
          const arMatch = await findArMatchForBankTransaction(admin, txForMatch);
          if (arMatch) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('bank_transactions').update({
              matched_ar_id: arMatch.arId,
              match_method: arMatch.method,
              match_confidence: arMatch.confidence,
              matched_at: new Date().toISOString(),
              status: 'matched',
            }).eq('id', bankTxId);

            // Side-effect AR: atualiza amount_received
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: ar } = await (admin as any)
              .from('accounts_receivable')
              .select('amount, amount_received, status, receive_method')
              .eq('id', arMatch.arId)
              .single();
            if (ar) {
              const newReceived = Number(ar.amount_received || 0) + tx.amount;
              const fullyReceived = newReceived + 0.005 >= Number(ar.amount);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (admin as any).from('accounts_receivable').update({
                amount_received: newReceived,
                status: fullyReceived ? 'received' : 'partially_received',
                received_at: fullyReceived ? new Date().toISOString() : null,
                receive_method: ar.receive_method ?? 'pix',
              }).eq('id', arMatch.arId);
            }
            resultSummary.match = `ar:${arMatch.confidence}`;
          } else {
            resultSummary.match = 'unmatched';
          }
        } else {
          const match = await findMatchForBankTransaction(admin, txForMatch);
          if (match) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('bank_transactions').update({
              matched_payment_id: match.paymentId,
              match_method: match.method,
              match_confidence: match.confidence,
              matched_at: new Date().toISOString(),
              status: 'matched',
            }).eq('id', bankTxId);
            resultSummary.match = `payment:${match.confidence}`;
          } else {
            resultSummary.match = 'unmatched';
          }
        }
      } catch (err) {
        resultSummary.match_error = err instanceof Error ? err.message : String(err);
      }
    }

    // 7. Atualiza webhook_event como processed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('webhook_events').update({
      status: 'processed',
      bank_tx_id: bankTxId,
      result_summary: resultSummary,
      processed_at: new Date().toISOString(),
    }).eq('id', weId);

    results.push({ event_id: parsed.eventId, status: 'processed' });
  }

  return Response.json({ ok: true, received: events.length, results });
}

// Comparação timing-safe simples — evita timing attack na validação do token
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
