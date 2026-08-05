-- Módulo Financeiro (Spec 0008) — Passo 4: caução como passivo rastreável
-- deposits: uma caução por locação (UNIQUE WHERE status='received' = RN-003).
-- deposit_movements: histórico imutável de devoluções e retenções.

CREATE TABLE deposits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id     UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  balance       NUMERIC(10,2) NOT NULL CHECK (balance >= 0),
  status        deposit_status NOT NULL DEFAULT 'received',
  received_at   DATE NOT NULL,
  closed_at     DATE,
  registered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposits_balance_lte_amount CHECK (balance <= amount)
);

CREATE TRIGGER update_deposits_updated_at
  BEFORE UPDATE ON deposits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_deposits" ON deposits
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_deposits_tenant_rental ON deposits(tenant_id, rental_id);
-- Uma caução ativa por locação (RN-003)
CREATE UNIQUE INDEX idx_deposits_rental_unique ON deposits(rental_id) WHERE status = 'received';

-- ============================================================

CREATE TABLE deposit_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deposit_id    UUID NOT NULL REFERENCES deposits(id) ON DELETE RESTRICT,
  type          deposit_movement_type NOT NULL,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  reason        TEXT,
  movement_date DATE NOT NULL,
  registered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_deposit_movements_updated_at
  BEFORE UPDATE ON deposit_movements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deposit_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_deposit_movements" ON deposit_movements
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE INDEX idx_deposit_movements_deposit ON deposit_movements(deposit_id);
