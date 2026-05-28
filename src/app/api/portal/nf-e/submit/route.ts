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
import { validateUpload } from '@/lib/uploads/safe-upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

// MAX_BYTES agora vem do default em validateUpload() (10MB).

const DataSchema = z.object({
  // organization_id removido: o sistema acha a filial pelo CNPJ
  // destinatário (mais robusto — não depende do supplier.group_id
  // estar apontando pra filial certa).
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

  // Valida arquivos: tamanho + magic bytes vs MIME + antivírus
  let xmlSafe: Awaited<ReturnType<typeof validateUpload>> | null = null;
  let pdfSafe: Awaited<ReturnType<typeof validateUpload>> | null = null;
  if (xmlFile instanceof File && xmlFile.size > 0) {
    xmlSafe = await validateUpload(xmlFile, { allowedTypes: ['xml'] });
    if (!xmlSafe.ok) {
      return Response.json({ error: `XML rejeitado: ${xmlSafe.error}` }, { status: 400 });
    }
  }
  if (pdfFile instanceof File && pdfFile.size > 0) {
    pdfSafe = await validateUpload(pdfFile, { allowedTypes: ['pdf'] });
    if (!pdfSafe.ok) {
      return Response.json({ error: `PDF rejeitado: ${pdfSafe.error}` }, { status: 400 });
    }
  }

  // Acha a filial Maxfem pelo CNPJ destinatário (NF foi pra essa CNPJ).
  // Aceita company (matriz) ou branch (filial). O grupo (type='group')
  // não tem CNPJ — então nunca casa, o que está correto.
  const admin = getAdminClient();
  const recipientCnpjDigits = String(parsedData.recipient_document).replace(/\D/g, '');
  if (!recipientCnpjDigits) {
    return Response.json(
      { error: 'CNPJ destinatário ausente nos dados confirmados' },
      { status: 400 },
    );
  }
  const { data: org } = await admin
    .from('organizations')
    .select('id, cnpj, parent_id, type, legal_name')
    .eq('cnpj', recipientCnpjDigits)
    .in('type', ['company', 'branch'])
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) {
    return Response.json(
      {
        error:
          'Filial não encontrada para esse CNPJ destinatário. Confirme se o CNPJ está correto ou contate o financeiro Maxfem pra cadastrar a filial.',
        cnpj: recipientCnpjDigits,
        _v: 'portal-route-2026-05-23-lookup-by-cnpj',
      },
      { status: 404 },
    );
  }

  // Cross-group guard: o supplier está vinculado a UM grupo (supplier.group_id).
  // A org destinatária precisa pertencer a esse mesmo grupo. Sem isso, supplier
  // cadastrado em A poderia submeter NF que cai no grupo B passando outro CNPJ.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgGroupId } = await (admin as any).rpc('resolve_group_id', {
    p_organization_id: org.id,
  });
  if (orgGroupId !== supplier.group_id) {
    return Response.json(
      {
        error:
          'Você não tem permissão pra enviar NF-e para essa empresa. Verifique se está logado na conta correta do portal.',
      },
      { status: 403 },
    );
  }

  const docId = randomUUID();
  const supplierFolder = supplier.id;
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;

  // Sobe arquivos — buffer + mimeType vêm de validateUpload acima
  try {
    if (xmlSafe?.ok && xmlFile instanceof File) {
      xmlPath = `${supplierFolder}/${docId}/${safeName(xmlFile.name)}`;
      const { error } = await admin.storage
        .from('fiscal-documents')
        .upload(xmlPath, xmlSafe.buffer, {
          contentType: xmlSafe.mimeType,
          upsert: false,
        });
      if (error) throw new Error(`Upload XML: ${error.message}`);
    }
    if (pdfSafe?.ok && pdfFile instanceof File) {
      pdfPath = `${supplierFolder}/${docId}/${safeName(pdfFile.name)}`;
      const { error } = await admin.storage
        .from('fiscal-documents')
        .upload(pdfPath, pdfSafe.buffer, {
          contentType: pdfSafe.mimeType,
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
      organization_id: org.id,
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

  // Conflito 23505 (unique constraint) = NF JÁ está no sistema (típico:
  // chegou via Focus NFe antes do fornecedor mandar pelo portal). Em vez
  // de erro, mergamos: anexamos o XML/PDF do fornecedor no registro
  // existente e devolvemos sucesso com flag `alreadyExisted`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((insertErr as any)?.code === '23505' && parsedData.access_key) {
    const { data: existing } = await admin
      .from('fiscal_documents')
      .select('id, source, status, xml_storage_path, pdf_storage_path')
      .eq('organization_id', org.id)
      .eq('access_key', parsedData.access_key)
      .maybeSingle();
    if (existing) {
      // Só sobrescreve se o existente NÃO tinha o arquivo (não destrói anexo prévio)
      const update: { xml_storage_path?: string; pdf_storage_path?: string } = {};
      if (xmlPath && !existing.xml_storage_path) update.xml_storage_path = xmlPath;
      if (pdfPath && !existing.pdf_storage_path) update.pdf_storage_path = pdfPath;
      if (Object.keys(update).length > 0) {
        await admin.from('fiscal_documents').update(update).eq('id', existing.id);
      } else {
        // Não precisa atualizar — descarta os uploads
        const paths = [xmlPath, pdfPath].filter(Boolean) as string[];
        if (paths.length) await admin.storage.from('fiscal-documents').remove(paths);
      }
      return Response.json({
        ok: true,
        id: existing.id,
        alreadyExisted: true,
        prevSource: existing.source,
        prevStatus: existing.status,
        merged: Object.keys(update),
        _v: 'portal-route-2026-05-23-merge',
      });
    }
  }

  if (insertErr) {
    // Tenta limpar arquivos órfãos best-effort
    const paths = [xmlPath, pdfPath].filter(Boolean) as string[];
    if (paths.length) await admin.storage.from('fiscal-documents').remove(paths);
    return Response.json({ error: `Erro ao gravar NF: ${insertErr.message}` }, { status: 500 });
  }

  return Response.json({ ok: true, id: doc.id, _v: 'portal-route-2026-05-23-merge' });
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_').slice(0, 200);
}
