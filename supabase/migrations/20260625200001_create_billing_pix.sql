-- ============================================================
-- Migration 0005-2: Spec 0005 — billing_pix
-- Histórico de Pix gerados por cobrança; controla status ativo/expirado/pago.
-- ============================================================
BEGIN;

CREATE TYPE billing_pix_status AS ENUM ('active', 'expired', 'paid');

CREATE TABLE billing_pix (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id     UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  mp_payment_id  TEXT NOT NULL UNIQUE,
  qr_code        TEXT NOT NULL,
  qr_code_base64 TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  status         billing_pix_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_billing_pix_updated_at
  BEFORE UPDATE ON billing_pix
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE billing_pix ENABLE ROW LEVEL SECURITY;

-- Operadores: leitura e escrita via tenant
CREATE POLICY "tenant_isolation_billing_pix" ON billing_pix
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenants()));

-- Clientes mobile: leitura apenas nas próprias cobranças
CREATE POLICY "customer_read_own_billing_pix" ON billing_pix
  FOR SELECT TO authenticated
  USING (
    billing_id IN (
      SELECT b.id FROM billings b
      INNER JOIN rentals r ON r.id = b.lease_id
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = auth.uid()
    )
  );

-- Enforce RN-003: no máximo um Pix ativo por cobrança
CREATE UNIQUE INDEX idx_billing_pix_one_active_per_billing
  ON billing_pix (billing_id)
  WHERE status = 'active';

CREATE INDEX idx_billing_pix_billing_id     ON billing_pix(billing_id);
CREATE INDEX idx_billing_pix_tenant_id      ON billing_pix(tenant_id);
CREATE INDEX idx_billing_pix_mp_payment_id  ON billing_pix(mp_payment_id);
CREATE INDEX idx_billing_pix_billing_status ON billing_pix(billing_id, status, expires_at);

COMMIT;
