-- ============================================================
-- 20260517000007_fiscal_documents_storage.sql
-- ------------------------------------------------------------
-- Bucket privado pra armazenar XMLs e PDFs de NF enviados pelo portal.
--
-- Convenção de path: <supplier_id>/<fiscal_doc_id>/<filename>
--   Ex: 7a8f...d3/9e2c...b1/nfe-12345.xml
--   Ex: 7a8f...d3/9e2c...b1/nfe-12345.pdf
--
-- RLS:
--   - Supplier autenticado: pode INSERT/SELECT só em paths que começam
--     com seu próprio business_partners.id
--   - Admin staff: SELECT em qualquer path (via service_role nas server
--     actions, NÃO via policy — defesa em profundidade)
--
-- Notas:
--   - Bucket privado (public=false): só acesso via signed URLs gerados
--     server-side, nunca exposição direta
--   - Tamanho máx 10MB por arquivo (NFs reais ficam em < 1MB; 10MB é
--     fôlego pra PDFs digitalizados scaneados)
--   - MIME types restritos
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fiscal-documents',
  'fiscal-documents',
  FALSE,
  10 * 1024 * 1024,
  ARRAY['application/xml', 'text/xml', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = 10 * 1024 * 1024,
      allowed_mime_types = ARRAY['application/xml', 'text/xml', 'application/pdf'];

-- ============================================================
-- Policies em storage.objects (RLS já habilitado pelo Supabase)
-- ============================================================

-- INSERT: supplier só pode upar em path que começa com seu próprio supplier_id
CREATE POLICY "Suppliers upload to their own folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'fiscal-documents'
    AND public.user_has_role(ARRAY['supplier'])
    AND (storage.foldername(name))[1] = (
      SELECT id::TEXT FROM public.business_partners
       WHERE supplier_user_id = auth.uid()
       LIMIT 1
    )
  );

-- SELECT: supplier vê só seus próprios arquivos
CREATE POLICY "Suppliers see their own files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'fiscal-documents'
    AND public.user_has_role(ARRAY['supplier'])
    AND (storage.foldername(name))[1] = (
      SELECT id::TEXT FROM public.business_partners
       WHERE supplier_user_id = auth.uid()
       LIMIT 1
    )
  );

-- DELETE: supplier pode deletar antes do CAP ser vinculado (= antes de
-- ter ido pra contábil). Após linked_to_payable, só admin via service_role.
CREATE POLICY "Suppliers delete only their unlinked files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'fiscal-documents'
    AND public.user_has_role(ARRAY['supplier'])
    AND (storage.foldername(name))[1] = (
      SELECT id::TEXT FROM public.business_partners
       WHERE supplier_user_id = auth.uid()
       LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
       WHERE fd.xml_storage_path = storage.objects.name
          OR fd.pdf_storage_path = storage.objects.name
         AND fd.status IN ('linked_to_payable','validated')
    )
  );

-- Admin staff: NÃO tem policy aqui. Acesso só via service_role nas
-- server actions, com whitelist de role na app antes. Mantém princípio
-- "service role nunca exposto ao client" + "audit log de toda leitura
-- admin de NF de fornecedor".

-- Path no formato <supplier_id>/<doc_id>/<filename>. Primeiro segmento deve
-- casar com bp.id do supplier_user_id. (COMMENT ON POLICY removido porque
-- storage.objects é owned por supabase_storage_admin)
