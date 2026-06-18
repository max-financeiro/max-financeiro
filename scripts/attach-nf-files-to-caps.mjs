#!/usr/bin/env node
/**
 * Backfill + sincronização: pra cada CAP gerada de NF (focus) sem anexo,
 * baixa XML+PDF da Focus NFe e cria attachment no bucket cap-attachments.
 *
 * Idempotente: pula CAPs que já têm nfe_xml/nfe_pdf anexado. Pode rodar em
 * cron seguro a cada 5min.
 *
 * Modo:
 *   APPLY=1 node scripts/attach-nf-files-to-caps.mjs
 *   (sem APPLY = dry-run)
 */
import fs from 'node:fs';

const ENV = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'').trim()]; })
);
const SUPA_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SRK = ENV.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY = ENV.BANK_ENCRYPTION_KEY;
const APPLY = process.env.APPLY === '1';
console.log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'} url=${SUPA_URL}`);

const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' };

async function api(p, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1${p}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${opts.method || 'GET'} ${p} → ${r.status} ${t.slice(0, 300)}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

async function rpc(name, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`rpc ${name} → ${r.status} ${t.slice(0, 300)}`);
  }
  return r.json();
}

async function uploadToBucket(storagePath, buffer, contentType) {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/cap-attachments/${storagePath}`, {
    method: 'POST',
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`upload ${storagePath} → ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function focusFetch(url, token) {
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  // 1) Decrypt credenciais Focus
  const creds = await rpc('decrypt_focus_credentials', { p_encryption_key: ENC_KEY });
  const credByOrg = new Map(creds.map(c => [c.organization_id, c]));
  console.log(`focus creds: ${creds.length}`);

  // 2) Pega CAPs com fiscal_document + access_key, sem anexos NF (xml ou pdf) ativos
  const caps = await api('/accounts_payable?select=id,organization_id,fiscal_document_id,fiscal_documents(access_key,number),accounts_payable_attachments(id,kind,deleted_at)&fiscal_document_id=not.is.null&deleted_at=is.null&limit=2000');
  console.log(`CAPs com NF: ${caps.length}`);

  const needsXml = [];
  const needsPdf = [];
  for (const cap of caps) {
    const fd = cap.fiscal_documents;
    if (!fd?.access_key) continue;
    const atts = (cap.accounts_payable_attachments || []).filter(a => !a.deleted_at);
    const hasXml = atts.some(a => a.kind === 'nfe_xml');
    const hasPdf = atts.some(a => a.kind === 'nfe_pdf');
    if (!hasXml) needsXml.push({ cap, fd });
    if (!hasPdf) needsPdf.push({ cap, fd });
  }
  console.log(`needs XML: ${needsXml.length} | needs PDF: ${needsPdf.length}`);

  if (!APPLY) {
    console.log('\n(dry-run) primeiras 5 CAPs que receberiam anexo PDF:');
    needsPdf.slice(0, 5).forEach(({ cap, fd }) =>
      console.log(`  CAP ${cap.id.slice(0,8)} NF ${fd.number || '?'} key ${fd.access_key.slice(-8)}`)
    );
    return;
  }

  const baseUrl = (env) => env === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
  let okXml = 0, okPdf = 0, fail = 0;

  // XML
  let firstErr = null;
  for (const { cap, fd } of needsXml) {
    try {
      const cred = credByOrg.get(cap.organization_id);
      if (!cred) { fail++; if(!firstErr) firstErr=`sem cred org=${cap.organization_id}`; continue; }
      const url = `${baseUrl(cred.environment)}/v2/nfes_recebidas/${fd.access_key}.xml?cnpj=${cred.cnpj}`;
      const buf = await focusFetch(url, cred.token);
      if (!buf || buf.length === 0) { fail++; if(!firstErr) firstErr=`focus vazio cap=${cap.id.slice(0,8)} key=${fd.access_key}`; continue; }
      const storagePath = `${cap.organization_id}/${cap.id}/nfe-${fd.access_key}.xml`;
      await uploadToBucket(storagePath, buf, 'application/xml');
      await api('/accounts_payable_attachments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          accounts_payable_id: cap.id,
          organization_id: cap.organization_id,
          storage_path: storagePath,
          file_name: `NF-e ${fd.number || fd.access_key.slice(-9)}.xml`,
          mime_type: 'application/xml',
          size_bytes: buf.length,
          kind: 'nfe_xml',
          source: 'focus',
        }),
      });
      okXml++;
      process.stdout.write('x');
    } catch (e) {
      fail++;
      if(!firstErr) firstErr=`XML: ${e.message}`;
      process.stdout.write('!');
    }
  }
  process.stdout.write('\n');
  if (firstErr) console.log(`(first XML err: ${firstErr})`);
  firstErr = null;

  // PDF
  for (const { cap, fd } of needsPdf) {
    try {
      const cred = credByOrg.get(cap.organization_id);
      if (!cred) { fail++; continue; }
      const url = `${baseUrl(cred.environment)}/v2/nfes_recebidas/${fd.access_key}.pdf?cnpj=${cred.cnpj}`;
      const buf = await focusFetch(url, cred.token);
      if (!buf || buf.length === 0) { fail++; continue; }
      const storagePath = `${cap.organization_id}/${cap.id}/nfe-${fd.access_key}.pdf`;
      await uploadToBucket(storagePath, buf, 'application/pdf');
      await api('/accounts_payable_attachments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          accounts_payable_id: cap.id,
          organization_id: cap.organization_id,
          storage_path: storagePath,
          file_name: `NF-e ${fd.number || fd.access_key.slice(-9)}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: buf.length,
          kind: 'nfe_pdf',
          source: 'focus',
        }),
      });
      okPdf++;
      process.stdout.write('p');
    } catch (e) {
      fail++;
      if(!firstErr) firstErr=`PDF: ${e.message}`;
      process.stdout.write('!');
    }
  }
  process.stdout.write('\n');
  if (firstErr) console.log(`(first PDF err: ${firstErr})`);

  console.log(`\n✓ xml=${okXml} pdf=${okPdf} fail=${fail}`);
})();
