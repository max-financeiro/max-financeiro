/**
 * POST /api/webhooks/inter/[secret]
 *
 * Receptor dos webhooks do Banco Inter — notificações de mudança de status
 * de pagamento (PIX / boleto). Implementa os critérios de segurança CA5 da
 * Sprint 0:
 *
 *  1. Caminho secreto — `[secret]` precisa bater com `webhook_secret_path`
 *     da credencial ativa (URL não-adivinhável, primeira defesa).
 *  2. IP allowlist — `INTER_WEBHOOK_IPS` (opcional; libera se não setada).
 *  3. Anti-replay — rejeita evento com timestamp > 5min.
 *  4. HMAC — valida assinatura quando o Inter a envia.
 *  5. Idempotência — `event_id` UNIQUE em inter_webhook_events: cada evento
 *     processa exatamente 1×.
 *
 * Atualiza `payments.provider_status` e `accounts_payable.status`.
 */
import { NextResponse } from 'next/server';
// SERVICE_ROLE: webhook roda sob o sistema (sem sessão de usuário) — precisa
// gravar payments/accounts_payable/inter_webhook_events e ler a credencial.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/auth/audit';
import { loadInterCredentials } from '@/lib/inter/credentials';
import { mapInterPaymentStatus } from '@/lib/inter/client';
import {
  extractWebhookEvents,
  getInterWebhookIpAllowlist,
  isIpAllowed,
  isReplay,
  verifyWebhookHmac,
  type InterWebhookEvent,
} from '@/lib/inter/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAG = '[inter-webhook]';

/** GET — health check / verificação de URL pelo Inter. */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'inter-webhook' });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  const rawBody = await req.text();

  // ---- Credencial ativa ----
  let creds;
  try {
    creds = await loadInterCredentials();
  } catch (err) {
    console.error(TAG, 'load_credentials_failed', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  if (!creds) {
    // Sem credencial ativa — não há o que processar.
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  // ---- 1. Caminho secreto ----
  if (secret !== creds.webhookSecretPath) {
    console.warn(TAG, 'secret_path_mismatch');
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // ---- 2. IP allowlist ----
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const allowlist = getInterWebhookIpAllowlist();
  if (!isIpAllowed(ip, allowlist)) {
    console.warn(TAG, 'ip_blocked', ip);
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ---- 3. Anti-replay ----
  const timestamp =
    req.headers.get('x-inter-timestamp') ?? req.headers.get('x-timestamp') ?? null;
  if (isReplay(timestamp)) {
    console.warn(TAG, 'replay_rejected', timestamp);
    return NextResponse.json({ error: 'stale' }, { status: 400 });
  }

  // ---- 4. HMAC (quando o Inter assina) ----
  const signature =
    req.headers.get('x-inter-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-hub-signature-256') ??
    null;
  if (signature && !verifyWebhookHmac(rawBody, signature, creds.webhookSecret)) {
    console.warn(TAG, 'hmac_invalid');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // ---- Parse ----
  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const events = extractWebhookEvents(payload);
  if (events.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const admin = getAdminClient();
  let processed = 0;
  let duplicates = 0;

  for (const event of events) {
    try {
      const result = await processEvent(admin, event, ip);
      if (result === 'duplicate') duplicates += 1;
      else if (result === 'processed') processed += 1;
    } catch (err) {
      console.error(TAG, 'event_failed', event.eventId, err);
      // segue pros próximos eventos — não derruba o webhook inteiro
    }
  }

  return NextResponse.json({ ok: true, processed, duplicates, total: events.length });
}

type EventOutcome = 'duplicate' | 'processed' | 'ignored';

/** Processa 1 evento. Idempotente via UNIQUE(event_id). */
async function processEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  event: InterWebhookEvent,
  ip: string | null,
): Promise<EventOutcome> {
  // Idempotência: upsert ignoreDuplicates só insere se for evento novo.
  const { data: inserted, error: insErr } = await admin
    .from('inter_webhook_events')
    .upsert(
      {
        event_id: event.eventId,
        event_type: event.status ? 'pagamento' : null,
        provider_request_id: event.requestId,
        inter_status: event.status,
        payload: event.raw,
        source_ip: ip,
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
    .select('id');

  if (insErr) throw new Error(insErr.message);
  if (!inserted || inserted.length === 0) return 'duplicate';

  // Sem requestId não dá pra casar com um pagamento.
  if (!event.requestId) {
    await admin
      .from('inter_webhook_events')
      .update({
        processing_status: 'ignored',
        processing_error: 'evento sem identificador de transação',
        processed_at: new Date().toISOString(),
      })
      .eq('event_id', event.eventId);
    return 'ignored';
  }

  const { data: payment } = await admin
    .from('payments')
    .select('id, payable_id, amount')
    .eq('provider_request_id', event.requestId)
    .maybeSingle();

  if (!payment) {
    await admin
      .from('inter_webhook_events')
      .update({
        processing_status: 'ignored',
        processing_error: `pagamento não encontrado pra request ${event.requestId}`,
        processed_at: new Date().toISOString(),
      })
      .eq('event_id', event.eventId);
    return 'ignored';
  }

  const mapped = mapInterPaymentStatus(event.status);
  const now = new Date().toISOString();

  await admin
    .from('payments')
    .update({
      provider_status: mapped,
      settled_at: mapped === 'paid' ? now : null,
    })
    .eq('id', payment.id);

  // Reflete no CAP
  if (mapped === 'paid') {
    const { data: cap } = await admin
      .from('accounts_payable')
      .select('amount')
      .eq('id', payment.payable_id)
      .maybeSingle();
    const capAmount = Number(cap?.amount ?? payment.amount);

    // Soma TODOS os pagamentos paid pra este CAP (anti-clobber:
    // pagamento parcial #2 não pode zerar o #1). Inclui o atual.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: paidPayments } = await (admin as any)
      .from('payments')
      .select('amount')
      .eq('payable_id', payment.payable_id)
      .eq('provider_status', 'paid');
    const totalPaid =
      (paidPayments ?? []).reduce(
        (acc: number, p: { amount: number | string }) => acc + Number(p.amount ?? 0),
        0,
      );
    const amountPaid = Math.min(capAmount, totalPaid);

    await admin
      .from('accounts_payable')
      .update({
        status: amountPaid >= capAmount ? 'paid' : 'partially_paid',
        amount_paid: amountPaid,
      })
      .eq('id', payment.payable_id);
  } else if (mapped === 'failed' || mapped === 'rejected') {
    // Pagamento não saiu — devolve o CAP pra 'approved' SÓ se nenhum outro
    // pagamento paid existir (evita perder evidência de pago anterior).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stillPaid } = await (admin as any)
      .from('payments')
      .select('id')
      .eq('payable_id', payment.payable_id)
      .eq('provider_status', 'paid')
      .limit(1);
    if (!stillPaid || stillPaid.length === 0) {
      await admin
        .from('accounts_payable')
        .update({ status: 'approved' })
        .eq('id', payment.payable_id);
    }
  }

  await admin
    .from('inter_webhook_events')
    .update({
      processing_status: 'processed',
      payment_id: payment.id,
      processed_at: now,
    })
    .eq('event_id', event.eventId);

  await logAuditEvent(admin, {
    action: 'cap.payment_webhook',
    entityType: 'payments',
    entityId: payment.id,
    afterState: {
      provider: 'inter',
      provider_request_id: event.requestId,
      inter_status: event.status,
      mapped_status: mapped,
    },
  });

  return 'processed';
}
