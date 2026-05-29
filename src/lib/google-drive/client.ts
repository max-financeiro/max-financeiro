/**
 * google-drive/client.ts — REST API thin client.
 *
 * Sem SDK — só fetch direto. Funções:
 *  - findFile / findFolder por nome dentro de um parent
 *  - createFolder
 *  - findOrCreateFolder
 *  - uploadFile (multipart com metadata + bytes)
 *
 * Todas devolvem { ok, ... } estruturado — não lançam.
 */
import 'server-only';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Busca arquivo/pasta por nome exato dentro do parent. Retorna o primeiro
 * encontrado (ou null se nenhum).
 */
export async function findByName(opts: {
  accessToken: string;
  name: string;
  parentId: string;
  mimeType?: string;            // 'application/vnd.google-apps.folder' pra pastas
}): Promise<DriveResult<DriveFile | null>> {
  // Drive q syntax: nome com aspas precisa escapar aspas e backslash
  const safeName = opts.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const qParts = [
    `name = '${safeName}'`,
    `'${opts.parentId}' in parents`,
    `trashed = false`,
  ];
  if (opts.mimeType) qParts.push(`mimeType = '${opts.mimeType}'`);
  const q = qParts.join(' and ');
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Drive findByName ${res.status}: ${detail.slice(0, 200)}` };
  }
  const json = (await res.json()) as { files?: DriveFile[] };
  const first = json.files?.[0] ?? null;
  return { ok: true, data: first };
}

/** Cria pasta dentro do parent. */
export async function createFolder(opts: {
  accessToken: string;
  name: string;
  parentId: string;
}): Promise<DriveResult<DriveFile>> {
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,mimeType`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: opts.name,
      mimeType: FOLDER_MIME,
      parents: [opts.parentId],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Drive createFolder ${res.status}: ${detail.slice(0, 200)}` };
  }
  const file = (await res.json()) as DriveFile;
  return { ok: true, data: file };
}

/** Busca pasta; cria se não existir. Idempotente. */
export async function findOrCreateFolder(opts: {
  accessToken: string;
  name: string;
  parentId: string;
}): Promise<DriveResult<DriveFile>> {
  const found = await findByName({
    accessToken: opts.accessToken,
    name: opts.name,
    parentId: opts.parentId,
    mimeType: FOLDER_MIME,
  });
  if (!found.ok) return found;
  if (found.data) return { ok: true, data: found.data };
  return createFolder({
    accessToken: opts.accessToken,
    name: opts.name,
    parentId: opts.parentId,
  });
}

/**
 * Upload de arquivo via multipart (metadata + bytes em uma request).
 * Devolve { id } do arquivo criado. Se já existir arquivo com mesmo nome
 * no parent, cria UMA SEGUNDA cópia — caller deve checar antes via findByName
 * se quiser idempotência.
 */
export async function uploadFile(opts: {
  accessToken: string;
  name: string;
  parentId: string;
  mimeType: string;
  body: Buffer | string;
  description?: string;
}): Promise<DriveResult<DriveFile>> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: opts.name,
    parents: [opts.parentId],
    mimeType: opts.mimeType,
    description: opts.description,
  };
  const bodyBuf =
    typeof opts.body === 'string'
      ? Buffer.from(opts.body, 'utf8')
      : opts.body;

  // Monta multipart manualmente
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
  parts.push(Buffer.from(`Content-Type: application/json; charset=UTF-8\r\n\r\n`, 'utf8'));
  parts.push(Buffer.from(`${JSON.stringify(metadata)}\r\n`, 'utf8'));
  parts.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
  parts.push(Buffer.from(`Content-Type: ${opts.mimeType}\r\n\r\n`, 'utf8'));
  parts.push(bodyBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);

  const res = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Drive upload ${res.status}: ${detail.slice(0, 300)}` };
  }
  const file = (await res.json()) as DriveFile;
  return { ok: true, data: file };
}

/** Valida que o folder_id existe + temos acesso. */
export async function getFolderInfo(opts: {
  accessToken: string;
  folderId: string;
}): Promise<DriveResult<DriveFile>> {
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(opts.folderId)}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `Drive getFolder ${res.status}: ${detail.slice(0, 200)}` };
  }
  const file = (await res.json()) as DriveFile;
  if (file.mimeType !== FOLDER_MIME) {
    return { ok: false, error: 'O ID informado não é uma pasta' };
  }
  return { ok: true, data: file };
}
