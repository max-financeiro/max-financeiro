#!/usr/bin/env node
// Conciliação Inter × NFs de entrada — pipeline completa via REST.
//
// Causa raiz: 81 NFs inbound presas em status='orphan' nunca dispararam o
// trigger auto_create_cap_from_fiscal_document → 0 CAPs criadas → matcher
// não tinha o que cruzar com os 237 débitos do Inter.
//
// Fluxo:
//   1) Backfill: UPDATE fiscal_documents.status='validated' nas 80 NFs
//      órfãs com total>0. O trigger cria CAPs (draft) automaticamente.
//   2) Auto-approve: UPDATE CAPs draft criadas → 'approved' (pra entrar
//      no matcher).
//   3) Matcher: pra cada bank_transactions(unmatched, debit) tenta casar
//      com CAP por (CNPJ + amount + janela) ou (amount + janela).
//      Ambíguo (>1) pula. Cria payment + UPDATE tx + UPDATE CAP.

import fs from 'node:fs';
import path from 'node:path';

const ENV = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'').trim()]; })
);
const SUPA_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SRK = ENV.SUPABASE_SERVICE_ROLE_KEY;
const WINDOW_DAYS = parseInt(process.env.WINDOW_DAYS || '30', 10);
const APPLY = process.env.APPLY === '1';
console.log(`mode=${APPLY ? 'APPLY (write)' : 'DRY-RUN (read-only)'} window=${WINDOW_DAYS}d`);
console.log(`url=${SUPA_URL}`);

