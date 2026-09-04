-- ---------------------------------------------------------------------------
-- Confirmação de pagamento do gateway numa transação só
-- ---------------------------------------------------------------------------
-- O webhook confirmava um recebimento em quatro requisições HTTP separadas ao
-- PostgREST: `payments`, `payment_allocations`, o lançamento no razão, e o
-- status do intent. Nenhuma transação em volta — qualquer falha no meio parte o
-- estado, e cada forma de partir tem um jeito diferente de dar errado:
--
--   * morreu após o pagamento → cobrança segue em aberto e o razão não viu o
--     dinheiro, mas a linha de `payments` existe;
--   * morreu após a alocação → cobrança quitada e caixa vazio no razão;
--   * morreu após o razão → tudo certo, menos o intent, que fica `pending`.
--
-- E como o guarda de idempotência do código perguntava pelo status do intent —
-- justamente o último passo — a retentativa do provedor não era barrada em
-- nenhum desses casos: ela criava um SEGUNDO pagamento do mesmo dinheiro.
--
-- Aqui os quatro passos viram um. Ou o recebimento existe inteiro, ou não
-- existe: não há estado intermediário para uma retentativa encontrar. E a
-- idempotência deixa de depender de um passo que pode não ter acontecido — a
-- função procura o pagamento já ligado ao intent e devolve o mesmo id, sem
-- efeito nenhum. Reprocessar o inbox quantas vezes for preciso é seguro.
--
-- SECURITY INVOKER: quem chama é a Edge Function com `service_role`, que já
-- ignora RLS por ser backend confiável. Não há motivo para a função carregar
-- privilégio próprio.

CREATE OR REPLACE FUNCTION fn_confirm_gateway_payment(
  p_tenant_id   UUID,
  p_intent_id   UUID,
  p_amount      NUMERIC,
  p_paid_at     TIMESTAMPTZ,
  p_method      payment_method_type DEFAULT 'pix',
  p_notes       TEXT DEFAULT 'Confirmado pelo gateway'
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_id  UUID;
  v_charge_id   UUID;
  v_customer_id UUID;
  v_rental_id   UUID;
  v_number      INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE';
  END IF;

  -- Trava o intent: duas entregas simultâneas do mesmo evento serializam aqui,
  -- e a segunda encontra o pagamento que a primeira criou.
  SELECT charge_id INTO v_charge_id
    FROM payment_intents
   WHERE id = p_intent_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTENT_NOT_FOUND';
  END IF;

  -- Idempotência ancorada no fato (o pagamento existe), não no último passo.
  SELECT id INTO v_payment_id
    FROM payments
   WHERE payment_intent_id = p_intent_id AND tenant_id = p_tenant_id;

  IF FOUND THEN
    UPDATE payment_intents SET status = 'paid'
     WHERE id = p_intent_id AND status <> 'paid';
    RETURN v_payment_id;
  END IF;

  SELECT customer_id, rental_id, charge_number
    INTO v_customer_id, v_rental_id, v_number
    FROM charges
   WHERE id = v_charge_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  INSERT INTO payments (tenant_id, customer_id, amount, method, paid_at,
                        payment_intent_id, notes)
  VALUES (p_tenant_id, v_customer_id, p_amount, p_method, p_paid_at,
          p_intent_id, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO payment_allocations (tenant_id, payment_id, charge_id, amount)
  VALUES (p_tenant_id, v_payment_id, v_charge_id, p_amount);

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'payment_received',
      'description',   'Recebimento via gateway — cobrança #' || v_number,
      'occurred_at',   p_paid_at,
      'source_module', 'payment',
      'source_id',     v_payment_id
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', 'caixa_e_bancos', 'direction', 'debit',
                         'amount', p_amount, 'customer_id', v_customer_id,
                         'rental_id', v_rental_id, 'charge_id', v_charge_id),
      jsonb_build_object('account_code', 'contas_a_receber', 'direction', 'credit',
                         'amount', p_amount, 'customer_id', v_customer_id,
                         'rental_id', v_rental_id, 'charge_id', v_charge_id)
    )
  );

  UPDATE payment_intents SET status = 'paid' WHERE id = p_intent_id;

  RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION fn_confirm_gateway_payment IS
  'Confirma um recebimento do gateway em uma transação: pagamento, alocação, lançamento no razão e status do intent. Idempotente pelo pagamento já ligado ao intent.';

GRANT EXECUTE ON FUNCTION fn_confirm_gateway_payment TO service_role;
