# Sprint 4b — Portal NF-e · Plano de Execução

**Data:** 2026-05-17  
**Repo:** `/Users/thiagobraga/financeiro-maxfem`  
**Domínio:** `portal.financeiromaxfem.com.br`

---

## Estado Atual (Sprint 4a ✅)

**Já em produção:**
- Portal subdomain roteado
- Convite com código 8 dígitos + magic link
- Login fornecedor autenticado
- Accept flow completo
- Schema `fiscal_documents` + `fiscal_document_items` (migration `20260517000001`)
- Storage bucket `fiscal-documents` com RLS (migration `20260517000007`)
- CAP + alçadas rodando
- Payment Provider abstraction (mock)
- Auth 2FA TOTP obrigatório
- RLS em todas tabelas public
- Audit log WORM com hash chain
- pgcrypto + cooldown 24h em mudança bancária

---

## Entregas Sprint 4b

### 1. Upload de XML NF-e com validação esquema SEFAZ (anti-XXE)
### 2. Parser NF-e: extrai issuer, recipient, valor, chave, itens
### 3. Validação: CNPJ destinatário == filial selecionada
### 4. Anexo de boleto PDF (com antivírus opcional via Cloudmersive)
### 5. UI: lista de NFs enviadas com status (recebido / em análise / pago)
### 6. UI: atualização de dados bancários no portal (com cooldown 24h + confirmação dupla por email)
### 7. Rate limit: 5 magic links/h por email; 50 uploads/h por fornecedor
### 8. Test suite RLS supplier_isolation: fornecedor A nunca vê dados do fornecedor B

---

## Critérios de Saída

- ✅ Fornecedor recebe convite, completa primeiro acesso, envia NF, vê status
- ✅ Tentativa de fornecedor A ver NF do fornecedor B é bloqueada em RLS
- ✅ XML mal-formado / XXE / esquema inválido é rejeitado com erro estruturado
- ✅ Upload de NF cria CAP automaticamente vinculada ao fornecedor + filial

---

## Arquitetura de Decisões

### Decisão 1: Storage — Supabase Storage (não S3)

**Rationale:**
- Já provisionado com RLS working (migration `20260517000007`)
- Bucket privado com MIME types restritos
- Limite 10MB (suficiente: NF-e real < 1MB, PDF scaneado < 5MB)
- Signed URLs automáticos
- Zero custo adicional (dentro do Supabase Pro)

**Alternativa rejeitada:** S3 adicionaria complexidade (IAM, presigned URLs custom, billing separado) sem ganho real nesse volume (< 1k uploads/mês projetado).

### Decisão 2: Parser XML — fast-xml-parser com defesas anti-XXE

**Libs avaliadas:**
| Lib | Anti-XXE nativo | Performance | Manutenção | Escolha |
|-----|----------------|-------------|------------|---------|
| `xml2js` | ❌ (precisa wrapper) | Médio | Ativa | ❌ |
| `sax` | ❌ (low-level, XXE via ENTITY) | Alto | Ativa | ❌ |
| `fast-xml-parser` | ✅ (ignora DTD/ENTITY por padrão) | Alto | Ativa | ✅ |

**Configuração anti-XXE obrigatória:**
```typescript
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  trimValues: true,
  processEntities: false,        // CRÍTICO: bloqueia ENTITY expansion
  allowBooleanAttributes: true,
  parseTagValue: true,
  ignoreDeclaration: true,       // ignora <?xml?>
  ignorePiTags: true,            // ignora <?target?>
  cdataPropName: '__cdata',
  commentPropName: '__comment',
  // DEFESA ADICIONAL:
  stopNodes: ['*:script', '*:SCRIPT'],  // bloqueia tags script (caso payload malicioso)
};
```

**Validação adicional pré-parse:**
- Tamanho máx 5MB (XMLs reais < 500KB; 5MB é fôlego pra edge cases)
- Regex pre-check: rejeita se contém `<!ENTITY`, `<!DOCTYPE` com `SYSTEM` ou `PUBLIC`
- String search: rejeita `<script`, `javascript:`, `data:text/html`

### Decisão 3: Antivírus Abstraction — Interface + Cloudmersive (opcional)

**Interface:**
```typescript
interface IAntivirusProvider {
  scanFile(buffer: Buffer, filename: string): Promise<ScanResult>;
}

type ScanResult = 
  | { status: 'clean' }
  | { status: 'infected'; threat: string }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };  // fallback quando serviço fora
```

