-- ============================================================
-- Migration: reescreve contract_templates
-- Remove: slug, file_url (abordagem .docx descartada)
-- Adiciona: content JSONB (Tiptap), tenant_id NOT NULL
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS contract_templates CASCADE;

CREATE TABLE contract_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    content     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contract_templates_tenant_idx ON contract_templates(tenant_id);

CREATE TRIGGER update_contract_templates_updated_at
    BEFORE UPDATE ON contract_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_contract_templates" ON contract_templates
    FOR ALL TO authenticated
    USING  (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

COMMIT;
