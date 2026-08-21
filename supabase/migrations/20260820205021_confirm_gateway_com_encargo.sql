-- ---------------------------------------------------------------------------
-- A confirmação do gateway realiza o encargo antes de alocar
-- ---------------------------------------------------------------------------
-- Ordem importa: o encargo precisa virar item da cobrança ANTES da alocação,
-- senão o pagamento (que inclui o encargo) é maior que a dívida e
-- `charge_balances.open_amount` — que é `total − alocado`, sem piso em zero —
-- fica negativo.
--
-- O valor realizado é o que o QR cobrou (`payment_intents.accrued_amount`), não
-- um recálculo: entre gerar o código e o cliente pagar podem passar horas, e
-- recalcular daria outro número, deixando a conta sem fechar.

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
  v_accrued     NUMERIC;
  v_customer_id UUID;
  v_rental_id   UUID;
  v_number      INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE';
  END IF;

  SELECT charge_id, COALESCE(accrued_amount, 0)
    INTO v_charge_id, v_accrued
    FROM payment_intents
   WHERE id = p_intent_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTENT_NOT_FOUND';
  END IF;

  SELECT id INTO v_payment_id
    FROM payments
   WHERE payment_intent_id = p_intent_id AND tenant_id = p_tenant_id;

  IF FOUND THEN
    UPDATE payment_intents SET status = 'paid'
     WHERE id = p_intent_id AND status <> 'paid';
    RETURN v_payment_id;
  END IF;

  -- O encargo que o QR cobrou vira dívida de verdade, antes de receber.
  IF v_accrued > 0 THEN
    PERFORM fn_realize_late_charge(p_tenant_id, v_charge_id, v_accrued);
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
  'Confirma recebimento do gateway numa transação: realiza o encargo que o QR cobrou, cria pagamento, alocação, lançamento e status do intent. Idempotente pelo pagamento já ligado ao intent.';
