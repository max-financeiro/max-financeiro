/**
 * POST /api/cap/extract
 *
 * Multipart upload: campo `file` com PDF/XML/JPG/PNG.
 * Carrega credencial Gemini ativa (se houver), passa pra extractCapFromDocument.
 * Devolve campos extraídos sem gravar nada.
 */
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: carrega credencial Gemini encrypted via RPC pgcrypto.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { extractCapFromDocument } from '@/lib/cap/extract';
import type { GeminiModel } from '@/lib/ai/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

const ALLOWED_MIME = [
  'application/pdf',
  'application/xml',
  'text/xml',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !['master', 'financial_manager', 'financial_analyst'].includes(profile.role)) {
    return Response.json({ error: 'Sem permissão' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Campo `file` ausente' }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: 'Arquivo vazio' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Arquivo maior que 10MB' }, { status: 413 });
  }

  const mimeType = file.type || 'application/octet-stream';
  const looksXml = file.name.toLowerCase().endsWith('.xml');
  const allowed = ALLOWED_MIME.includes(mimeType) || looksXml;
  if (!allowed) {
    return Response.json(
      { error: `Tipo não suportado: ${mimeType}. Use PDF, XML, JPG, PNG ou WebP.` },
      { status: 415 },
    );
  }

  // Carrega credencial Gemini ativa (se houver) — XML não precisa
  let gemini: { apiKey: string; model: GeminiModel } | null = null;
  if (!looksXml) {
    const encryptionKey = process.env.BANK_ENCRYPTION_KEY;
    if (encryptionKey) {
      try {
        const admin = getAdminClient();
        const { data: creds } = await admin.rpc('decrypt_gemini_credentials', {
          p_encryption_key: encryptionKey,
        });
        const row = Array.isArray(creds) ? creds[0] : creds;
        if (row?.api_key) {
          gemini = { apiKey: row.api_key, model: (row.model ?? 'gemini-flash-latest') as GeminiModel };
        }
      } catch (err) {
        console.warn('[cap-extract] Falha ao carregar credencial Gemini:', err);
      }
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const extracted = await extractCapFromDocument({
      buffer,
      mimeType: looksXml ? 'application/xml' : mimeType,
      fileName: file.name,
      gemini,
    });

    return Response.json({
      ok: true,
      extracted,
      provider: extracted.source,
      file: {
        name: file.name,
        size: file.size,
        mimeType: looksXml ? 'application/xml' : mimeType,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
