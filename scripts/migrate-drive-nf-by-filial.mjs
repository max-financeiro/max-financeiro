#!/usr/bin/env node
/**
 * Migração one-off — reorganiza NF-e já backupadas no Google Drive para a
 * nova estrutura separada por filial:
 *
 *   antes:  /<raiz>/<YYYY>/<MM>/NF...
 *   depois: /<raiz>/<empresa-ou-filial>/<YYYY>/<MM>/NF...
 *
 * A pasta da org vem do nome (trade_name → legal_name) da organization
 * receptora da NF (mesma lógica de orgFolderName em src/lib/google-drive/backup-nf.ts).
 *
 * Move os arquivos (XML + DANFE) via Drive files.update (addParents/removeParents) —
 * o file_id NÃO muda, então fiscal_documents.drive_*_file_id continua válido.
 * Idempotente: se o arquivo já está na pasta-alvo, pula.
 *
 * Roda em Node 20 com fetch puro (sem supabase-js → evita o erro de WebSocket).
 *
 * Uso:
 *   node scripts/migrate-drive-nf-by-filial.mjs            # DRY-RUN (só mostra o plano)
 *   node scripts/migrate-drive-nf-by-filial.mjs --apply    # executa de verdade
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- env (.env.local sem dep de dotenv) ---
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = env.BANK_ENCRYPTION_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE || !ENCRYPTION_KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / BANK_ENCRYPTION_KEY no .env.local');
  process.exit(1);
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

async function sbRest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`PostgREST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function sbRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: sbHeaders, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${fn} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Espelha orgFolderName() de src/lib/google-drive/backup-nf.ts
function orgFolderName(org) {
  const raw = String(org?.trade_name ?? org?.legal_name ?? '').replace(/[/\\]/g, '-').trim();
  if (raw) return raw.slice(0, 80);
  if (org?.type === 'branch') return 'Filial';
  if (org?.type === 'company' || org?.type === 'group') return 'Matriz';
  return 'Sem-Organizacao';
}
const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

// --- Drive token (replica getValidAccessToken) ---
async function getDriveToken() {
  const data = await sbRpc('decrypt_google_drive_credentials', { p_encryption_key: ENCRYPTION_KEY });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.refresh_token) throw new Error('Sem credencial Google Drive (conecte em /integracoes/google-drive)');
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAt - Date.now() > 300_000) {
    return { accessToken: row.access_token, rootFolderId: row.root_folder_id };
  }
  const body = new URLSearchParams({ client_id: row.client_id, client_secret: row.client_secret, refresh_token: row.refresh_token, grant_type: 'refresh_token' });
  const res = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`Google refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  await sbRpc('update_google_drive_token', {
    p_encryption_key: ENCRYPTION_KEY,
    p_access_token: j.access_token,
    p_expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
  });
  return { accessToken: j.access_token, rootFolderId: row.root_folder_id };
}

// --- Drive helpers ---
let TOKEN = '';
async function drive(path, opts = {}) {
  const res = await fetch(`${DRIVE_API}/${path}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`Drive ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const folderCache = new Map(); // `${parent}/${name}` → id
async function findOrCreateFolder(name, parentId) {
  const cacheKey = `${parentId}/${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  // dry-run: pai inexistente (placeholder) → filho também é placeholder, sem consultar Drive
  if (String(parentId).startsWith('(novo:')) {
    const ph = `(novo:${name})`;
    folderCache.set(cacheKey, ph);
    return ph;
  }
  const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${safe}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const found = await drive(`files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`);
  let id = found.files?.[0]?.id;
  if (!id) {
    if (!APPLY) { folderCache.set(cacheKey, `(novo:${name})`); return `(novo:${name})`; }
    const created = await drive('files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) });
    id = created.id;
  }
  folderCache.set(cacheKey, id);
  return id;
}
async function moveFile(fileId, targetFolderId) {
  const meta = await drive(`files/${fileId}?fields=id,name,parents`);
  const parents = meta.parents ?? [];
  if (parents.includes(targetFolderId)) return { moved: false, name: meta.name, reason: 'já na pasta-alvo' };
  if (!APPLY) return { moved: true, name: meta.name, dryRun: true };
  await drive(`files/${fileId}?addParents=${targetFolderId}&removeParents=${parents.join(',')}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return { moved: true, name: meta.name };
}

// --- main ---
console.log(`\n=== Migração NF Drive por filial — ${APPLY ? 'APPLY (move de verdade)' : 'DRY-RUN (só plano)'} ===\n`);
const { accessToken, rootFolderId } = await getDriveToken();
TOKEN = accessToken;
console.log(`Drive root: ${rootFolderId}\n`);

const docs = await sbRest(
  'fiscal_documents?select=id,number,competence_date,issue_date,drive_xml_file_id,drive_pdf_file_id,organizations(trade_name,legal_name,type)&drive_backup_at=not.is.null&order=competence_date',
);

const stats = { docs: 0, filesMoved: 0, filesSkipped: 0, filesMissing: 0, errors: 0 };
for (const doc of docs) {
  stats.docs++;
  const folder = orgFolderName(doc.organizations);
  const comp = (doc.competence_date ?? doc.issue_date ?? '').slice(0, 10);
  if (!comp) { console.log(`  ! NF ${doc.number}: sem competência — pulada`); continue; }
  const dt = new Date(`${comp}T00:00:00Z`);
  const year = String(dt.getUTCFullYear());
  const month = pad2(dt.getUTCMonth() + 1);
  try {
    const filialId = await findOrCreateFolder(folder, rootFolderId);
    const yearId = await findOrCreateFolder(year, filialId);
    const monthId = await findOrCreateFolder(month, yearId);
    const targets = [doc.drive_xml_file_id, doc.drive_pdf_file_id].filter(Boolean);
    if (!targets.length) { stats.filesMissing++; continue; }
    const labels = [];
    for (const fid of targets) {
      try {
        const r = await moveFile(fid, monthId);
        if (r.moved) { stats.filesMoved++; labels.push(`→ ${r.name}`); }
        else { stats.filesSkipped++; labels.push(`= ${r.name} (${r.reason})`); }
      } catch (e) { stats.errors++; labels.push(`ERRO ${fid}: ${e.message}`); }
    }
    console.log(`  NF ${doc.number}  [${folder}/${year}/${month}]  ${labels.join('  ')}`);
  } catch (e) {
    stats.errors++;
    console.log(`  ! NF ${doc.number}: ${e.message}`);
  }
}

console.log(`\n=== Resumo ===`);
console.log(`Docs:           ${stats.docs}`);
console.log(`Arquivos movidos${APPLY ? '' : ' (a mover)'}: ${stats.filesMoved}`);
console.log(`Já na pasta:    ${stats.filesSkipped}`);
console.log(`Sem file_id:    ${stats.filesMissing}`);
console.log(`Erros:          ${stats.errors}`);
if (!APPLY) console.log(`\nDry-run. Rode com --apply pra mover de verdade.`);
