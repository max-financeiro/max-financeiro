/**
 * POST /api/portal/nf-e/submit
 *
 * Fluxo do portal apos preview da IA. Aceita PDF e/ou XML + os campos
 * confirmados pelo fornecedor. Substitui o caminho da edge function
 * upload-fiscal-document quando o usuario vem via Next.js (portal novo).
 *
 * - Auth supplier
 * - Valida CNPJ destinatario == filial selecionada
 * - Sobe arquivos pro Storage (fiscal-documents/<supplier>/<docId>/<file>)
 * - Insere fiscal_documents
 * - Retorna { id }
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: storage upload + fiscal_documents insert (RLS de write na
// tabela e mais restrita; service_role roda apos auth check explicito).
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;

const DataSchema = z.object({
  organization_id: z.string().uuid(),
  document_type: z.enum(['nfe', 'nfse', 'nfce', 'cte', 'other']).default('other'),
  number: z.string().trim().min(1).max(60),
  series: z.string().trim().max(20).optional().or(z.literal('')),
  access_key: z
    .string()
    .trim()
    .regex(/^\d{44}$/, 'Chave de acesso deve ter 44 dígitos')
    .optional()
    .or(z.literal('')),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data ISO YYYY-MM-DD'),
  competence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  issuer_document: z.string().trim().min(11).max(20),
  issuer_name: z.string().trim().min(1).max(255),
  recipient_document: z.string().trim().min(11).max(20),
  recipient_name: z.string().trim().max(255).optional().or(z.literal('')),
  total_amount: z.coerce.number().positive(),
  description: z.string().max(500).optional().or(z.literal('')),
});

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
  if (!profile || profile.role !== 'supplier') {
    return Response.json({ error: 'Acesso restrito a fornecedores' }, { status: 403 });
  }

  const { data: supplier } = await supabase
    .from('business_partners')
    .select('id, group_id, document')
    .eq('supplier_user_id', user.id)
    .maybeSingle();
  if (!supplier) {
    return Response.json({ error: 'Fornecedor não vinculado' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 });
  }

  const xmlFile = formData.get('xml');
  const pdfFile = formData.get('pdf');
  const dataRaw = formData.get('data');

  if (!(xmlFile instanceof File) && !(pdfFile instanceof File)) {
    return Response.json(
      { error: 'Envie ao menos um arquivo (XML ou PDF).' },
      { status: 400 },
    );
  }
  if (typeof dataRaw !== 'string') {
    return Response.json({ error: 'Campo `data` (JSON) ausente' }, { status: 400 });
  }

  let parsedData: z.infer<typeof DataSchema>;
  try {
    parsedData = DataSchema.parse(JSON.parse(dataRaw));
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : err instanceof Error
          ? err.message
          : 'JSON inválido';
    return Response.json({ error: `Campos inválidos: ${msg}` }, { status: 400 });
  }

  // Valida tamanho dos arquivos
  for (const f of [xmlFile, pdfFile]) {
    if (f instanceof File && f.size > MAX_BYTES) {
      return Response.json({ error: `Arquivo > 10MB: ${f.name}` }, { status: 413 });
    }
  }

  // Valida que organização pertence ao mesmo grupo do fornecedor (segurança)
  const admin = getAdminClient();
  const { data: org } = await admin
    .from('organizations')
    .select('id, cnpj, parent_id, type, legal_name')
    .eq('id', parsedData.organization_id)
    .maybeSingle();
  if (!org) return Response.json({ error: 'Filial não encontrada' }, { status: 404 });

  // CNPJ destinatário deve bater com o CNPJ da filial selecionada
  const orgCnpjDigits = String(org.cnpj ?? '').replace(/\D/g, '');
  const recipientCnpjDigits = String(parsedData.recipient_document).replace(/\D/g, '');
  if (!orgCnpjDigits || orgCnpjDigits !== recipientCnpjDigits) {
    return Response.json(
      {
        error: 'CNPJ destinatário não corresponde à filial selecionada',
        expected: orgCnpjDigits || null,
        received: recipientCnpjDigits,
        _v: 'portal-route-2026-05-23',
      },
      { status: 400 },
    );
  }

  const docId = randomUUID();
  const supplierFolder = supplier.id;
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;

  // Sobe arquivos
  try {
    if (xmlFile instanceof File && xmlFile.size > 0) {
      xmlPath = `${supplierFolder}/${docId}/${safeName(xmlFile.name)}`;
      const buf = Buffer.from(await xmlFile.arrayBuffer());
      const { error } = await admin.storage
        .from('fiscal-documents')
        .upload(xmlPath, buf, {
          contentType: xmlFile.type || 'text/xml',
          upsert: false,
        });
      if (error) throw new Error(`Upload XML: ${error.message}`);
    }
    if (pdfFile instanceof File && pdfFile.size > 0) {
      pdfPath = `${supplierFolder}/${docId}/${safeName(pdfFile.name)}`;
      const buf = Buffer.from(await pdfFile.arrayBuffer());
      const { error } = await admin.storage
        .from('fiscal-documents')
        .upload(pdfPath, buf, {
          contentType: pdfFile.type || 'application/pdf',
          upsert: false,
        });
      if (error) throw new Error(`Upload PDF: ${error.message}`);
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erro no upload' },
      { status: 500 },
    );
  }

  // Insere fiscal_documents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc, error: insertErr } = await (admin as any)
    .from('fiscal_documents')
    .insert({
      id: docId,
      organization_id: parsedData.organization_id,
      direction: 'inbound',
      document_type: parsedData.document_type,
      access_key: parsedData.access_key || null,
      number: parsedData.number,
      series: parsedData.series || null,
      issue_date: parsedData.issue_date,
      competence_date: parsedData.competence_date || parsedData.issue_date,
      issuer_document: String(parsedData.issuer_document).replace(/\D/g, ''),
      issuer_name: parsedData.issuer_name,
      recipient_document: recipientCnpjDigits,
      recipient_name: parsedData.recipient_name || org.legal_name,
      total_amount: parsedData.total_amount,
      xml_storage_path: xmlPath,
      pdf_storage_path: pdfPath,
      source: 'supplier_portal',
      status: 'received',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (insertErr) {
    // Tenta limpar arquivos órfãos best-effort
    const paths = [xmlPath, pdfPath].filter(Boolean) as string[];
    if (paths.length) await admin.storage.from('fiscal-documents').remove(paths);
    return Response.json({ error: `Erro ao gravar NF: ${insertErr.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, id: doc.id, _v: 'portal-route-2026-05-23' });
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 200);
}
