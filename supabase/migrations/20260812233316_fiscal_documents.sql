-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 13/17: documentos fiscais.
--
-- Entra agora, ainda sem emissor integrado, porque a ligação natural é com
-- charges — e criar a tabela depois exigiria decidir retroativamente como
-- amarrar documento fiscal a cobranças já emitidas.
--
-- Qual documento cada tenant emite (NFS-e, NF-e, recibo) e sobre qual base
-- depende do regime de cada empresa — ver tenant_account_mappings.in_tax_base
-- na migration 03. Esta tabela registra o documento, não decide a regra.

CREATE TABLE fiscal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id),
  charge_id   UUID REFERENCES charges(id) ON DELETE RESTRICT,

  doc_type    TEXT NOT NULL CHECK (doc_type IN ('nfse','nfe','recibo')),
  series      TEXT,
  number      BIGINT,

  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','issued','cancelled','error')),

  provider             TEXT,
  provider_document_id TEXT,

  issued_at   TIMESTAMPTZ,
  access_key  TEXT,
  pdf_url     TEXT,
  xml_url     TEXT,
  payload     JSONB,
  error_message TEXT,

  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_documents_issued_has_data
    CHECK (status <> 'issued' OR (number IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT fiscal_documents_error_has_message
    CHECK (status <> 'error' OR error_message IS NOT NULL)
);

COMMENT ON TABLE fiscal_documents IS
  'Spec 0014: documento fiscal emitido sobre uma cobrança. A regra de o que emitir é política do tenant; esta tabela registra o resultado.';

-- Numeração fiscal não repete dentro da série.
CREATE UNIQUE INDEX idx_fiscal_documents_number
  ON fiscal_documents (tenant_id, doc_type, series, number)
  WHERE number IS NOT NULL;

CREATE INDEX idx_fiscal_documents_charge ON fiscal_documents (charge_id) WHERE charge_id IS NOT NULL;
CREATE INDEX idx_fiscal_documents_tenant ON fiscal_documents (tenant_id, status);

CREATE TRIGGER trg_fiscal_documents_updated_at
  BEFORE UPDATE ON fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_fiscal_documents ON fiscal_documents
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- Cliente baixa a nota da própria cobrança.
CREATE POLICY customer_read_own_fiscal_documents ON fiscal_documents
  FOR SELECT TO authenticated
  USING (charge_id IN (
    SELECT c.id FROM charges c WHERE c.customer_id IN (SELECT current_customer_ids())
  ));

GRANT ALL ON TABLE fiscal_documents TO authenticated;
GRANT ALL ON TABLE fiscal_documents TO service_role;
