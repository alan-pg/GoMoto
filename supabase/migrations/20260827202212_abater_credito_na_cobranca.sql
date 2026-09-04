-- ---------------------------------------------------------------------------
-- Abater crédito NA cobrança que o operador tem aberta
-- ---------------------------------------------------------------------------
-- O modal de "Aplicar crédito" pedia qual crédito e quanto, validava os dois, e
-- chamava `applyCustomerCredits(customerId)` — que não recebe nenhum dos dois.
-- A action varria todo o saldo do cliente para as cobranças MAIS ANTIGAS em
-- aberto. Abrir a cobrança #7, escolher R$ 50 e ver R$ 200 abatidos na #3 era
-- o comportamento correto do código e o oposto do que a tela prometia.
--
-- Agora o abatimento é dirigido: este valor, nesta cobrança.
--
-- E vem para o banco porque a sequência era ler-saldo, decidir, escrever, tudo
-- solto no cliente: dois operadores abatendo ao mesmo tempo liam o mesmo saldo
-- e gastavam o mesmo crédito duas vezes. Travar o CLIENTE serializa os
-- abatimentos dele, que é exatamente o escopo do saldo — mesma forma de
-- `fn_settle_customer_credit`.
--
-- Não trava a COBRANÇA porque o excesso desse lado já tem dono:
-- `trg_allocation_within_charge` recusa alocação acima do que a cobrança vale.
--
-- "Qual crédito" saiu de propósito. O saldo é um POOL por cliente, derivado de
-- `creditos_de_clientes` no razão; as linhas de `customer_credits` guardam o
-- que foi concedido, não o que resta. Escolher entre elas era decisão sem
-- efeito.

CREATE OR REPLACE FUNCTION fn_apply_customer_credit(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_charge_id   UUID,
  p_amount      NUMERIC,
  p_created_by  UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
  v_open    NUMERIC;
  v_owner   UUID;
  v_payment UUID;
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

  SELECT customer_id, open_amount INTO v_owner, v_open
    FROM charge_balances
   WHERE charge_id = p_charge_id AND tenant_id = p_tenant_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  -- Crédito de um cliente não abate dívida de outro.
  IF v_owner <> p_customer_id THEN
    RAISE EXCEPTION 'CHARGE_BELONGS_TO_ANOTHER_CUSTOMER';
  END IF;

  IF p_amount > v_open THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_CHARGE: em aberto %, pedido %', v_open, p_amount;
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
    FROM customer_credit_balances
   WHERE tenant_id = p_tenant_id AND customer_id = p_customer_id;

  v_balance := COALESCE(v_balance, 0);

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_BALANCE: saldo %, pedido %', v_balance, p_amount;
  END IF;

  -- Abatimento é pagamento: sem o par pagamento+alocação o crédito sairia do
  -- razão e `charge_balances.open_amount` (itens − alocações) continuaria
  -- cheio — crédito consumido, dívida de pé, cliente cobrado duas vezes.
  INSERT INTO payments (tenant_id, customer_id, amount, method, paid_at, notes, received_by)
  VALUES (p_tenant_id, p_customer_id, p_amount, 'credit', now(),
          'Abatimento por crédito do cliente', p_created_by)
  RETURNING id INTO v_payment;

  INSERT INTO payment_allocations (tenant_id, payment_id, charge_id, amount, created_by)
  VALUES (p_tenant_id, v_payment, p_charge_id, p_amount, p_created_by);

  -- A origem é o PAGAMENTO, não o crédito: o estorno procura por
  -- (source_module='payment', source_id=pagamento) e sem isso não achava o que
  -- desfazer.
  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'credit_applied',
      'description',   'Crédito abatido na cobrança',
      'source_module', 'payment',
      'source_id',     v_payment,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'debit',
                         'amount', p_amount, 'customer_id', p_customer_id, 'charge_id', p_charge_id),
      jsonb_build_object('account_code', 'contas_a_receber', 'direction', 'credit',
                         'amount', p_amount, 'customer_id', p_customer_id, 'charge_id', p_charge_id)
    )
  );

  RETURN v_payment;
END;
$$;

COMMENT ON FUNCTION fn_apply_customer_credit IS
  'Abate crédito do cliente NUMA cobrança específica, sob trava do cliente. Recusa acima do saldo e acima do que a cobrança deve.';
