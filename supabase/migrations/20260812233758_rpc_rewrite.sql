-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 17/17: RPCs sobre o novo modelo.
--
-- Estas funções fazem apenas o que precisa de ATOMICIDADE ou de LOCK no banco.
-- Regra de negócio (cálculo de cronograma, rateio, alocação, classificação de
-- inadimplência) vive em @gomoto/core como função pura — o anti-padrão que a
-- ADR 0014 introduziu, de enterrar classificação em PL/pgSQL, não se repete.

-- ---------------------------------------------------------------------------
-- Criação de locação com cronograma
-- ---------------------------------------------------------------------------
-- Substitui create_rental_with_charges. A diferença estrutural: grava o PLANO,
-- não documentos. Um rent-to-own de 2 anos passa a criar 104 linhas de
-- cronograma em vez de 104 cobranças emitidas — "Total a receber" volta a
-- significar o que o nome diz (R-02).

CREATE OR REPLACE FUNCTION create_rental_with_schedule(
  p_tenant_id UUID,
  p_rental    JSONB,
  p_schedule  JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rental_id  UUID;
  v_vehicle_id UUID := (p_rental->>'vehicle_id')::uuid;
BEGIN
  -- Trava o veículo: impede duas locações concorrentes para a mesma moto.
  PERFORM 1 FROM vehicles
   WHERE id = v_vehicle_id AND tenant_id = p_tenant_id
     FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VEHICLE_NOT_FOUND';
  END IF;

  INSERT INTO rentals (
    tenant_id, customer_id, vehicle_id, start_date, end_date,
    cycle, cycle_amount, due_day, use_pro_rata, contract_type,
    status, observations, contract_template_id,
    checkin_checkout_inspection_profile_id, periodic_inspection_profile_id,
    periodic_inspection_frequency_days
  )
  SELECT
    p_tenant_id,
    (p_rental->>'customer_id')::uuid,
    v_vehicle_id,
    (p_rental->>'start_date')::date,
    (p_rental->>'end_date')::date,
    p_rental->>'cycle',
    (p_rental->>'cycle_amount')::numeric,
    (p_rental->>'due_day')::smallint,
    COALESCE((p_rental->>'use_pro_rata')::boolean, false),
    -- rentals_contract_type_check aceita apenas 'rental' e 'rent_to_own'
    COALESCE(p_rental->>'contract_type', 'rental'),
    'active',
    p_rental->>'observations',
    (p_rental->>'contract_template_id')::uuid,
    (p_rental->>'checkin_checkout_inspection_profile_id')::uuid,
    (p_rental->>'periodic_inspection_profile_id')::uuid,
    (p_rental->>'periodic_inspection_frequency_days')::int
  RETURNING id INTO v_rental_id;

  -- Cronograma vindo de generateSchedule() em @gomoto/core — a mesma função
  -- que alimenta o preview antes da confirmação (RF-036).
  INSERT INTO rental_billing_schedules (
    tenant_id, rental_id, sequence_number, period_start, period_end, due_date, amount
  )
  SELECT
    p_tenant_id,
    v_rental_id,
    (item->>'sequence_number')::int,
    (item->>'period_start')::date,
    (item->>'period_end')::date,
    (item->>'due_date')::date,
    (item->>'amount')::numeric
  FROM jsonb_array_elements(p_schedule) AS item;

  UPDATE vehicles SET status = 'rented', updated_at = now()
   WHERE id = v_vehicle_id AND tenant_id = p_tenant_id;

  RETURN v_rental_id;
END;
$$;

COMMENT ON FUNCTION create_rental_with_schedule IS
  'Spec 0014: cria locação + cronograma numa transação. Substitui create_rental_with_charges, que emitia documentos (ADR 0009 revertida).';

-- ---------------------------------------------------------------------------
-- Emissão das cobranças devidas
-- ---------------------------------------------------------------------------
-- Chamada pelo job diário (Vercel Cron → Route Handler) e disponível como ação
-- manual ao operador. Idempotente: só toca linhas 'scheduled', e a transição
-- para 'issued' com charge_id é atômica por linha.

CREATE OR REPLACE FUNCTION issue_due_charges(
  p_tenant_id  UUID,
  p_lead_days  INT DEFAULT 0
)
RETURNS TABLE (schedule_id UUID, charge_id UUID, charge_number BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      RECORD;
  v_charge   UUID;
  v_number   BIGINT;
  v_policy   UUID;
  v_customer UUID;
BEGIN
  SELECT id INTO v_policy
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id AND effective_from <= CURRENT_DATE
   ORDER BY effective_from DESC, version DESC
   LIMIT 1;

  FOR v_row IN
    SELECT s.*, r.customer_id, r.vehicle_id
      FROM rental_billing_schedules s
      JOIN rentals r ON r.id = s.rental_id
     WHERE s.tenant_id = p_tenant_id
       AND s.status    = 'scheduled'
       AND s.period_start <= CURRENT_DATE + p_lead_days
       AND r.status    = 'active'
     ORDER BY s.due_date
     FOR UPDATE OF s
  LOOP
    v_number := fn_next_charge_number(p_tenant_id);

    INSERT INTO charges (
      tenant_id, customer_id, rental_id, charge_number,
      due_date, late_charge_policy_id
    )
    VALUES (
      p_tenant_id, v_row.customer_id, v_row.rental_id, v_number,
      v_row.due_date, v_policy
    )
    RETURNING id INTO v_charge;

    INSERT INTO charge_items (
      tenant_id, charge_id, description, credit_account_code,
      unit_amount, amount, source_module, source_id, vehicle_id
    )
    VALUES (
      p_tenant_id, v_charge,
      'Locação ' || to_char(v_row.period_start, 'DD/MM/YYYY') ||
        ' a ' || to_char(v_row.period_end, 'DD/MM/YYYY'),
      'receita_locacao',
      v_row.amount, v_row.amount,
      'rental', v_row.rental_id, v_row.vehicle_id
    );

    UPDATE rental_billing_schedules
       SET status = 'issued', charge_id = v_charge, updated_at = now()
     WHERE id = v_row.id;

    schedule_id   := v_row.id;
    charge_id     := v_charge;
    charge_number := v_number;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION issue_due_charges IS
  'Spec 0014: emite as cobranças cujo período chegou. Idempotente — só consome linhas scheduled. O lançamento no ledger é responsabilidade do ChargeService.';

-- ---------------------------------------------------------------------------
-- Reajuste sobre o cronograma
-- ---------------------------------------------------------------------------
-- Toca apenas linhas ainda não emitidas. Período já emitido é documento
-- imutável — ajustá-lo exige cobrança complementar ou renegociação (Princípio 5).

CREATE OR REPLACE FUNCTION adjust_rental_schedule(
  p_tenant_id     UUID,
  p_rental_id     UUID,
  p_new_amount    NUMERIC,
  p_effective_from DATE,
  p_justification TEXT,
  p_adjusted_by   UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous NUMERIC;
  v_count    INT;
BEGIN
  SELECT cycle_amount INTO v_previous
    FROM rentals WHERE id = p_rental_id AND tenant_id = p_tenant_id;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_FOUND';
  END IF;

  UPDATE rental_billing_schedules
     SET amount = p_new_amount, updated_at = now()
   WHERE tenant_id  = p_tenant_id
     AND rental_id  = p_rental_id
     AND status     = 'scheduled'
     AND period_start >= p_effective_from;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE rentals
     SET cycle_amount = p_new_amount, updated_at = now()
   WHERE id = p_rental_id AND tenant_id = p_tenant_id;

  INSERT INTO rental_adjustments (
    tenant_id, rental_id, previous_cycle_amount, new_cycle_amount,
    updated_billings_count, justification, adjusted_by
  )
  VALUES (
    p_tenant_id, p_rental_id, v_previous, p_new_amount,
    v_count, p_justification, p_adjusted_by
  );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION adjust_rental_schedule IS
  'Spec 0014: reajuste sobre linhas scheduled. Nunca altera período já emitido — antes, adjust_rental reescrevia billings emitidos.';

-- ---------------------------------------------------------------------------
-- Encerramento com apuração
-- ---------------------------------------------------------------------------
-- Resolve F-08: hoje terminate_rental cancela pendentes, muda status e libera o
-- veículo — não consulta débito, não devolve nem retém caução, não apura nada.
--
-- Esta versão devolve a APURAÇÃO e recusa o encerramento se houver pendência
-- não resolvida. A decisão sobre a caução (reter ou devolver) é do operador e
-- vira transação no ledger via Server Action — não é decidida aqui.

CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_rental_id        UUID,
  p_termination_date DATE,
  p_new_status       TEXT DEFAULT 'closed',
  p_force            BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vehicle_id   UUID;
  v_open_amount  NUMERIC(14,2);
  v_open_count   INT;
  v_deposit      NUMERIC(14,2);
  v_cancelled    INT;
BEGIN
  SELECT vehicle_id INTO v_vehicle_id
    FROM rentals
   WHERE id = p_rental_id AND tenant_id = p_tenant_id AND status = 'active';

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Apuração: quanto ficou em aberto e quanto há de caução.
  SELECT COALESCE(SUM(open_amount), 0), COUNT(*)
    INTO v_open_amount, v_open_count
    FROM charge_balances
   WHERE rental_id = p_rental_id AND status = 'open' AND open_amount > 0;

  SELECT COALESCE(balance, 0) INTO v_deposit
    FROM deposit_balances WHERE rental_id = p_rental_id;
  v_deposit := COALESCE(v_deposit, 0);

  -- Sem p_force, encerramento com débito em aberto é recusado: a apuração
  -- financeira é pré-requisito do encerramento, não consequência.
  IF v_open_amount > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'RENTAL_HAS_OPEN_CHARGES: % cobrança(s), total %', v_open_count, v_open_amount
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cancela apenas o cronograma futuro ainda não emitido.
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
    'rental_id',           p_rental_id,
    'open_amount',         v_open_amount,
    'open_charges',        v_open_count,
    'deposit_balance',     v_deposit,
    'cancelled_schedules', v_cancelled,
    'requires_settlement',  v_deposit > 0 OR v_open_amount > 0
  );
END;
$$;

COMMENT ON FUNCTION terminate_rental IS
  'Spec 0014: encerra a locação devolvendo a apuração e recusando débito em aberto sem p_force. Resolve F-08 — a versão anterior não apurava nada.';