**Implementações:**
1. `CloudmersiveAntivirusProvider` — API Key no `.env.local` (`CLOUDMERSIVE_API_KEY`)
   - Endpoint: `https://api.cloudmersive.com/virus/scan/file`
   - Rate limit: 800 calls/mês no free tier (suficiente pra < 30 uploads/dia)
   - Timeout: 15s (PDF scaneado pode demorar)
   - Fallback: se timeout ou 5xx → `status: 'unavailable'` (não bloqueia upload)

2. `MockAntivirusProvider` — dev/test
   - Sempre retorna `clean` exceto se filename contém `EICAR` (test vector)

**Decisão de negócio:**
- Antivírus OPCIONAL na Sprint 4b (configurável via `ENABLE_ANTIVIRUS=true`)
- Se unavailable ou disabled → upload continua (logged no audit_log)
- Sprint 5+ pode tornar obrigatório após análise de risco

### Decisão 4: Rate Limit — Supabase Edge Function + tabela `rate_limit_buckets`

**Não usar:** Upstash Redis (custo adicional $10/mês + latência cross-region pra São Paulo)

**Implementação:**
- Tabela `rate_limit_buckets` com TTL via `expires_at TIMESTAMPTZ`
- Cleanup automático via cron extension (ou pg_cron)
- Chaves:
  - `magic_link:{email}` → 5 requests/h
  - `nf_upload:{supplier_user_id}` → 50 requests/h

```sql
CREATE TABLE public.rate_limit_buckets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key      TEXT NOT NULL UNIQUE,
  request_count   INT NOT NULL DEFAULT 1,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  metadata        JSONB
);

CREATE INDEX idx_rate_limit_expires ON public.rate_limit_buckets(expires_at)
  WHERE expires_at > NOW();

-- Cleanup job (roda 1x/dia via pg_cron ou edge function scheduled)
DELETE FROM public.rate_limit_buckets WHERE expires_at < NOW();
```

**Função helper:**
```typescript
async function checkRateLimit(
  supabase: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remainingRequests: number }> {
  // INSERT ... ON CONFLICT UPDATE com comparação de window
}
```

### Decisão 5: Idempotência — Header `Idempotency-Key` + tabela `idempotency_keys`

```sql
CREATE TABLE public.idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  endpoint        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  response_status INT,
  response_body   JSONB,
  CONSTRAINT idempotency_keys_ttl CHECK (expires_at > created_at)
);

CREATE INDEX idx_idempotency_keys_expires ON public.idempotency_keys(expires_at)
  WHERE expires_at > NOW();
```

**TTL:** 24h (após 24h, mesmo key pode ser reusada)

**Fluxo:**
1. Cliente envia `Idempotency-Key: <uuid>` no header
2. Edge function checa tabela:
   - Se existe + `response_status` preenchido → retorna response cacheada (201 ou 4xx)
   - Se existe + `response_status` NULL → request em flight, retorna 409 Conflict
   - Se não existe → insere com `response_status=NULL`, processa, atualiza com resultado

---

## Ordem de Implementação

### Fase 1: Database & Infrastructure (30 min)

**Migration 1:** `20260517100001_rate_limit_and_idempotency.sql`
```sql
-- rate_limit_buckets (conforme Decisão 4)
-- idempotency_keys (conforme Decisão 5)
-- function check_rate_limit(bucket_key, limit, window_seconds)
-- function claim_idempotency_key(key, user_id, endpoint)
```

