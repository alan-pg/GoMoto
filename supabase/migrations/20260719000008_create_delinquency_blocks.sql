-- Módulo Financeiro (Spec 0008) — Passo 8: histórico de bloqueio/desbloqueio
-- Registra cada ação de bloqueio ou desbloqueio manual de cliente (RN-035).

CREATE TABLE delinquency_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  action      block_action NOT NULL,
  reason      TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_delinquency_blocks_updated_at
  BEFORE UPDATE ON delinquency_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE delinquency_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_delinquency_blocks" ON delinquency_blocks
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_delinquency_blocks_customer ON delinquency_blocks(tenant_id, customer_id);
