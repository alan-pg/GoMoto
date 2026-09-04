-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 09/17: pagamento e alocação.
--
-- Reversão da ADR 0013. A constraint UNIQUE(billing_id) implementava a regra
-- "sem pagamento parcial na V1" — e a própria ADR nomeou parcelamento e estorno
-- como gatilhos de reavaliação. Ambos viraram requisito.
--
-- Agora pagamento e cobrança se ligam por alocação N:N, o que destrava de uma vez:
--   - pagamento parcial (alocação < total da cobrança)
--   - um pagamento cobrindo várias cobranças
--   - sobra virando crédito do cliente
--   - estorno preciso: sabe-se qual pagamento quitou qual parte de qual cobrança
--
-- A tabela payments antiga é substituída, não alterada: o modelo mudou de
-- "recibo de UMA cobrança" para "dinheiro recebido do cliente", que é outro
-- conceito. Sem dados em produção, recriar é mais limpo que migrar.

DROP TABLE IF EXISTS payments CASCADE;

CREATE TABLE payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      payment_method_type NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL,

  -- FK adicionada na migration 12, quando payment_intents existir.
  payment_intent_id UUID,

  -- Estorno: marca o pagamento e é acompanhado de transação de estorno no
  -- ledger. Nunca DELETE (Princípio 3).
  reversed_at     TIMESTAMPTZ,
  reversal_reason TEXT,
  reversed_by     UUID REFERENCES auth.users(id),

  received_by UUID REFERENCES auth.users(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT payments_reversal_coherent
    CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL))
);

COMMENT ON TABLE payments IS
  'Spec 0014: dinheiro recebido do cliente. Sem billing_id: a ligação com cobranças é via payment_allocations (ADR 0024 reverte a ADR 0013).';

CREATE INDEX idx_payments_tenant_paid   ON payments (tenant_id, paid_at DESC);
CREATE INDEX idx_payments_customer      ON payments (tenant_id, customer_id);
CREATE INDEX idx_payments_active        ON payments (tenant_id, paid_at) WHERE reversed_at IS NULL;
CREATE INDEX idx_payments_intent        ON payments (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Valor, método e data do recebimento não mudam depois de registrados.
-- Estorno é o caminho de correção.
CREATE OR REPLACE FUNCTION fn_protect_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount      IS DISTINCT FROM OLD.amount      OR
     NEW.method      IS DISTINCT FROM OLD.method      OR
     NEW.paid_at     IS DISTINCT FROM OLD.paid_at     OR
     NEW.customer_id IS DISTINCT FROM OLD.customer_id
  THEN
    RAISE EXCEPTION
      'Pagamento % é imutável em valor, método, data e cliente (ADR 0024, Princípio 3). Corrija por estorno.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    RAISE EXCEPTION 'Pagamento % já estornado: estorno não se desfaz.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_protect
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_protect_payment();

-- ---------------------------------------------------------------------------
-- Alocação: N:N entre pagamento e cobrança
-- ---------------------------------------------------------------------------

CREATE TABLE payment_allocations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  charge_id  UUID NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,
  amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, charge_id)
);

COMMENT ON TABLE payment_allocations IS
  'Spec 0014: quanto de um pagamento quitou qual cobrança. Append-only.';

CREATE INDEX idx_payment_allocations_charge  ON payment_allocations (charge_id);
CREATE INDEX idx_payment_allocations_payment ON payment_allocations (payment_id);

CREATE TRIGGER trg_payment_allocations_immutable
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fn_reject_financial_mutation();

-- A soma das alocações de um pagamento nunca pode exceder o próprio pagamento.
-- Sem isso, um erro de serviço distribuiria dinheiro que não existe.
CREATE OR REPLACE FUNCTION fn_assert_allocation_within_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment NUMERIC(14,2);
  v_alloc   NUMERIC(14,2);
BEGIN
  SELECT amount INTO v_payment FROM payments WHERE id = NEW.payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_alloc
    FROM payment_allocations WHERE payment_id = NEW.payment_id;

  IF v_alloc > v_payment THEN
    RAISE EXCEPTION
      'Alocações do pagamento % somam % e excedem o valor recebido (%).',
      NEW.payment_id, v_alloc, v_payment
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_assert_allocation_within_payment IS
  'Spec 0014: impede distribuir mais dinheiro do que o pagamento trouxe.';

CREATE CONSTRAINT TRIGGER trg_allocation_within_payment
  AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_assert_allocation_within_payment();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payments ON payments
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_payment_allocations ON payment_allocations
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY customer_read_own_payments ON payments
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT current_customer_ids()));

GRANT ALL ON TABLE payments            TO authenticated;
GRANT ALL ON TABLE payment_allocations TO authenticated;
GRANT ALL ON TABLE payments            TO service_role;
GRANT ALL ON TABLE payment_allocations TO service_role;
