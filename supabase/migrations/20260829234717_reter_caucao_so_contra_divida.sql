-- ---------------------------------------------------------------------------
-- Reter caução é abater dívida — e só existe contra dívida (ADR 0026, fase 3)
-- ---------------------------------------------------------------------------
-- `closeRentalFinancial` retinha assim: lançava `deposit_retained` pelo valor
-- INTEIRO (debita caução, credita contas_a_receber) e depois chamava
-- `allocateWithoutCash`, que aloca nas cobranças abertas da mais antiga para a
-- mais nova. Sem cobrança em aberto — ou com dívida menor que a caução — não
-- havia onde alocar: a sobra voltava em `unallocated` e o chamador IGNORAVA o
-- retorno.
--
-- O resultado é `contas_a_receber` creditado sem contrapartida e um `payments`
-- sem alocação: a empresa com o dinheiro, o razão dizendo que o cliente tem
-- crédito a receber, e nenhuma cobrança quitada. O mesmo defeito que o caminho
-- do crédito já tinha corrigido, e que a caução herdou.
--
-- A decisão de produto (ADR 0026) é que reter só existe contra dívida: ou há
-- dívida e a caução a abate, ou não há e a caução é devolvida. Quem precisa
-- reter por avaria lança a avaria em Despesas com rateio ao cliente, o que
-- emite a cobrança — assim o custo aparece no DRE e a recuperação na linha
-- certa, em vez de a retenção sumir dentro de um recebível sem lastro.
--
-- Esta função põe a regra onde ela não é contornável. Espelha
-- `fn_apply_customer_credit`: uma cobrança por chamada, trava no CLIENTE,
-- relê saldo e dívida a cada vez, recusa acima de qualquer um dos dois.
-- O laço de escolher a próxima cobrança fica no chamador, que não decide nada.

CREATE OR REPLACE FUNCTION fn_retain_deposit_on_charge(
  p_tenant_id   UUID,
  p_rental_id   UUID,
  p_charge_id   UUID,
  p_amount      NUMERIC,
  p_reason      TEXT DEFAULT NULL,
  p_created_by  UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer  UUID;
  v_deposit   UUID;
  v_balance   NUMERIC;
  v_open      NUMERIC;
  v_owner     UUID;
  v_payment   UUID;
  v_descricao TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE';
  END IF;

  SELECT d.id, d.customer_id INTO v_deposit, v_customer
    FROM deposits d
   WHERE d.rental_id = p_rental_id AND d.tenant_id = p_tenant_id AND d.closed_at IS NULL
   LIMIT 1;

  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND';
  END IF;

  -- Trava o CLIENTE, como no crédito: é o escopo do saldo, e serializa dois
  -- operadores retendo a mesma caução ao mesmo tempo.
  PERFORM 1 FROM customers
   WHERE id = v_customer AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
    FROM deposit_balances
   WHERE rental_id = p_rental_id;

  v_balance := COALESCE(v_balance, 0);

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_DEPOSIT: saldo %, pedido %', v_balance, p_amount;
  END IF;

  SELECT cb.customer_id, cb.open_amount INTO v_owner, v_open
    FROM charge_balances cb
   WHERE cb.charge_id = p_charge_id AND cb.tenant_id = p_tenant_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  -- Caução de um cliente não abate dívida de outro.
  IF v_owner <> v_customer THEN
    RAISE EXCEPTION 'CHARGE_BELONGS_TO_ANOTHER_CUSTOMER';
  END IF;

  -- A guarda que não existia: retenção acima do que a cobrança deve não tem
  -- onde ser alocada, e é ela que produzia o recebível sem lastro.
  IF p_amount > v_open THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_CHARGE: em aberto %, pedido %', v_open, p_amount;
  END IF;

  v_descricao := COALESCE(NULLIF(btrim(p_reason), ''), 'Retenção de caução');

  -- Retenção é pagamento: sem o par pagamento+alocação a dívida seguiria
  -- inteira em `charge_balances` (itens − alocações), com a empresa já de posse
  -- do dinheiro. Mesmo motivo do abatimento por crédito.
  INSERT INTO payments (tenant_id, customer_id, amount, method, paid_at, notes, received_by)
  VALUES (p_tenant_id, v_customer, p_amount, 'deposit_retention', now(),
          v_descricao, p_created_by)
  RETURNING id INTO v_payment;

  INSERT INTO payment_allocations (tenant_id, payment_id, charge_id, amount, created_by)
  VALUES (p_tenant_id, v_payment, p_charge_id, p_amount, p_created_by);

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'deposit_retained',
      'description',   v_descricao,
      'source_module', 'payment',
      'source_id',     v_payment,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', 'caucoes_a_devolver', 'direction', 'debit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', p_rental_id, 'charge_id', p_charge_id),
      jsonb_build_object('account_code', 'contas_a_receber', 'direction', 'credit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', p_rental_id, 'charge_id', p_charge_id)
    )
  );

  RETURN v_payment;
END;
$$;

COMMENT ON FUNCTION fn_retain_deposit_on_charge IS
  'ADR 0026: retém caução NUMA cobrança específica, sob trava do cliente. Recusa acima do saldo da caução e acima do que a cobrança deve — reter sem dívida deixa de ser possível.';

GRANT EXECUTE ON FUNCTION fn_retain_deposit_on_charge TO authenticated, service_role;
