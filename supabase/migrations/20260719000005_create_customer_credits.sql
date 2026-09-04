-- Módulo Financeiro (Spec 0008) — Passo 5: crédito do cliente
-- customer_credits: saldo positivo do cliente (RF-022 a RF-026).
-- credit_applications: histórico de abatimentos aplicados em cobranças.

CREATE TABLE customer_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  available_balance NUMERIC(10,2) NOT NULL CHECK (available_balance >= 0),
  origin            credit_origin NOT NULL,
  reason            TEXT NOT NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_customer_credits_updated_at
  BEFORE UPDATE ON customer_credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_customer_credits" ON customer_credits
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_customer_credits_tenant_customer ON customer_credits(tenant_id, customer_id);
-- Índice parcial para queries que buscam apenas créditos com saldo disponível
CREATE INDEX idx_customer_credits_balance ON customer_credits(tenant_id, customer_id)
  WHERE available_balance > 0;

-- ============================================================

CREATE TABLE credit_applications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credit_id  UUID NOT NULL REFERENCES customer_credits(id) ON DELETE RESTRICT,
  billing_id UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  amount     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_auto    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_credit_applications_updated_at
  BEFORE UPDATE ON credit_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_credit_applications" ON credit_applications
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_credit_applications_credit  ON credit_applications(credit_id);
CREATE INDEX idx_credit_applications_billing ON credit_applications(billing_id);
