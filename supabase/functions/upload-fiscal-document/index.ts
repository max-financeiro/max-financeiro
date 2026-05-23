/**
 * upload-fiscal-document/index.ts
 * Edge Function para upload de NF-e do portal fornecedor.
 *
 * Fluxo:
 * 1. Valida auth (role = supplier)
 * 2. Rate limit (50 uploads/h)
 * 3. Idempotency check
 * 4. Parse XML NF-e (anti-XXE)
 * 5. Valida CNPJ destinatário == filial selecionada
 * 6. Upload pro Storage (XML + PDF opcional)
 * 7. Insere fiscal_document + items
 * 8. Atualiza status pra 'validated' (trigger cria CAP)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseNFe } from '../_shared/nfe-parser.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // Role check: só supplier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'supplier') {
    return jsonResponse({ error: 'Forbidden: supplier role required' }, 403);
  }

  // Idempotency check
  const idempotencyKey = req.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return jsonResponse({ error: 'Idempotency-Key header required' }, 400);
  }

  const idempotencyClaim = await checkIdempotency(supabase, idempotencyKey, user.id);
  if (idempotencyClaim.status === 'duplicate') {
    return jsonResponse({ error: 'Request in progress' }, 409);
  }
  if (idempotencyClaim.status === 'completed') {
    return jsonResponse(
      idempotencyClaim.responseBody,
      idempotencyClaim.responseStatus!,
    );
  }

  try {
    // Rate limit
    const rateLimitCheck = await checkRateLimit(supabase, `nf_upload:${user.id}`, 50, 3600);
    if (!rateLimitCheck.allowed) {
      const response = { error: 'Rate limit exceeded', remainingRequests: 0 };
      await storeIdempotencyResponse(supabase, idempotencyKey, 429, response);
      return jsonResponse(response, 429);
    }

    // Parse multipart/form-data
    const formData = await req.formData();
    const xmlFile = formData.get('xml') as File;
    const pdfFile = formData.get('pdf') as File | null;
    const organizationId = formData.get('organization_id') as string;

    if (!xmlFile || !organizationId) {
      const response = { error: 'Missing required fields: xml, organization_id' };
      await storeIdempotencyResponse(supabase, idempotencyKey, 400, response);
      return jsonResponse(response, 400);
    }

    // Parse XML
    const xmlBuffer = new Uint8Array(await xmlFile.arrayBuffer());
    const parsed = await parseNFe(xmlBuffer);

    // Validação: CNPJ destinatário == organização selecionada
    // Normaliza ambos pra só dígitos antes de comparar (org pode ter máscara)
    const { data: org } = await supabase
      .from('organizations')
      .select('cnpj')
      .eq('id', organizationId)
      .maybeSingle();

    // Belt-and-suspenders: parser ja devolve string desde 75fd5cb, mas
    // String() aqui blinda contra qualquer regressao downstream.
    const orgCnpjDigits = String(org?.cnpj ?? '').replace(/\D/g, '');
    const recipientCnpjDigits = String(parsed.recipient.document ?? '').replace(/\D/g, '');

    if (!org || !orgCnpjDigits || orgCnpjDigits !== recipientCnpjDigits) {
      const response = {
        error: 'CNPJ destinatário não corresponde à filial selecionada',
        expected: orgCnpjDigits || null,
        received: recipientCnpjDigits,
        _v: 'edge-2026-05-23-string-coerce',
      };
      await storeIdempotencyResponse(supabase, idempotencyKey, 400, response);
      return jsonResponse(response, 400);
    }

    // Upload XML pro Storage
    const supplierId = await getSupplierId(supabase, user.id);
    const docId = crypto.randomUUID();
    const xmlPath = `${supplierId}/${docId}/${xmlFile.name}`;

    const { error: xmlUploadError } = await supabase.storage
      .from('fiscal-documents')
      .upload(xmlPath, xmlBuffer, {
        contentType: xmlFile.type || 'text/xml',
        upsert: false,
      });

    if (xmlUploadError) {
      throw new Error(`Erro ao fazer upload do XML: ${xmlUploadError.message}`);
    }

    // Upload PDF (se presente)
    let pdfPath: string | null = null;
    if (pdfFile) {
      pdfPath = `${supplierId}/${docId}/${pdfFile.name}`;
      const pdfBuffer = new Uint8Array(await pdfFile.arrayBuffer());
      const { error: pdfUploadError } = await supabase.storage
        .from('fiscal-documents')
        .upload(pdfPath, pdfBuffer, {
          contentType: pdfFile.type || 'application/pdf',
          upsert: false,
        });

      if (pdfUploadError) {
        throw new Error(`Erro ao fazer upload do PDF: ${pdfUploadError.message}`);
      }
    }

    // Insere fiscal_document (status = received)
    const { data: fiscalDoc, error: insertError } = await supabase
      .from('fiscal_documents')
      .insert({
        id: docId,
        organization_id: organizationId,
        direction: 'inbound',
        document_type: 'nfe',
        access_key: parsed.accessKey,
        number: parsed.number,
        series: parsed.series,
        issue_date: parsed.issueDate.toISOString().split('T')[0],
        competence_date: parsed.issueDate.toISOString().split('T')[0],
        issuer_document: parsed.issuer.document,
        issuer_name: parsed.issuer.name,
        recipient_document: parsed.recipient.document,
        recipient_name: parsed.recipient.name,
        total_amount: parsed.totalAmount,
        xml_storage_path: xmlPath,
        pdf_storage_path: pdfPath,
        source: 'supplier_portal',
        status: 'received',
        extracted_data: parsed.rawData,
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Erro ao criar registro da NF: ${insertError.message}`);
    }

    // Insere items
    const items = parsed.items.map((item, idx) => ({
      fiscal_document_id: docId,
      line_number: idx + 1,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
    }));

    const { error: itemsError } = await supabase
      .from('fiscal_document_items')
      .insert(items);

    if (itemsError) {
      throw new Error(`Erro ao inserir itens da NF: ${itemsError.message}`);
    }

    // Atualiza status pra 'validated' (trigger vai criar CAP automaticamente)
    const { error: updateError } = await supabase
      .from('fiscal_documents')
      .update({ status: 'validated' })
      .eq('id', docId);

    if (updateError) {
      throw new Error(`Erro ao validar NF: ${updateError.message}`);
    }

    // Sucesso
    const response = {
      success: true,
      fiscalDocumentId: docId,
      accessKey: parsed.accessKey,
      number: parsed.number,
      totalAmount: parsed.totalAmount,
    };

    await storeIdempotencyResponse(supabase, idempotencyKey, 201, response);
    return jsonResponse(response, 201);
  } catch (error: any) {
    const response = { error: error.message };
    await storeIdempotencyResponse(supabase, idempotencyKey, 500, response);
    return jsonResponse(response, 500);
  }
});

// Helpers
function jsonResponse(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getSupplierId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('business_partners')
    .select('id')
    .eq('supplier_user_id', userId)
    .maybeSingle();

  if (!data) throw new Error('Fornecedor não encontrado');
  return data.id;
}

async function checkRateLimit(
  supabase: any,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  try {
    const { data } = await supabase.rpc('check_rate_limit', {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    return { allowed: data?.allowed ?? true };
  } catch {
    return { allowed: true }; // fail-open
  }
}

async function checkIdempotency(
  supabase: any,
  key: string,
  userId: string,
): Promise<{
  status: 'claimed' | 'duplicate' | 'completed';
  responseStatus?: number;
  responseBody?: any;
}> {
  try {
    const { data } = await supabase.rpc('claim_idempotency_key', {
      p_key: key,
      p_user_id: userId,
      p_endpoint: 'upload-fiscal-document',
    });

    return {
      status: data?.status ?? 'claimed',
      responseStatus: data?.response_status,
      responseBody: data?.response_body,
    };
  } catch {
    return { status: 'claimed' }; // fail-open
  }
}

async function storeIdempotencyResponse(
  supabase: any,
  key: string,
  status: number,
  body: any,
): Promise<void> {
  try {
    await supabase.rpc('store_idempotency_response', {
      p_key: key,
      p_response_status: status,
      p_response_body: body,
    });
  } catch {
    // silent fail
  }
}