const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function api(p, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1${p}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${opts.method || 'GET'} ${p} → ${r.status} ${t.slice(0, 300)}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

const CENTS = 0.005;
const PAID = new Set(['paid']);
const SKIP_CAP_STATUS = new Set(['draft','cancelled','rejected','paid']);
const PAYABLE_PT_VALID_INBOUND_STATUS = 'validated';

function extractCnpjFromDescription(desc) {
  if (!desc) return null;
  // Inter PIX: "Cp :12345678-NOME" — primeiros 8 dígitos do CNPJ
  const m = desc.match(/Cp\s*:\s*(\d{8,14})/i);
  return m ? m[1] : null;
}

function extractNameFromDescription(desc) {
  if (!desc) return null;
  // "PIX ENVIADO - Cp :12345678-NOME DO BENEFICIARIO" → NOME
  // "PIX ENVIADO INTERNO - 00019 201906473 NOME"     → NOME
  let m = desc.match(/Cp\s*:\s*\d+\s*-\s*(.+?)(?:\s*$|\s+R\$|\s+PIX)/i);
  if (m) return m[1].trim();
  m = desc.match(/PIX\s+ENVIADO(?:\s+INTERNO)?\s*-\s*(?:\d+\s+)*([^\d].+?)\s*$/i);
  if (m) return m[1].trim();
  return null;
}

function normName(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\b(ltda|me|epp|s\/a|sa|comercio|produtos|servicos|naturais|brasil|brasileira|industria|distribuidora|do|de|da|dos|das)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameSimilarity(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // contém substring forte
  if (na.length >= 4 && nb.includes(na)) return 0.9;
  if (nb.length >= 4 && na.includes(nb)) return 0.9;
  // primeiro token forte casa
  const ta = na.split(' ')[0], tb = nb.split(' ')[0];
  if (ta && tb && ta.length >= 4 && ta === tb) return 0.7;
  return 0;
}

async function step1Backfill() {
  console.log('\n=== STEP 1: backfill NFs orphan → validated ===');
  if (!APPLY) {
    const rows = await api(`/fiscal_documents?select=count&direction=eq.inbound&source=eq.focus&status=eq.orphan&total_amount=gt.0`, { headers: { Prefer: 'count=exact' } });
    console.log(`would update ${(rows && rows[0]?.count) || 0} NFs (dry-run)`);
    return;
  }
  // UPDATE em lote e devolve linhas atualizadas
  const updated = await api(`/fiscal_documents?direction=eq.inbound&source=eq.focus&status=eq.orphan&total_amount=gt.0`, {
    method: 'PATCH',
    body: JSON.stringify({ status: PAYABLE_PT_VALID_INBOUND_STATUS, updated_at: new Date().toISOString() }),
  });
  console.log(`✓ ${updated.length} NFs validadas (trigger criou ou criará CAPs)`);
  // Espera trigger processar (alguns segundos)
  await new Promise(r => setTimeout(r, 2000));
}

async function step2Approve() {
  console.log('\n=== STEP 2: auto-approve CAPs draft do focus ===');
  if (!APPLY) {
    const rows = await api(`/accounts_payable?select=count&status=eq.draft&source=eq.focus`, { headers: { Prefer: 'count=exact' } });
    console.log(`would approve ${(rows && rows[0]?.count) || 0} CAPs (dry-run)`);
    return;
  }
  const updated = await api(`/accounts_payable?status=eq.draft&source=eq.focus`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  console.log(`✓ ${updated.length} CAPs aprovadas`);
}

async function step3Match() {
  console.log('\n=== STEP 3: matcher CAP ↔ bank_transactions ===');

  // Carrega árvore de organizações pra resolver org → group
  // (conta Inter da Filial paga NFs da Matriz; ambas compartilham group_id)
  const orgs = await api(`/organizations?select=id,parent_id,type&deleted_at=is.null`);
  const byId = new Map(orgs.map(o => [o.id, o]));
  function groupOf(id) {
    let cur = byId.get(id); const seen = new Set();
    while (cur && cur.type !== 'group' && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
    return cur?.id || id;
  }

  const txs = await api(`/bank_transactions?type=eq.debit&status=eq.unmatched&select=id,organization_id,bank_account_id,external_id,end_to_end_id,amount,transaction_date,counterparty_name,counterparty_document,description&order=transaction_date.desc&limit=2000`);
  console.log(`tx candidates: ${txs.length}`);

  // Carrega TODAS CAPs ativas (com room pra pagar) de uma vez (volume pequeno)
  const caps = await api(`/accounts_payable?select=id,organization_id,supplier_id,amount,amount_paid,amount_pending,issue_date,due_date,status,fiscal_document_id,business_partners(document,legal_name)&deleted_at=is.null&status=not.in.(draft,cancelled,rejected,paid)&order=due_date.asc&limit=2000`);
  console.log(`cap candidates: ${caps.length}`);

  // anota group_id em cada item pra filtrar
  for (const t of txs) t._group = groupOf(t.organization_id);
  for (const c of caps) c._group = groupOf(c.organization_id);

  let matched = 0, ambiguous = 0, noMatch = 0;
  const matches = [];

  for (const tx of txs) {
    const txDoc = (tx.counterparty_document || extractCnpjFromDescription(tx.description) || '').replace(/\D/g, '');
    const txDocHead = txDoc.slice(0, 8);

    const candidates = caps.filter(cap => {
      if (cap._group !== tx._group) return false;
      if (Math.abs(Number(cap.amount) - Number(tx.amount)) > CENTS) return false;
      const issueLow = new Date(cap.issue_date); issueLow.setDate(issueLow.getDate() - 1);
      const dueHi = new Date(cap.due_date); dueHi.setDate(dueHi.getDate() + WINDOW_DAYS);
      const txDate = new Date(tx.transaction_date);
      if (txDate < issueLow || txDate > dueHi) return false;
      return true;
    });

    if (candidates.length === 0) { noMatch++; continue; }

    // Tenta camada A (CNPJ): subconjunto onde CNPJ casa
    let chosen = null;
    let method = null;
    if (txDoc) {
      const cnpjMatch = candidates.filter(c => {
        const sd = (c.business_partners?.document || '').replace(/\D/g, '');
        return sd === txDoc || (sd.length >= 8 && sd.slice(0, 8) === txDocHead);
      });
      if (cnpjMatch.length === 1) { chosen = cnpjMatch[0]; method = 'cnpj_amount_window'; }
      else if (cnpjMatch.length > 1) { ambiguous++; continue; }
    }
    // Camada B+: amount + janela + nome similar (description vs supplier)
    if (!chosen) {
      const txName = tx.counterparty_name || extractNameFromDescription(tx.description);
      if (txName) {
        const nameMatches = candidates.map(c => ({
          c, score: nameSimilarity(txName, c.business_partners?.legal_name)
        })).filter(x => x.score >= 0.7).sort((a,b) => b.score - a.score);
        if (nameMatches.length === 1) {
          chosen = nameMatches[0].c;
          method = nameMatches[0].score >= 0.9 ? 'name_amount_window' : 'name_partial_amount_window';
        } else if (nameMatches.length > 1 && nameMatches[0].score > nameMatches[1].score) {
          // empate quebrado por score
          chosen = nameMatches[0].c;
          method = 'name_amount_window';
        }
      }
    }
    // Camada C: amount exato + janela única (sem CNPJ, sem nome) — último recurso
    if (!chosen) {
      if (candidates.length === 1) { chosen = candidates[0]; method = 'amount_window'; }
      else { ambiguous++; continue; }
    }

    matches.push({ tx, cap: chosen, method });
    matched++;
    // Remove a CAP do pool pra não casar 2× (1:1)
    const idx = caps.indexOf(chosen);
    if (idx >= 0) caps.splice(idx, 1);
  }

  console.log(`✓ matched=${matched} ambiguous=${ambiguous} no_match=${noMatch}`);

  if (!APPLY) {
    console.log('\n(dry-run) primeiros 10 matches que seriam aplicados:');
    matches.slice(0, 10).forEach(m => {
      console.log(`  ${m.method.padEnd(20)} R$${m.tx.amount.toFixed(2).padStart(11)} ${m.tx.transaction_date} → CAP ${m.cap.id.slice(0,8)} (${(m.cap.business_partners?.legal_name || 'sem fornecedor').slice(0,50)})`);
    });
    return { matched, ambiguous, noMatch };
  }

  // Aplica em prod
  let applied = 0;
  for (const { tx, cap, method } of matches) {
    try {
      // 1) cria payment
      const [payment] = await api(`/payments`, {
        method: 'POST',
        body: JSON.stringify({
          payable_id: cap.id,
          amount: tx.amount,
          payment_date: tx.transaction_date,
          payment_method: 'pix',
          provider: 'inter',
          provider_request_id: tx.external_id,
          provider_status: 'paid',
          settled_at: new Date(tx.transaction_date + 'T12:00:00-03:00').toISOString(),
          bank_account_id: tx.bank_account_id,
          idempotency_key: `conc-${tx.id}`,
        }),
      });
      // 2) marca tx
      await api(`/bank_transactions?id=eq.${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          matched_payment_id: payment.id,
          match_method: method,
          match_confidence: method === 'cnpj_amount_window' ? 'high' : 'medium',
          matched_at: new Date().toISOString(),
          status: 'matched',
          updated_at: new Date().toISOString(),
        }),
      });
      // 3) soma amount_paid; se atingir amount, marca paid
      const newPaid = Number(cap.amount_paid || 0) + Number(tx.amount);
      const newStatus = newPaid + CENTS >= Number(cap.amount) ? 'paid' : cap.status;
      await api(`/accounts_payable?id=eq.${cap.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() }),
      });
      applied++;
    } catch (e) {
      console.error(`  ✗ falha tx=${tx.id.slice(0,8)} cap=${cap.id.slice(0,8)}: ${e.message}`);
    }
  }
  console.log(`✓ applied=${applied}/${matched}`);
  return { matched: applied, ambiguous, noMatch };
}

async function summary() {
  console.log('\n=== SUMÁRIO PROD ===');
  for (const t of ['fiscal_documents', 'accounts_payable', 'bank_transactions', 'payments']) {
    const r = await fetch(`${SUPA_URL}/rest/v1/${t}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
    const cr = r.headers.get('content-range');
    console.log(`  ${t}: ${cr}`);
  }
  const matched = await fetch(`${SUPA_URL}/rest/v1/bank_transactions?status=eq.matched&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const unmatched = await fetch(`${SUPA_URL}/rest/v1/bank_transactions?status=eq.unmatched&select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  console.log(`  matched   : ${matched.headers.get('content-range')}`);
  console.log(`  unmatched : ${unmatched.headers.get('content-range')}`);
}

(async () => {
  await summary();
  await step1Backfill();
  await step2Approve();
  await step3Match();
  await summary();
})();
