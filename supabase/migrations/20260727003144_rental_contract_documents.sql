-- ============================================================
-- Locações — vínculo com modelo de contrato + PDF assinado anexado
-- ============================================================
-- pdf_url nunca foi lido/escrito por nenhum código do produto (só existia
-- na migration inicial e no tipo TS) — renomeado para explicitar que é o
-- path (não URL) do PDF ASSINADO no bucket privado rental-documents.

ALTER TABLE rentals RENAME COLUMN pdf_url TO signed_contract_path;

ALTER TABLE rentals
  ADD COLUMN contract_template_id        UUID REFERENCES contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN signed_contract_file_name   TEXT,
  ADD COLUMN signed_contract_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rentals_contract_template ON rentals(tenant_id, contract_template_id);

-- rentals já tem RLS "tenant_isolation_rentals" cobrindo todas as colunas —
-- nada de RLS novo necessário (não é tabela nova).

-- ============================================================
-- Bucket: rental-documents — privado, leitura via signed URL emitida
-- server-side. Path: <tenant_id>/<rental_id>/<timestamp>.pdf
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rental-documents', 'rental-documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "rental-documents: leitura autenticada"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'rental-documents' AND auth.role() = 'authenticated');

CREATE POLICY "rental-documents: upload autenticado"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rental-documents' AND auth.role() = 'authenticated');

CREATE POLICY "rental-documents: update autenticado"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'rental-documents' AND auth.role() = 'authenticated');

CREATE POLICY "rental-documents: delete autenticado"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'rental-documents' AND auth.role() = 'authenticated');
