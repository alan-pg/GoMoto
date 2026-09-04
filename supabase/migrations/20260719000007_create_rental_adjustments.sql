-- Módulo Financeiro (Spec 0008) — Passo 7: histórico de reajustes de locação
-- Registro imutável de cada reajuste de valor de ciclo e encargos (RN-028).

CREATE TABLE rental_adjustments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id              UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  previous_cycle_amount  NUMERIC(10,2) NOT NULL,
  new_cycle_amount       NUMERIC(10,2) NOT NULL,
  previous_config        JSONB,
  new_config             JSONB,
  updated_billings_count INTEGER NOT NULL DEFAULT 0,
  justification          TEXT NOT NULL,
  adjusted_by            UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  adjusted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_rental_adjustments_updated_at
  BEFORE UPDATE ON rental_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rental_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_rental_adjustments" ON rental_adjustments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_rental_adjustments_rental ON rental_adjustments(rental_id);
