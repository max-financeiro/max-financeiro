/**
 * uploads/safe-upload.ts — validações comuns de upload de arquivo:
 *   1. tamanho (default 10MB)
 *   2. magic bytes vs MIME declarado (anti-spoof do header)
 *   3. antivírus opcional (ENABLE_ANTIVIRUS=true + CLOUDMERSIVE_API_KEY)
 *
 * Usado em CAP attachment, NF-e portal submit, CAP IA extract.
 * Never throws — devolve { ok, error } estruturado.
 */
import 'server-only';
import { createAntivirusProvider } from '@/lib/antivirus/factory';

const MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

export type Allowed = 'pdf' | 'xml' | 'jpeg' | 'png' | 'webp';

const MAGIC_PREFIXES: Array<{ type: Allowed; bytes: number[]; offset?: number }> = [
  { type: 'pdf',  bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },                               // %PDF-
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'png',  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },                          // "WEBP" no offset 8
];

const MIME_TO_TYPE: Record<string, Allowed> = {
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface SafeUploadOpts {
  allowedTypes?: Allowed[];
  maxBytes?: number;
  /** Se true, falha do AV bloqueia upload. Se false, AV unavailable libera (best-effort). */
  strictAntivirus?: boolean;
}

export type SafeUploadResult =
  | { ok: true; type: Allowed; buffer: Buffer; mimeType: string }
  | { ok: false; error: string; code: 'size' | 'mime' | 'magic' | 'infected' | 'av_error' };

function detectMagic(buffer: Buffer): Allowed | null {
  for (const m of MAGIC_PREFIXES) {
    const offset = m.offset ?? 0;
    if (buffer.length < offset + m.bytes.length) continue;
    let match = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (buffer[offset + i] !== m.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return m.type;
  }
  // XML: pode começar com whitespace + '<?xml' ou '<' (NF-e sem prolog)
  const head = buffer.slice(0, 256).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<')) return 'xml';
  return null;
}

/**
 * Valida tamanho, magic bytes vs MIME declarado, e scaneia com antivírus.
 *
 * @example
 *   const r = await validateUpload(file, { allowedTypes: ['pdf','xml'] });
 *   if (!r.ok) return { error: r.error };
 *   await storage.upload(path, r.buffer, { contentType: r.mimeType });
 */
export async function validateUpload(
  file: File,
  opts: SafeUploadOpts = {},
): Promise<SafeUploadResult> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES_DEFAULT;
  const allowed = opts.allowedTypes ?? (['pdf', 'xml', 'jpeg', 'png', 'webp'] as Allowed[]);

  if (file.size === 0) {
    return { ok: false, error: 'Arquivo vazio', code: 'size' };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `Arquivo > ${Math.round(maxBytes / 1024 / 1024)}MB`,
      code: 'size',
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const declaredMime = (file.type || 'application/octet-stream').toLowerCase();
  const declaredType = MIME_TO_TYPE[declaredMime];

  // Detecta tipo real via magic bytes
  const realType = detectMagic(buffer);
  if (!realType) {
    return {
      ok: false,
      error: 'Tipo de arquivo não reconhecido — só PDF, XML, JPG, PNG ou WEBP.',
      code: 'magic',
    };
  }

  if (!allowed.includes(realType)) {
    return {
      ok: false,
      error: `Tipo ${realType} não permitido neste contexto`,
      code: 'mime',
    };
  }

  // Spoof check: MIME declarado precisa bater com magic bytes
  if (declaredType && declaredType !== realType) {
    return {
      ok: false,
      error: `MIME declarado (${declaredMime}) não bate com o conteúdo real (${realType}). Possível tentativa de spoofing.`,
      code: 'magic',
    };
  }

  // Antivírus
  try {
    const av = createAntivirusProvider();
    const scan = await av.scanFile(buffer, file.name);
    if (scan.status === 'infected') {
      return { ok: false, error: `Malware detectado: ${scan.threat}`, code: 'infected' };
    }
    if (scan.status === 'error' && opts.strictAntivirus) {
      return { ok: false, error: `Falha no antivírus: ${scan.message}`, code: 'av_error' };
    }
    // unavailable → fail-open (mock provider quando ENABLE_ANTIVIRUS=false)
  } catch (err) {
    if (opts.strictAntivirus) {
      return {
        ok: false,
        error: `Antivírus indisponível: ${err instanceof Error ? err.message : 'unknown'}`,
        code: 'av_error',
      };
    }
  }

  // MIME canônico de saída
  const canonicalMime =
    realType === 'pdf' ? 'application/pdf' :
    realType === 'xml' ? 'application/xml' :
    realType === 'jpeg' ? 'image/jpeg' :
    realType === 'png' ? 'image/png' : 'image/webp';

  return { ok: true, type: realType, buffer, mimeType: canonicalMime };
}
