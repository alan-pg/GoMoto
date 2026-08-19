-- ---------------------------------------------------------------------------
-- Devolver crédito ao cliente em dinheiro
-- ---------------------------------------------------------------------------
-- Crédito e caução são a mesma coisa estruturalmente: dinheiro de terceiro que
-- a empresa segura e um dia devolve. A caução tinha as três peças — conta de
-- passivo, evento de devolução em dinheiro (`deposit_returned`) e apuração no
-- encerramento. O crédito tinha só a primeira.
--
-- Enquanto existe cobrança futura, abater resolve. Quando o contrato encerra,
-- ou quando o cliente pede o dinheiro, é preciso devolver de fato — e isso
-- NÃO é estorno. Estornar `credit_granted` inverteria as três pernas do
-- lançamento original, apagando a despesa do serviço e a recuperação junto com
-- o passivo. A moto passaria a constar com custo zero.
--
-- A trava é o ponto: o saldo é derivado do razão, não é linha que se possa
-- travar. Duas devoluções simultâneas leriam o mesmo saldo e as duas pagariam
-- — a empresa devolveria mais do que devia e `creditos_de_clientes` ficaria
-- negativo. Travar o CLIENTE serializa as devoluções dele, que é exatamente o
-- escopo do saldo.

CREATE OR REPLACE FUNCTION fn_settle_customer_credit(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_amount      NUMERIC,
  p_notes       TEXT DEFAULT NULL,
  p_created_by  UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id   UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE';
  END IF;

  PERFORM 1 FROM customers
   WHERE id = p_customer_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
    FROM customer_credit_balances
   WHERE tenant_id = p_tenant_id AND customer_id = p_customer_id;

  v_balance := COALESCE(v_balance, 0);

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_BALANCE: saldo % , pedido %', v_balance, p_amount;
  END IF;

  SELECT post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'credit_settled',
      'description',   COALESCE(NULLIF(btrim(p_notes), ''), 'Devolução de crédito ao cliente'),
      'source_module', 'customer_credit',
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'debit',
                         'amount', p_amount, 'customer_id', p_customer_id),
      jsonb_build_object('account_code', 'caixa_e_bancos', 'direction', 'credit',
                         'amount', p_amount, 'customer_id', p_customer_id)
    )
  ) INTO v_tx_id;

  RETURN v_tx_id;
END;
$$;

COMMENT ON FUNCTION fn_settle_customer_credit IS
  'Devolve crédito ao cliente em dinheiro: baixa o passivo contra o caixa, com o saldo verificado sob trava do cliente. Espelha deposit_returned. Não é estorno — o lançamento de origem permanece.';

GRANT EXECUTE ON FUNCTION fn_settle_customer_credit TO authenticated, service_role;