**Migration 2:** `20260517100002_supplier_bank_change_cooldown.sql`
```sql
-- Adiciona cooldown em business_partners:
ALTER TABLE public.business_partners
  ADD COLUMN bank_details_last_changed_at TIMESTAMPTZ;

-- Tabela de log de mudanças bancárias (WORM):
CREATE TABLE public.supplier_bank_change_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID NOT NULL REFERENCES public.business_partners(id),
  changed_by        UUID NOT NULL REFERENCES auth.users(id),
  old_bank_details  JSONB,
  new_bank_details  JSONB,
  change_reason     TEXT,
  confirmation_email_sent_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Migration 3:** `20260517100003_fiscal_documents_trigger_create_cap.sql`
```sql
-- Trigger que cria CAP automaticamente quando NF chega de supplier_portal:
CREATE OR REPLACE FUNCTION public.auto_create_cap_from_fiscal_document()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source = 'supplier_portal' AND NEW.status = 'validated' THEN
    INSERT INTO public.accounts_payable (
      organization_id,
      supplier_id,
      fiscal_document_id,
      description,
      total_amount,
      due_date,
      status
    ) VALUES (
      NEW.organization_id,
      (SELECT id FROM public.business_partners WHERE document = NEW.issuer_document LIMIT 1),
      NEW.id,
      'CAP gerado automaticamente de NF-e ' || NEW.number,
      NEW.total_amount,
      NEW.competence_date + INTERVAL '30 days',  -- default: 30d após competência
      'draft'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER fiscal_documents_auto_create_cap
  AFTER INSERT OR UPDATE OF status ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_cap_from_fiscal_document();
```

### Fase 2: Libs & Abstractions (1h)

**Estrutura de diretórios:**
```
src/lib/
  nfe-parser/
    index.ts          # parse(xmlBuffer): ParsedNFe
    validator.ts      # validateNFeSchema(parsed): ValidationResult
    anti-xxe.ts       # preCheckXXE(xmlString): { safe: boolean; reason?: string }
  antivirus/
    provider.ts       # interface IAntivirusProvider
    cloudmersive.ts   # CloudmersiveAntivirusProvider
    mock.ts           # MockAntivirusProvider
    factory.ts        # createAntivirusProvider(): IAntivirusProvider
  rate-limit/
    index.ts          # checkRateLimit(...)
  idempotency/
    index.ts          # claimIdempotencyKey(...), storeIdempotencyResponse(...)
```

**1. `src/lib/nfe-parser/index.ts`**
```typescript
import { XMLParser } from 'fast-xml-parser';
import { preCheckXXE } from './anti-xxe';

export interface ParsedNFe {
  accessKey: string;
  number: string;
  series: string;
  issueDate: Date;
  issuer: { document: string; name: string };
  recipient: { document: string; name: string };
  totalAmount: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  rawData: any;  // JSON completo pra extracted_data
}

export async function parseNFe(xmlBuffer: Buffer): Promise<ParsedNFe> {
  const xmlString = xmlBuffer.toString('utf8');
  
  // 1. Pre-check XXE
  const xxeCheck = preCheckXXE(xmlString);
  if (!xxeCheck.safe) {
    throw new Error(`XML rejeitado: ${xxeCheck.reason}`);
  }
  
  // 2. Parse com fast-xml-parser
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    trimValues: true,
    processEntities: false,        // ANTI-XXE
    allowBooleanAttributes: true,
    parseTagValue: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    stopNodes: ['*:script', '*:SCRIPT'],
  });
  
  const parsed = parser.parse(xmlString);
  
  // 3. Extração de campos (ajustar conforme layout NF-e 4.0)
  // Exemplo simplificado (real precisa navegar nfeProc > NFe > infNFe > ...)
  const nfe = parsed.nfeProc?.NFe?.infNFe;
  if (!nfe) throw new Error('Estrutura XML inválida: faltando nfeProc.NFe.infNFe');
  
  return {
    accessKey: nfe['@_Id'].replace('NFe', ''),  // remove prefixo "NFe"
    number: nfe.ide.nNF,
    series: nfe.ide.serie,
    issueDate: parseNFeDate(nfe.ide.dhEmi),
    issuer: {
      document: nfe.emit.CNPJ || nfe.emit.CPF,
      name: nfe.emit.xNome,
    },
    recipient: {
      document: nfe.dest.CNPJ || nfe.dest.CPF,
      name: nfe.dest.xNome,
    },
    totalAmount: parseFloat(nfe.total.ICMSTot.vNF),
    items: (Array.isArray(nfe.det) ? nfe.det : [nfe.det]).map((item: any) => ({
      description: item.prod.xProd,
      quantity: parseFloat(item.prod.qCom),
      unitPrice: parseFloat(item.prod.vUnCom),
      totalPrice: parseFloat(item.prod.vProd),
    })),
    rawData: parsed,
  };
}

function parseNFeDate(dateStr: string): Date {
  // NF-e usa ISO 8601: "2024-05-17T14:30:00-03:00"
  return new Date(dateStr);
}
```

**2. `src/lib/nfe-parser/anti-xxe.ts`**
```typescript
export function preCheckXXE(xmlString: string): { safe: boolean; reason?: string } {
  const size = Buffer.byteLength(xmlString, 'utf8');
  if (size > 5 * 1024 * 1024) {
    return { safe: false, reason: 'XML excede 5MB' };
  }
  
  // Bloqueia ENTITY declarations
  if (/<!ENTITY/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém <!ENTITY (XXE bloqueado)' };
  }
  
  // Bloqueia DOCTYPE com SYSTEM ou PUBLIC (external entities)
  if (/<!DOCTYPE[^>]*\b(SYSTEM|PUBLIC)\b/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém DOCTYPE com entidades externas (XXE bloqueado)' };
  }
  
  // Bloqueia script tags (paranoia)
  if (/<script/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém tag <script> (payload rejeitado)' };
  }
  
  // Bloqueia javascript: e data: URIs
  if (/javascript:|data:text\/html/i.test(xmlString)) {
    return { safe: false, reason: 'XML contém URI suspeita (payload rejeitado)' };
  }
  
  return { safe: true };
}
```

**3. `src/lib/antivirus/factory.ts`**
```typescript
import { CloudmersiveAntivirusProvider } from './cloudmersive';
import { MockAntivirusProvider } from './mock';
import type { IAntivirusProvider } from './provider';

