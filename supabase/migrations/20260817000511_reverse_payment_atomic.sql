-- ---------------------------------------------------------------------------
-- Estorno de pagamento: uma transação, e que funcione para crédito também
-- ---------------------------------------------------------------------------
-- `reversePayment` fazia três coisas em sequência, cada uma na sua transação:
--
--   1. marcava `payments.reversed_at`
--   2. para cada alocação, procurava a transação de recebimento e lançava a
--      inversa
--   3. devolvia a cobrança para `open`
--
-- Na ordem errada. Se o passo 2 falhasse — e ele falha —, o pagamento já
-- constava estornado enquanto o razão seguia mostrando o dinheiro recebido e a
-- cobrança quitada. Divergência silenciosa entre o que a tela diz e o que o
-- razão registra, que é o pior estado possível num sistema contábil.
--
-- E o passo 2 falha num caso alcançável: abatimento por CRÉDITO do cliente
-- também cria linha em `payments` (`method = 'credit'`), mas lança
-- `credit_applied`, não `payment_received`. A busca filtrava por
-- `event_type = 'payment_received'` e não achava nada — exceção lançada
-- DEPOIS do passo 1.
--
-- Aqui o estorno é uma transação só, e é genérico: em vez de reconstruir as
-- pernas a partir do tipo de evento, ele COPIA as pernas da transação original
-- invertendo a direção. Um estorno é exatamente isso, e assim vale para
-- qualquer evento — recebimento, crédito, e o que vier depois — sem que esta
-- função precise conhecer o plano de contas.
--
-- Devolver o crédito não exige nada extra: `customer_credit_balances` é
-- `-sum(amount_signed)` sobre `creditos_de_clientes`, então inverter a perna
-- restaura o saldo por construção (Princípio 2).
--
-- Decisão do Alan (2026-08-17): estorno precisa ser possível e não gerar erro.

CREATE OR REPLACE FUNCTION fn_reverse_payment(
  p_tenant_id   UUID,
  p_payment_id  UUID,
  p_reason      TEXT,
  p_reversed_by UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer  UUID;
  v_reversed  TIMESTAMPTZ;
  v_tx        RECORD;
  v_legs      JSONB;
  v_count     INT := 0;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REVERSAL_REASON_REQUIRED';
  END IF;

  SELECT customer_id, reversed_at INTO v_customer, v_reversed
  FROM payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;
  IF v_reversed IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_REVERSED';
  END IF;

  -- Toda transação deste pagamento que ainda não foi estornada. O vínculo é
  -- (source_module, source_id) — o mesmo par para recebimento em dinheiro e
  -- para abatimento por crédito.
  FOR v_tx IN
    SELECT ft.id, ft.event_type, ft.description
      FROM financial_transactions ft
     WHERE ft.tenant_id = p_tenant_id
       AND ft.source_module = 'payment'
       AND ft.source_id = p_payment_id
       AND NOT EXISTS (
             SELECT 1 FROM financial_transactions r
              WHERE r.reverses_transaction_id = ft.id)
     ORDER BY ft.created_at
  LOOP
    -- Pernas invertidas, dimensões preservadas: sem elas o estorno some do
    -- resultado do veículo e do cliente enquanto o lançamento original continua
    -- lá, e o relatório passa a mostrar receita que foi desfeita.
    SELECT jsonb_agg(
             jsonb_build_object(
               'account_code', e.account_code,
               'direction',    CASE e.direction WHEN 'debit' THEN 'credit' ELSE 'debit' END,
               'amount',       e.amount,
               'customer_id',  e.customer_id,
               'vehicle_id',   e.vehicle_id,
               'rental_id',    e.rental_id,
               'charge_id',    e.charge_id,
               'payable_id',   e.payable_id
             ) ORDER BY e.id)
      INTO v_legs
      FROM financial_entries e
     WHERE e.transaction_id = v_tx.id;

    IF v_legs IS NULL OR jsonb_array_length(v_legs) < 2 THEN
      RAISE EXCEPTION 'REVERSAL_SOURCE_UNBALANCED: transação % sem pernas', v_tx.id;
    END IF;

    PERFORM post_financial_transaction(
      p_tenant_id,
      jsonb_build_object(
        'event_type',              'payment_reversed',
        'description',             'Estorno — ' || p_reason,
        'source_module',           'payment',
        'source_id',               p_payment_id,
        'reverses_transaction_id', v_tx.id,
        'created_by',              p_reversed_by
      ),
      v_legs
    );

    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_REVERSE';
  END IF;

  UPDATE payments
     SET reversed_at     = now(),
         reversal_reason = p_reason,
         reversed_by     = p_reversed_by
   WHERE id = p_payment_id AND tenant_id = p_tenant_id;

  -- `paid` em `charges` guarda decisão derivada do saldo; com o pagamento
  -- desfeito, a cobrança volta a ficar em aberto. Cancelada ou baixada não se
  -- mexe: são decisões humanas e não dependem deste pagamento.
  UPDATE charges c
     SET status = 'open'
    FROM payment_allocations a
   WHERE a.payment_id = p_payment_id
     AND c.id = a.charge_id
     AND c.tenant_id = p_tenant_id
     AND c.status = 'paid';

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION fn_reverse_payment IS
  'Estorna um pagamento numa transação só, invertendo as pernas de cada lançamento de origem. Serve recebimento em dinheiro e abatimento por crédito — o crédito volta ao saldo por construção.';

REVOKE EXECUTE ON FUNCTION fn_reverse_payment(UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_reverse_payment(UUID, UUID, TEXT, UUID) TO authenticated;
