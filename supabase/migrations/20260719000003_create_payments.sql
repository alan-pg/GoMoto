-- Módulo Financeiro (Spec 0008) — Passo 3: tabela payments
-- Substitui incomes como registro de recebimento (ADR 0013).
-- UNIQUE(billing_id) implementa RN-047: pagamento quita cobrança em única operação.

CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id     UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method_type NOT NULL,
  paid_at        TIMESTAMPTZ NOT NULL,
  received_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_billing_id_unique UNIQUE (billing_id)
);

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_payments" ON payments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_payments_tenant_billing ON payments(tenant_id, billing_id);
CREATE INDEX idx_payments_tenant_paid_at ON payments(tenant_id, paid_at);
