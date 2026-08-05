-- ============================================================
-- customers: PJ support, endereço estruturado e bucket de docs
-- ============================================================
-- Objetivos:
--   1. Suporte a cliente jurídico (CNPJ) além do físico (CPF).
--   2. Endereço decomposto em campos atômicos (rua, número, bairro, cidade…).
--   3. Bucket privado `customer-documents` para CNH e comprovante.
--   4. Coluna residency_proof_url para comprovante de residência.
-- ============================================================

-- ── 1. Tipo de pessoa ────────────────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS person_type VARCHAR(10) NOT NULL DEFAULT 'individual';

ALTER TABLE customers
  ADD CONSTRAINT customers_person_type_check
  CHECK (person_type IN ('individual', 'company'));

-- ── 2. Campos de pessoa jurídica ─────────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cnpj          VARCHAR(14),
  ADD COLUMN IF NOT EXISTS company_name  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS trade_name    VARCHAR(200);

ALTER TABLE customers
  ADD CONSTRAINT customers_cnpj_format
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_cnpj_unique
  ON customers(tenant_id, cnpj)
  WHERE cnpj IS NOT NULL;

-- ── 3. Relaxar NOT NULL do CPF (PJ não tem CPF) ──────────────────────────────

ALTER TABLE customers ALTER COLUMN cpf DROP NOT NULL;

-- Recriar constraint de formato permitindo NULL
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_cpf_format;
ALTER TABLE customers
  ADD CONSTRAINT customers_cpf_format
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

-- ── 4. Endereço estruturado ───────────────────────────────────────────────────
-- O campo `address` (TEXT) é mantido para compatibilidade com registros
-- legados. Novos cadastros usam os campos abaixo.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS street        VARCHAR(300),
  ADD COLUMN IF NOT EXISTS street_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS complement    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS neighborhood  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city          VARCHAR(100);

-- `state` (UF) e `zip_code` já existem — não recriados.

-- ── 5. Comprovante de residência ──────────────────────────────────────────────
-- `drivers_license_photo_url` → foto da CNH (individual).
-- `document_photo_url`        → outro documento genérico (legado / empresa).
-- `residency_proof_url`       → comprovante de residência (novo).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS residency_proof_url TEXT;

-- ── 6. Bucket customer-documents (privado, signed URL) ───────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-documents',
  'customer-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "customer-documents: leitura autenticada"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "customer-documents: upload autenticado"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "customer-documents: update autenticado"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');

CREATE POLICY "customer-documents: delete autenticado"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'customer-documents' AND auth.role() = 'authenticated');
