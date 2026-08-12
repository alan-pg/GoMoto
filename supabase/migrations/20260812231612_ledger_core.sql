-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 06/17: núcleo do ledger.
--
-- Duas invariantes garantidas pelo BANCO, não pelo serviço:
--   1. Toda transação fecha em zero (Princípio 1)
--   2. Lançamento é imutável (Princípio 3)
--
-- Ambas são a segunda barreira: mesmo com bug no serviço financeiro, lançamento
-- incoerente não persiste.
--
-- Estas tabelas são append-only e por isso NÃO têm updated_at nem o trigger
-- update_updated_at_column, seguindo o precedente de vehicle_status_history
-- (ADR 0011). Um updated_at que nunca muda seria ruído.

-- ---------------------------------------------------------------------------
-- Transação: o fato financeiro
-- ---------------------------------------------------------------------------

CREATE TABLE financial_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     UUID REFERENCES branches(id),

  event_type    TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  description   TEXT NOT NULL,

  currency      CHAR(3) NOT NULL DEFAULT 'BRL',
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),

  -- Origem polimórfica uniforme. Módulo novo não altera schema: declara
  -- source_module e pronto. Sem FK por ser polimórfica — integridade é
  -- responsabilidade do serviço.
  source_module TEXT NOT NULL,
  source_id     UUID,

  -- Estorno: aponta para a transação que esta reverte (Princípio 3).
  reverses_transaction_id UUID REFERENCES financial_transactions(id),

  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT financial_transactions_no_self_reversal
    CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id)
);

COMMENT ON TABLE financial_transactions IS
  'Spec 0014: fato financeiro. Append-only — correção é transação de estorno, nunca UPDATE.';

CREATE INDEX idx_ftx_tenant_occurred ON financial_transactions (tenant_id, occurred_at DESC);
CREATE INDEX idx_ftx_source          ON financial_transactions (tenant_id, source_module, source_id);
CREATE INDEX idx_ftx_reverses        ON financial_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

-- Uma transação só pode ser estornada uma vez.
CREATE UNIQUE INDEX idx_ftx_one_reversal_per_transaction
  ON financial_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Lançamento: as pernas da transação
-- ---------------------------------------------------------------------------

CREATE TABLE financial_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES financial_transactions(id) ON DELETE RESTRICT,
  account_code   TEXT NOT NULL REFERENCES financial_accounts(code),
  direction      entry_direction NOT NULL,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),

  -- Base de toda agregação e da invariante de balanço.
  -- débito = +, crédito = −  →  soma da transação tem de dar 0.
  amount_signed  NUMERIC(14,2) GENERATED ALWAYS AS
                 (CASE WHEN direction = 'debit' THEN amount ELSE -amount END) STORED,

  -- Dimensões analíticas. Relatório novo é GROUP BY, não tabela nova.
  customer_id    UUID REFERENCES customers(id),
  vehicle_id     UUID REFERENCES vehicles(id),
  rental_id      UUID REFERENCES rentals(id),
  cost_center_id UUID REFERENCES cost_centers(id),

  -- charges e payables só existem nas migrations 08 e 10; as FKs entram lá.
  charge_id      UUID,
  payable_id     UUID,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE financial_entries IS
  'Spec 0014: perna de débito/crédito. Append-only. Tabela de fatos única — é o que torna o fan-out de agregação (F-01) inexpressável.';
COMMENT ON COLUMN financial_entries.amount_signed IS
  'Gerada: débito positivo, crédito negativo. SUM por transação tem de ser 0.';
COMMENT ON COLUMN financial_entries.charge_id IS
  'FK adicionada na migration 08, quando charges existir.';
COMMENT ON COLUMN financial_entries.payable_id IS
  'FK adicionada na migration 10, quando payables existir.';

CREATE INDEX idx_entries_tx       ON financial_entries (transaction_id);
CREATE INDEX idx_entries_account  ON financial_entries (tenant_id, account_code);
CREATE INDEX idx_entries_vehicle  ON financial_entries (tenant_id, vehicle_id, account_code)
  WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_entries_customer ON financial_entries (tenant_id, customer_id, account_code)
  WHERE customer_id IS NOT NULL;
CREATE INDEX idx_entries_rental   ON financial_entries (tenant_id, rental_id)
  WHERE rental_id IS NOT NULL;
CREATE INDEX idx_entries_charge   ON financial_entries (charge_id)
  WHERE charge_id IS NOT NULL;
CREATE INDEX idx_entries_payable  ON financial_entries (payable_id)
  WHERE payable_id IS NOT NULL;
CREATE INDEX idx_entries_cc       ON financial_entries (tenant_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariante 1: toda transação fecha em zero
-- ---------------------------------------------------------------------------
-- DEFERRABLE INITIALLY DEFERRED: as pernas podem ser inseridas em qualquer
-- ordem dentro da mesma transação de banco; a verificação roda no COMMIT.

CREATE OR REPLACE FUNCTION fn_assert_transaction_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx      UUID := COALESCE(NEW.transaction_id, OLD.transaction_id);
  v_balance NUMERIC(14,2);
  v_legs    INT;
BEGIN
  SELECT COALESCE(SUM(amount_signed), 0), COUNT(*)
    INTO v_balance, v_legs
    FROM financial_entries
   WHERE transaction_id = v_tx;

  -- Transação sem pernas só ocorre se a própria transação também sumiu.
  IF v_legs = 0 THEN
    RETURN NULL;
  END IF;

  IF v_legs < 2 THEN
    RAISE EXCEPTION
      'Transação % tem % perna(s): um lançamento exige contrapartida (ADR 0024, Princípio 1).',
      v_tx, v_legs
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_balance <> 0 THEN
    RAISE EXCEPTION
      'Transação % não fecha: soma dos lançamentos = % (esperado 0). ADR 0024, Princípio 1.',
      v_tx, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_assert_transaction_balanced IS
  'Spec 0014: invariante de balanço, verificada no COMMIT. Barra lançamento incoerente mesmo com bug no serviço.';

CREATE CONSTRAINT TRIGGER trg_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON financial_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_assert_transaction_balanced();

-- ---------------------------------------------------------------------------
-- Invariante 2: append-only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_reject_financial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Registro financeiro é imutável (ADR 0024, Princípio 3). Corrija com transação de estorno via reverses_transaction_id, nunca com % em %.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION fn_reject_financial_mutation IS
  'Spec 0014: bloqueia UPDATE e DELETE em transações e lançamentos.';

CREATE TRIGGER trg_entries_immutable
  BEFORE UPDATE OR DELETE ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION fn_reject_financial_mutation();

CREATE TRIGGER trg_ftx_immutable
  BEFORE UPDATE OR DELETE ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_reject_financial_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_financial_transactions ON financial_transactions
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_financial_entries ON financial_entries
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT SELECT, INSERT ON TABLE financial_transactions TO authenticated;
GRANT SELECT, INSERT ON TABLE financial_entries      TO authenticated;
GRANT ALL            ON TABLE financial_transactions TO service_role;
GRANT ALL            ON TABLE financial_entries      TO service_role;
