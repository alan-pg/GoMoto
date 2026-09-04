-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 18/18: escrita atômica no ledger.
--
-- Por que RPC e não dois inserts pelo supabase-js: cada chamada do client é uma
-- transação de banco independente. Inserir `financial_transactions` e depois
-- `financial_entries` em statements separados deixaria uma transação órfã se o
-- segundo falhasse — e transação sem perna é registro financeiro corrompido.
--
-- Aqui as duas escritas ocorrem no mesmo bloco: ou ambas persistem, ou nenhuma.
-- A invariante de balanço (CONSTRAINT TRIGGER DEFERRABLE) é avaliada no COMMIT,
-- com todas as pernas já presentes.

CREATE OR REPLACE FUNCTION post_financial_transaction(
  p_tenant_id   UUID,
  p_transaction JSONB,
  p_entries     JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx_id UUID;
  v_count INT;
BEGIN
  IF jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION
      'Lançamento exige contrapartida: recebido % perna(s) (ADR 0024, Princípio 1).',
      jsonb_array_length(p_entries)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO financial_transactions (
    tenant_id, branch_id, event_type, occurred_at, description,
    currency, exchange_rate, source_module, source_id,
    reverses_transaction_id, created_by
  )
  VALUES (
    p_tenant_id,
    NULLIF(p_transaction->>'branch_id', '')::uuid,
    p_transaction->>'event_type',
    COALESCE((p_transaction->>'occurred_at')::timestamptz, now()),
    p_transaction->>'description',
    COALESCE(p_transaction->>'currency', 'BRL'),
    COALESCE((p_transaction->>'exchange_rate')::numeric, 1),
    p_transaction->>'source_module',
    NULLIF(p_transaction->>'source_id', '')::uuid,
    NULLIF(p_transaction->>'reverses_transaction_id', '')::uuid,
    NULLIF(p_transaction->>'created_by', '')::uuid
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO financial_entries (
    tenant_id, transaction_id, account_code, direction, amount,
    customer_id, vehicle_id, rental_id, charge_id, payable_id, cost_center_id
  )
  SELECT
    p_tenant_id,
    v_tx_id,
    e->>'account_code',
    (e->>'direction')::entry_direction,
    (e->>'amount')::numeric,
    NULLIF(e->>'customer_id', '')::uuid,
    NULLIF(e->>'vehicle_id', '')::uuid,
    NULLIF(e->>'rental_id', '')::uuid,
    NULLIF(e->>'charge_id', '')::uuid,
    NULLIF(e->>'payable_id', '')::uuid,
    NULLIF(e->>'cost_center_id', '')::uuid
  FROM jsonb_array_elements(p_entries) AS e;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> jsonb_array_length(p_entries) THEN
    RAISE EXCEPTION 'Esperado % lançamento(s), inserido(s) %.',
      jsonb_array_length(p_entries), v_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_tx_id;
END;
$$;

COMMENT ON FUNCTION post_financial_transaction IS
  'Spec 0014: escreve transação e pernas atomicamente. Único caminho de escrita no ledger — nenhuma Server Action insere em financial_entries diretamente.';

REVOKE ALL ON FUNCTION post_financial_transaction(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_financial_transaction(UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION post_financial_transaction(UUID, JSONB, JSONB) TO service_role;
