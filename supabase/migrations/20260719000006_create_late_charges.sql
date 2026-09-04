-- Módulo Financeiro (Spec 0008) — Passo 6: snapshot de encargos na baixa
-- Persiste multa + juros calculados no momento do pagamento (RNF-009).
-- Permite reconstruir o histórico sem recálculo externo.

CREATE TABLE late_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id      UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  fee_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  days_overdue    INTEGER NOT NULL,
  snapshot_config JSONB NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT late_charges_billing_unique UNIQUE (billing_id)
);

CREATE TRIGGER update_late_charges_updated_at
  BEFORE UPDATE ON late_charges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE late_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_late_charges" ON late_charges
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_late_charges_billing ON late_charges(billing_id);
