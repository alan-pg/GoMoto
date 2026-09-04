-- ---------------------------------------------------------------------------
-- Encerramento apura também o crédito do cliente
-- ---------------------------------------------------------------------------
-- `terminate_rental` apurava caução e cobranças em aberto, e sinalizava
-- `requires_settlement`. O crédito do cliente ficava de fora — e é passivo
-- igual à caução: dinheiro que a empresa deve devolver.
--
-- A consequência: o contrato encerra, não existe mais cobrança futura para
-- abater, ninguém é avisado, e o cliente vai embora credor com o passivo
-- pendurado no balanço para sempre.
--
-- O crédito é do CLIENTE, não da locação — ele sobrevive ao contrato e vale
-- para o próximo. Por isso entra na apuração como informação (o operador
-- decide se devolve agora ou guarda), enquanto a caução, que é daquele
-- contrato, continua sendo o caso que pede ação.

CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_rental_id        UUID,
  p_termination_date DATE,
  p_new_status       TEXT    DEFAULT 'closed',
  p_force            BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id   UUID;
  v_customer_id  UUID;
  v_open_amount  NUMERIC(14,2);
  v_open_count   INT;
  v_deposit      NUMERIC(14,2);
  v_credit       NUMERIC(14,2);
  v_cancelled    INT;
BEGIN
  SELECT vehicle_id, customer_id INTO v_vehicle_id, v_customer_id
    FROM rentals
   WHERE id = p_rental_id AND tenant_id = p_tenant_id AND status = 'active';

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  SELECT COALESCE(SUM(open_amount), 0), COUNT(*)
    INTO v_open_amount, v_open_count
    FROM charge_balances
   WHERE rental_id = p_rental_id AND status = 'open' AND open_amount > 0;

  SELECT COALESCE(balance, 0) INTO v_deposit
    FROM deposit_balances WHERE rental_id = p_rental_id;
  v_deposit := COALESCE(v_deposit, 0);

  -- Saldo de crédito do cliente. Derivado do razão, como todo saldo.
  SELECT COALESCE(balance, 0) INTO v_credit
    FROM customer_credit_balances
   WHERE tenant_id = p_tenant_id AND customer_id = v_customer_id;
  v_credit := COALESCE(v_credit, 0);

  IF v_open_amount > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'RENTAL_HAS_OPEN_CHARGES: % cobrança(s), total %', v_open_count, v_open_amount
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rental_billing_schedules
     SET status = 'cancelled', updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND rental_id = p_rental_id
     AND status    = 'scheduled'
     AND period_start > p_termination_date;

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE rentals
     SET status = p_new_status, end_date = p_termination_date, updated_at = now()
   WHERE id = p_rental_id AND tenant_id = p_tenant_id;

  UPDATE vehicles
     SET status = 'available', updated_at = now()
   WHERE id = v_vehicle_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'rental_id',            p_rental_id,
    'customer_id',          v_customer_id,
    'open_amount',          v_open_amount,
    'open_charges',         v_open_count,
    'deposit_balance',      v_deposit,
    'credit_balance',       v_credit,
    'cancelled_schedules',  v_cancelled,
    'requires_settlement',  v_deposit > 0 OR v_open_amount > 0 OR v_credit > 0
  );
END;
$$;

COMMENT ON FUNCTION terminate_rental IS
  'Encerra a locação apurando cobranças em aberto, caução E crédito do cliente. Crédito é passivo como a caução: sem apurá-lo, o cliente ia embora credor e a dívida ficava no balanço.';
