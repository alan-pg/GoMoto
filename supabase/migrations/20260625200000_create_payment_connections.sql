-- ============================================================
-- Migration 0005-1: Spec 0005 — payment_connections
-- Armazena credenciais OAuth MP por tenant (máximo 1 por tenant).
-- ============================================================
BEGIN;

CREATE TABLE payment_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  mp_user_id       TEXT NOT NULL,
  mp_account_email TEXT,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_payment_connections_updated_at
  BEFORE UPDATE ON payment_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE payment_connections ENABLE ROW LEVEL SECURITY;

-- Operadores do tenant: leitura para exibir mp_account_email na UI.
-- access_token/refresh_token são lidos exclusivamente server-side via service role.
CREATE POLICY "tenant_isolation_payment_connections" ON payment_connections
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenants()));

CREATE INDEX idx_payment_connections_tenant_id  ON payment_connections(tenant_id);
CREATE INDEX idx_payment_connections_mp_user_id ON payment_connections(mp_user_id);

COMMIT;