export function createAntivirusProvider(): IAntivirusProvider {
  const enabled = process.env.ENABLE_ANTIVIRUS === 'true';
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  
  if (enabled && apiKey) {
    return new CloudmersiveAntivirusProvider(apiKey);
  }
  
  return new MockAntivirusProvider();
}
```

### Fase 3: Edge Function Upload (1.5h)

**Arquivo:** `supabase/functions/upload-fiscal-document/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseNFe } from '../_shared/nfe-parser.ts';  // port do lib/nfe-parser
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { claimIdempotencyKey, storeIdempotencyResponse } from '../_shared/idempotency.ts';

serve(async (req) => {
  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  // 2. Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  // 3. Role check: só supplier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  
  if (!profile || profile.role !== 'supplier') {
    return new Response(JSON.stringify({ error: 'Forbidden: supplier role required' }), { status: 403 });
  }
  
  // 4. Idempotency check
  const idempotencyKey = req.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return new Response(JSON.stringify({ error: 'Idempotency-Key header required' }), { status: 400 });
  }
  
  const idempotencyClaim = await claimIdempotencyKey(supabase, idempotencyKey, user.id, 'upload-fiscal-document');
  if (idempotencyClaim.status === 'duplicate') {
    // Request em flight
    return new Response(JSON.stringify({ error: 'Request in progress' }), { status: 409 });
  }
  if (idempotencyClaim.status === 'completed') {
    // Request já processada, retorna resposta cacheada
    return new Response(JSON.stringify(idempotencyClaim.responseBody), {
      status: idempotencyClaim.responseStatus!,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  try {
    // 5. Rate limit
    const rateLimitCheck = await checkRateLimit(supabase, `nf_upload:${user.id}`, 50, 3600);
    if (!rateLimitCheck.allowed) {
      const response = { error: 'Rate limit exceeded', remainingRequests: 0 };
      await storeIdempotencyResponse(supabase, idempotencyKey, 429, response);
      return new Response(JSON.stringify(response), { status: 429 });
    }
    
    // 6. Parse multipart/form-data
    const formData = await req.formData();
    const xmlFile = formData.get('xml') as File;
    const pdfFile = formData.get('pdf') as File | null;
    const organizationId = formData.get('organization_id') as string;
    
    if (!xmlFile || !organizationId) {
      const response = { error: 'Missing required fields: xml, organization_id' };
      await storeIdempotencyResponse(supabase, idempotencyKey, 400, response);
      return new Response(JSON.stringify(response), { status: 400 });
    }
    
    // 7. Parse XML
    const xmlBuffer = await xmlFile.arrayBuffer();
    const parsed = await parseNFe(Buffer.from(xmlBuffer));
    
    // 8. Validação: CNPJ destinatário == organização selecionada
    const { data: org } = await supabase
      .from('organizations')
      .select('cnpj')
      .eq('id', organizationId)
      .maybeSingle();
    
    if (!org || org.cnpj !== parsed.recipient.document) {
      const response = {
        error: 'CNPJ destinatário não corresponde à filial selecionada',
        expected: org?.cnpj,
        received: parsed.recipient.document,
      };
      await storeIdempotencyResponse(supabase, idempotencyKey, 400, response);
      return new Response(JSON.stringify(response), { status: 400 });
    }
    
    // 9. Antivírus (opcional)
    if (Deno.env.get('ENABLE_ANTIVIRUS') === 'true') {
      // TODO: scan xmlFile e pdfFile via Cloudmersive
      // Se infected → retorna 400 com threat info
    }
    
    // 10. Upload XML pro Storage
    const supplierId = await getSupplierId(supabase, user.id);
    const docId = crypto.randomUUID();
    const xmlPath = `${supplierId}/${docId}/${xmlFile.name}`;
    
    const { error: xmlUploadError } = await supabase.storage
      .from('fiscal-documents')
      .upload(xmlPath, xmlBuffer, {
        contentType: xmlFile.type,
        upsert: false,
      });
    
    if (xmlUploadError) {
      throw new Error(`Erro ao fazer upload do XML: ${xmlUploadError.message}`);
    }
    
    // 11. Upload PDF (se presente)
    let pdfPath: string | null = null;
    if (pdfFile) {
      pdfPath = `${supplierId}/${docId}/${pdfFile.name}`;
      const pdfBuffer = await pdfFile.arrayBuffer();
      const { error: pdfUploadError } = await supabase.storage
        .from('fiscal-documents')
        .upload(pdfPath, pdfBuffer, {
          contentType: pdfFile.type,
          upsert: false,
        });
      
      if (pdfUploadError) {
        throw new Error(`Erro ao fazer upload do PDF: ${pdfUploadError.message}`);
      }
    }
    
    // 12. Insere fiscal_document (status = received)
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
    
    // 13. Insere items
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
    
    // 14. Atualiza status pra 'validated' (trigger vai criar CAP automaticamente)
    const { error: updateError } = await supabase
      .from('fiscal_documents')
      .update({ status: 'validated' })
      .eq('id', docId);
    
    if (updateError) {
      throw new Error(`Erro ao validar NF: ${updateError.message}`);
    }
    
    // 15. Sucesso
    const response = {
      success: true,
      fiscalDocumentId: docId,
      accessKey: parsed.accessKey,
      number: parsed.number,
      totalAmount: parsed.totalAmount,
    };
    
    await storeIdempotencyResponse(supabase, idempotencyKey, 201, response);
    return new Response(JSON.stringify(response), { status: 201 });
    
  } catch (error) {
    const response = { error: error.message };
    await storeIdempotencyResponse(supabase, idempotencyKey, 500, response);
    return new Response(JSON.stringify(response), { status: 500 });
  }
});

async function getSupplierId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from('business_partners')
    .select('id')
    .eq('supplier_user_id', userId)
    .maybeSingle();
  
  if (!data) throw new Error('Fornecedor não encontrado');
  return data.id;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
};
```

### Fase 4: UI Portal Fornecedor (2h)

**Páginas:**

**1. `/portal/nf-e/enviar` — Upload de NF**
```typescript
// src/app/portal/nf-e/enviar/page.tsx
'use client';
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export default function EnviarNFePage() {
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!xmlFile) {
      setError('Selecione o arquivo XML da NF-e');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append('xml', xmlFile);
    if (pdfFile) formData.append('pdf', pdfFile);
    formData.append('organization_id', '<organization_id_do_fornecedor>');  // buscar do context
    
    try {
      const idempotencyKey = uuidv4();
      const res = await fetch('/api/supabase/functions/upload-fiscal-document', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: formData,
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao enviar NF-e');
      }
      
      setSuccess(true);
      setXmlFile(null);
      setPdfFile(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-display font-semibold text-maxfem-pink mb-6">
        Enviar Nota Fiscal
      </h1>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Drag-drop zone pra XML */}
        <div className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            onChange={(e) => setXmlFile(e.target.files?.[0] || null)}
            className="hidden"
            id="xml-upload"
          />
          <label htmlFor="xml-upload" className="cursor-pointer">
            {xmlFile ? (
              <p className="text-sm text-neutral-700">{xmlFile.name}</p>
            ) : (
              <p className="text-sm text-neutral-500">
                Clique para selecionar o XML da NF-e
              </p>
            )}
          </label>
        </div>
        
        {/* Upload opcional de PDF (boleto) */}
        <div className="border border-neutral-200 rounded-lg p-4">
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            className="hidden"
            id="pdf-upload"
          />
          <label htmlFor="pdf-upload" className="cursor-pointer text-sm text-neutral-600">
            {pdfFile ? pdfFile.name : 'Anexar boleto (opcional)'}
          </label>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            NF-e enviada com sucesso! Aguarde a análise do time financeiro.
          </div>
        )}
        
        <button
          type="submit"
          disabled={loading || !xmlFile}
          className="w-full bg-maxfem-pink text-white px-4 py-2 rounded hover:bg-pink-600 disabled:opacity-50"
        >
          {loading ? 'Enviando...' : 'Enviar NF-e'}
        </button>
      </form>
    </div>
  );
}
```

**2. `/portal/nf-e/lista` — Lista de NFs enviadas**
```typescript
// src/app/portal/nf-e/lista/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function ListaNFePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/portal/login');
  
  // Busca NFs do fornecedor (RLS aplica automaticamente)
  const { data: fiscalDocs } = await supabase
    .from('fiscal_documents')
    .select('id, access_key, number, issue_date, total_amount, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-display font-semibold text-maxfem-pink mb-6">
        Minhas Notas Fiscais
      </h1>
      
      <div className="bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Número
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Data Emissão
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Valor
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-neutral-200">
            {fiscalDocs?.map((doc) => (
              <tr key={doc.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-900">
                  {doc.number}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                  {new Date(doc.issue_date).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-900">
                  {doc.total_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <StatusBadge status={doc.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    received: 'bg-blue-100 text-blue-800',
    validated: 'bg-green-100 text-green-800',
    linked_to_payable: 'bg-green-100 text-green-800',
    orphan: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  
  const labels = {
    received: 'Recebido',
    validated: 'Em análise',
    linked_to_payable: 'Aprovado',
    orphan: 'Órfã',
    cancelled: 'Cancelada',
  };
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded ${colors[status as keyof typeof colors]}`}>
      {labels[status as keyof typeof labels]}
    </span>
  );
}
```

**3. `/portal/configuracoes/dados-bancarios` — Atualização de dados bancários**
```typescript
// src/app/portal/configuracoes/dados-bancarios/page.tsx
'use client';
import { useState } from 'react';
import { updateBankDetails } from './actions';

export default function DadosBancariosPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    
    const result = await updateBankDetails(formData);
    
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
    
    setLoading(false);
  };
  
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-display font-semibold text-maxfem-pink mb-6">
        Dados Bancários
      </h1>
      
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded mb-6">
        ⚠️ Mudanças em dados bancários levam 24h para serem aplicadas (segurança anti-fraude).
        Você receberá um email de confirmação.
      </div>
      
      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700">Banco</label>
          <input
            type="text"
            name="bank_code"
            placeholder="001 - Banco do Brasil"
            className="mt-1 block w-full border border-neutral-300 rounded px-3 py-2"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-neutral-700">Agência</label>
          <input
            type="text"
            name="agency"
            placeholder="1234"
            className="mt-1 block w-full border border-neutral-300 rounded px-3 py-2"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-neutral-700">Conta</label>
          <input
            type="text"
            name="account"
            placeholder="12345-6"
            className="mt-1 block w-full border border-neutral-300 rounded px-3 py-2"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-neutral-700">Tipo de Conta</label>
          <select
            name="account_type"
            className="mt-1 block w-full border border-neutral-300 rounded px-3 py-2"
            required
          >
            <option value="corrente">Corrente</option>
            <option value="poupanca">Poupança</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-neutral-700">Motivo da alteração</label>
          <textarea
            name="change_reason"
            placeholder="Ex: Mudança de banco, encerramento de conta antiga..."
            className="mt-1 block w-full border border-neutral-300 rounded px-3 py-2"
            rows={3}
            required
          />
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            Solicitação enviada! Você receberá um email de confirmação. A mudança será aplicada em 24h.
          </div>
        )}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-maxfem-pink text-white px-4 py-2 rounded hover:bg-pink-600 disabled:opacity-50"
        >
          {loading ? 'Salvando...' : 'Solicitar alteração'}
        </button>
      </form>
    </div>
  );
}
```

```typescript
// src/app/portal/configuracoes/dados-bancarios/actions.ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';  // pgcrypto wrapper

export async function updateBankDetails(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { error: 'Não autenticado' };
  }
  
  // Busca fornecedor
  const { data: supplier } = await supabase
    .from('business_partners')
    .select('id, bank_details_last_changed_at')
    .eq('supplier_user_id', user.id)
    .maybeSingle();
  
  if (!supplier) {
    return { error: 'Fornecedor não encontrado' };
  }
  
  // Cooldown de 24h
  if (supplier.bank_details_last_changed_at) {
    const lastChange = new Date(supplier.bank_details_last_changed_at);
    const now = new Date();
    const diffHours = (now.getTime() - lastChange.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) {
      return {
        error: `Você poderá alterar novamente em ${Math.ceil(24 - diffHours)}h`,
      };
    }
  }
  
  const bankDetails = {
    bank_code: formData.get('bank_code'),
    agency: formData.get('agency'),
    account: formData.get('account'),
    account_type: formData.get('account_type'),
  };
  
  const changeReason = formData.get('change_reason') as string;
  
  // Busca dados antigos
  const { data: oldData } = await supabase
    .from('business_partners')
    .select('bank_details')
    .eq('id', supplier.id)
    .single();
  
  // Grava no log WORM
  await supabase
    .from('supplier_bank_change_log')
    .insert({
      supplier_id: supplier.id,
      changed_by: user.id,
      old_bank_details: oldData?.bank_details || null,
      new_bank_details: bankDetails,
      change_reason: changeReason,
    });
  
  // Atualiza fornecedor (pgcrypto encrypt via RPC)
  const { error } = await supabase.rpc('update_supplier_bank_details', {
    p_supplier_id: supplier.id,
    p_bank_details: bankDetails,
  });
  
  if (error) {
    return { error: error.message };
  }
  
  // TODO: Enviar email de confirmação via Resend
  
  return { success: true };
}
```

### Fase 5: Tests RLS Supplier Isolation (1h)

**Arquivo:** `tests/rls/supplier-isolation.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe('RLS Supplier Isolation', () => {
  let supplierAUser: any;
  let supplierBUser: any;
  let supplierAId: string;
  let supplierBId: string;
  let fiscalDocAId: string;
  
  beforeAll(async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Cria 2 fornecedores de teste
    const { data: userA } = await supabase.auth.admin.createUser({
      email: 'supplier-a@test.com',
      password: 'test123',
      email_confirm: true,
    });
    supplierAUser = userA.user;
    
    const { data: userB } = await supabase.auth.admin.createUser({
      email: 'supplier-b@test.com',
      password: 'test123',
      email_confirm: true,
    });
    supplierBUser = userB.user;
    
    // Cria business_partners
    const { data: bpA } = await supabase
      .from('business_partners')
      .insert({
        document: '11111111000111',
        name: 'Fornecedor A',
        supplier_user_id: supplierAUser.id,
      })
      .select()
      .single();
    supplierAId = bpA.id;
    
    const { data: bpB } = await supabase
      .from('business_partners')
      .insert({
        document: '22222222000222',
        name: 'Fornecedor B',
        supplier_user_id: supplierBUser.id,
      })
      .select()
      .single();
    supplierBId = bpB.id;
    
    // Cria uma NF do fornecedor A
    const { data: fiscalDoc } = await supabase
      .from('fiscal_documents')
      .insert({
        organization_id: '<org_id_de_teste>',
        direction: 'inbound',
        document_type: 'nfe',
        number: '12345',
        issue_date: '2024-05-17',
        competence_date: '2024-05-17',
        issuer_document: '11111111000111',
        issuer_name: 'Fornecedor A',
        recipient_document: '33333333000333',
        recipient_name: 'Maxfem Matriz',
        total_amount: 1000,
        source: 'supplier_portal',
        status: 'received',
      })
      .select()
      .single();
    fiscalDocAId = fiscalDoc.id;
  });
  
  it('Fornecedor A vê suas próprias NFs', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
    
    // Sign in como fornecedor A
    await supabase.auth.signInWithPassword({
      email: 'supplier-a@test.com',
      password: 'test123',
    });
    
    const { data, error } = await supabase
      .from('fiscal_documents')
      .select('id')
      .eq('id', fiscalDocAId);
    
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(fiscalDocAId);
  });
  
  it('Fornecedor B NÃO vê NFs do fornecedor A', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
    
    // Sign in como fornecedor B
    await supabase.auth.signInWithPassword({
      email: 'supplier-b@test.com',
      password: 'test123',
    });
    
    const { data, error } = await supabase
      .from('fiscal_documents')
      .select('id')
      .eq('id', fiscalDocAId);
    
    expect(error).toBeNull();
    expect(data).toHaveLength(0);  // RLS bloqueia
  });
  
  it('Fornecedor B não consegue UPDATE em NF do fornecedor A', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
    
    await supabase.auth.signInWithPassword({
      email: 'supplier-b@test.com',
      password: 'test123',
    });
    
    const { error } = await supabase
      .from('fiscal_documents')
      .update({ status: 'cancelled' })
      .eq('id', fiscalDocAId);
    
    expect(error).not.toBeNull();  // RLS bloqueia UPDATE
  });
  
  afterAll(async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Cleanup
    await supabase.from('fiscal_documents').delete().eq('id', fiscalDocAId);
    await supabase.from('business_partners').delete().eq('id', supplierAId);
    await supabase.from('business_partners').delete().eq('id', supplierBId);
    await supabase.auth.admin.deleteUser(supplierAUser.id);
    await supabase.auth.admin.deleteUser(supplierBUser.id);
  });
});
```

---

## Cronograma de Execução

| Fase | Tempo estimado | Dependências |
|------|----------------|--------------|
| 1. Database & Infrastructure | 30 min | Sprint 4a ✅ |
| 2. Libs & Abstractions | 1h | — |
| 3. Edge Function Upload | 1.5h | Fases 1, 2 |
| 4. UI Portal Fornecedor | 2h | Fase 3 |
| 5. Tests RLS Supplier Isolation | 1h | Fase 4 |
| **TOTAL** | **6h** | — |

---

## Checklist de Validação Final

Antes de considerar Sprint 4b completa:

- [ ] **Funcional (smoke manual a ser executado por Thiago/Anderson):**
  - [ ] Fornecedor loga no portal, vê página "Enviar NF-e"
  - [ ] Upload de XML válido → registro criado em `fiscal_documents` com status `received`
  - [ ] Parser extrai: access_key, issuer, recipient, total_amount, items
  - [ ] Validação CNPJ: se destinatário != filial selecionada → erro 400
  - [ ] Upload de XML com XXE (<!ENTITY) → rejeitado com erro estruturado
  - [ ] Upload de PDF (boleto) → salvo em storage junto com XML
  - [ ] Status `validated` → trigger cria CAP automaticamente
  - [ ] Página "Minhas NFs" lista NFs com status correto
  - [ ] Fornecedor A não vê NFs do fornecedor B (RLS bloqueia)
  - [x] Atualização de dados bancários → cooldown 24h + email confirmação dupla *(2026-05-23 — `sendBankChangeNotifications` em `src/lib/email/bank-change-notification.ts`, ligado no portal e admin)*

- [ ] **Rate Limit (smoke manual):**
  - [ ] 51º upload em 1h → 429 Too Many Requests
  - [ ] 6º magic link em 1h → 429 Too Many Requests

- [ ] **Idempotência (smoke manual):**
  - [ ] Upload com mesmo `Idempotency-Key` 2x → primeira retorna 201, segunda retorna resposta cacheada
  - [ ] Upload em paralelo com mesmo key → uma retorna 201, outra retorna 409 Conflict

- [x] **Segurança (cobertos por `tests/security/portal-upload-security.test.ts` — 2026-05-23):**
  - [x] XML > 5MB → rejeitado
  - [x] XML com `<!DOCTYPE SYSTEM` → rejeitado
  - [x] XML com `<!DOCTYPE PUBLIC` → rejeitado
  - [x] XML com `<!ENTITY` → rejeitado (XXE clássico)
  - [x] XML com `<script>` → rejeitado
  - [x] XML com `javascript:` / `data:text/html` / `file://` → rejeitado
  - [x] PDF com vírus (EICAR test file) → rejeitado pelo MockAntivirusProvider

- [x] **Tests (2026-05-23):**
  - [x] `npm run test:rls` passa — 7 testes, 0 falhas (fix: dotenv+ws no setup, schema fixtures, asserções alinhadas com comportamento Supabase)
  - [x] `tests/security/portal-upload-security.test.ts` — 14 testes verdes (XXE, EICAR, parser feliz e malicioso)
  - [ ] Edge function `upload-fiscal-document` testada manualmente com Postman *(smoke manual)*

- [x] **Documentação (2026-05-23):**
  - [x] `docs/API.md` criado — webhooks, edge functions, server actions críticas, RPCs, envs
  - [x] `.env.example` atualizado — `BANK_ENCRYPTION_KEY`, `PAYMENT_PROVIDER`, `FINANCEIRO_NOTIFY_EMAIL` (além dos `ENABLE_ANTIVIRUS`/`CLOUDMERSIVE_API_KEY` que já estavam)

---

## Bibliotecas a Instalar

```bash
cd /Users/thiagobraga/financeiro-maxfem

# Parser XML
npm install fast-xml-parser

# Antivírus (opcional)
# (Cloudmersive via fetch puro, sem SDK)

# UUID v4 pra idempotency keys
npm install uuid
npm install -D @types/uuid

# Tests
npm install -D vitest @vitest/ui
```

---

## Variáveis de Ambiente Novas

Adicionar ao `.env.local`:

```bash
# Antivírus (opcional)
ENABLE_ANTIVIRUS=false
CLOUDMERSIVE_API_KEY=your_key_here

# Rate limit (valores padrão, configuráveis)
RATE_LIMIT_MAGIC_LINK_PER_HOUR=5
RATE_LIMIT_NF_UPLOAD_PER_HOUR=50
```

---

## Próximos Passos Após Sprint 4b

1. **Sprint 7-A (Bling leitura)** — paralelizável
2. **Sprint 5 (Integração Inter real)** — aguarda credenciais
3. **Sprint 6 (DDA BTG)** — aguarda credenciais
4. **Sprint 7-B (Conciliação + go-live)** — final

---

**Status:** Plano pronto. Aguardando aprovação do Mestre pra começar execução.
