-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 11/17: caução e créditos, sem coluna de saldo.
--
-- Caução e crédito são passivos com o cliente — dinheiro de terceiro. Isso é
-- estrutural e não configurável (ADR 0024).
--
-- Hoje ambos carregam saldo em coluna mutável: deposits.balance e
-- customer_credits.available_balance. É a mesma família de defeito de F-06,
-- onde fn_auto_apply_credit sobrescreve billings.credit_applied em vez de
-- acumular. Saldo em coluna diverge; saldo derivado não pode divergir
-- (Princípio 2).
--
-- deposit_movements desaparece: movimento de caução é transação no ledger
-- (deposit_received, deposit_retained, deposit_returned), não tabela própria.
-- credit_applications idem: aplicação de crédito é transação.

DROP TABLE IF EXISTS deposit_movements   CASCADE;
DROP TABLE IF EXISTS deposits            CASCADE;
DROP TABLE IF EXISTS credit_applications CASCADE;
DROP TABLE IF EXISTS customer_credits    CASCADE;

-- ---------------------------------------------------------------------------
-- Caução
-- ---------------------------------------------------------------------------

CREATE TABLE deposits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id   UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),

  -- Cobrança que materializa a caução para o cliente pagar.
  charge_id   UUID REFERENCES charges(id) ON DELETE RESTRICT,

  received_at DATE,
  closed_at   DATE,

  registered_by UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT deposits_closed_after_received
    CHECK (closed_at IS NULL OR received_at IS NULL OR closed_at >= received_at)
);

COMMENT ON TABLE deposits IS
  'Spec 0014: documento da caução. Sem balance nem status — o saldo vem da view deposit_balances, agregando a conta de passivo caucoes_a_devolver (Princípio 2).';

-- Uma caução ativa por locação: enquanto não fechada, não abre outra.
CREATE UNIQUE INDEX idx_deposits_one_open_per_rental
  ON deposits (rental_id) WHERE closed_at IS NULL;

CREATE INDEX idx_deposits_tenant_rental ON deposits (tenant_id, rental_id);
CREATE INDEX idx_deposits_customer      ON deposits (tenant_id, customer_id);

CREATE TRIGGER trg_deposits_updated_at
  BEFORE UPDATE ON deposits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Crédito do cliente
-- ---------------------------------------------------------------------------

CREATE TABLE customer_credits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),

  -- Texto livre em vez de enum: a origem acompanha (source_module, source_id)
  -- do resto do modelo e não exige DDL a cada novo caminho de crédito.
  origin      TEXT NOT NULL,
  reason      TEXT NOT NULL,

  -- R-09: crédito pode expirar. NULL = não expira.
  expires_at  DATE,

  -- Quando o crédito nasce de manutenção executada pelo cliente.
  payable_id  UUID REFERENCES payables(id) ON DELETE RESTRICT,

  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE customer_credits IS
  'Spec 0014: crédito concedido ao cliente. Sem available_balance — saldo vem de customer_credit_balances sobre a conta de passivo creditos_de_clientes.';
COMMENT ON COLUMN customer_credits.expires_at IS
  'R-09: aplicação ignora crédito expirado. NULL = sem expiração.';

CREATE INDEX idx_customer_credits_customer ON customer_credits (tenant_id, customer_id);
CREATE INDEX idx_customer_credits_valid    ON customer_credits (tenant_id, customer_id, expires_at);

CREATE TRIGGER trg_customer_credits_updated_at
  BEFORE UPDATE ON customer_credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE deposits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_deposits ON deposits
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_customer_credits ON customer_credits
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY customer_read_own_deposits ON deposits
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT current_customer_ids()));

CREATE POLICY customer_read_own_credits ON customer_credits
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT current_customer_ids()));

GRANT ALL ON TABLE deposits         TO authenticated;
GRANT ALL ON TABLE customer_credits TO authenticated;
GRANT ALL ON TABLE deposits         TO service_role;
GRANT ALL ON TABLE customer_credits TO service_role;
