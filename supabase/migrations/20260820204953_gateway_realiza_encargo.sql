-- ---------------------------------------------------------------------------
-- Pagar pelo app deixava a cobrança com saldo NEGATIVO
-- ---------------------------------------------------------------------------
-- O QR é gerado por `calculateAmountDue`: principal MAIS o encargo do atraso.
-- O cliente paga esse valor. Mas `fn_confirm_gateway_payment` apenas alocava o
-- recebido, sem transformar o encargo em item da cobrança — que continuava
-- devendo só o principal.
--
-- Reproduzido: cobrança de R$ 350 vencida há 30 dias, app cobra R$ 360,47,
-- cliente paga, e o resultado é `open_amount = −10,47` com R$ 0,00 de receita
-- de encargo lançada. O encargo sumia do DRE e o saldo ficava negativo.
--
-- É o mesmo defeito que `realizeAccruedBefore` corrigiu no recebimento manual;
-- o caminho do gateway ficou de fora.
--
-- A correção NÃO recalcula o encargo aqui. O valor já foi decidido quando o QR
-- foi criado — recalcular no momento da confirmação daria outro número (mais
-- dias se passaram) e o pagamento deixaria de fechar. Guarda-se o encargo na
-- tentativa e realiza-se exatamente ele.

ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS accrued_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payment_intents.accrued_amount IS
  'Quanto deste QR é encargo por atraso. Fixado na criação — o valor cobrado do cliente não pode mudar depois que o código foi gerado.';

-- ---------------------------------------------------------------------------
-- Realização do encargo, em SQL
-- ---------------------------------------------------------------------------
-- Espelha `realizeLateCharge` de lib/financial/charges.ts. O CÁLCULO continua
-- só em @gomoto/core — aqui é só o lançamento, que precisa acontecer dentro da
-- transação da confirmação: encargo realizado com pagamento não confirmado
-- inflaria a dívida do cliente sozinho.
CREATE OR REPLACE FUNCTION fn_realize_late_charge(
  p_tenant_id  UUID,
  p_charge_id  UUID,
  p_amount     NUMERIC,
  p_created_by UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer UUID;
  v_rental   UUID;
  v_vehicle  UUID;
  v_number   BIGINT;
  v_dias     INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  SELECT customer_id, rental_id, charge_number,
         GREATEST(0, CURRENT_DATE - due_date)
    INTO v_customer, v_rental, v_number, v_dias
    FROM charges
   WHERE id = p_charge_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  -- Mesma resolução do TS: veículo do item, senão o da locação. Sem a dimensão
  -- o encargo some do resultado da moto, que agrega por `vehicle_id`.
  SELECT vehicle_id INTO v_vehicle
    FROM charge_items
   WHERE charge_id = p_charge_id AND vehicle_id IS NOT NULL
   LIMIT 1;

  IF v_vehicle IS NULL AND v_rental IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle
      FROM rentals WHERE id = v_rental AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO charge_items (
    tenant_id, charge_id, description, credit_account_code,
    quantity, unit_amount, amount, vehicle_id, source_module, source_id
  ) VALUES (
    p_tenant_id, p_charge_id,
    'Encargo por atraso (' || v_dias || ' dias)',
    'receita_encargos_atraso',
    1, p_amount, p_amount, v_vehicle, 'late_charge', p_charge_id
  );

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'late_charge_realized',
      'description',   'Encargo realizado — cobrança #' || v_number,
      'source_module', 'late_charge',
      'source_id',     p_charge_id,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code','contas_a_receber','direction','debit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id),
      jsonb_build_object('account_code','receita_encargos_atraso','direction','credit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id)
    )
  );
END;
$$;

COMMENT ON FUNCTION fn_realize_late_charge IS
  'Transforma encargo projetado em item da cobrança e receita. Espelha realizeLateCharge do lib; o cálculo do valor continua em @gomoto/core.';

GRANT EXECUTE ON FUNCTION fn_realize_late_charge TO authenticated, service_role;
