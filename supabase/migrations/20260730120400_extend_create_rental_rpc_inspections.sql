-- ============================================================
-- Spec 0009 — Módulo de Vistoria
-- Migration 5: create_rental_with_charges passa a aceitar os vínculos
-- de Perfil de Vistoria e, na mesma transação, cria a vistoria de
-- check-in/check-out pendente (RF-009) e os agendamentos de vistoria
-- periódica upfront (RF-011) — mesmo padrão de geração antecipada de
-- cobranças (ADR 0009).
-- ============================================================

DROP FUNCTION IF EXISTS create_rental_with_charges(
  UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB, NUMERIC, JSONB, BOOLEAN, DATE, DATE
);

CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id            UUID,
  p_vehicle_id           UUID,
  p_customer_id          UUID,
  p_cycle                TEXT,
  p_due_day              INTEGER,
  p_cycle_amount         NUMERIC,
  p_start_date           DATE,
  p_end_date             DATE,
  p_use_pro_rata         BOOLEAN,
  p_charges              JSONB,
  p_security_deposit     NUMERIC  DEFAULT NULL,
  p_late_charge_config   JSONB    DEFAULT NULL,
  p_deposit_paid         BOOLEAN  DEFAULT true,
  p_deposit_payment_date DATE     DEFAULT NULL,
  p_deposit_due_date     DATE     DEFAULT NULL,
  p_checkin_checkout_inspection_profile_id UUID    DEFAULT NULL,
  p_periodic_inspection_profile_id         UUID    DEFAULT NULL,
  p_periodic_inspection_frequency_days     INTEGER DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id           UUID;
  v_deposit_billing_id UUID;
  v_deposit_due_date   DATE;
  v_schedule_date      DATE;
BEGIN
  PERFORM id FROM rentals
  WHERE vehicle_id = p_vehicle_id
    AND status = 'active'
    AND tenant_id = p_tenant_id
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED';
  END IF;

  INSERT INTO rentals (
    tenant_id, vehicle_id, customer_id,
    cycle, due_day, cycle_amount, use_pro_rata,
    start_date, end_date, status,
    late_charge_config,
    checkin_checkout_inspection_profile_id,
    periodic_inspection_profile_id,
    periodic_inspection_frequency_days
  ) VALUES (
    p_tenant_id, p_vehicle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active',
    p_late_charge_config,
    p_checkin_checkout_inspection_profile_id,
    p_periodic_inspection_profile_id,
    p_periodic_inspection_frequency_days
  ) RETURNING id INTO v_lease_id;

  INSERT INTO billings (
    tenant_id, lease_id, customer_id,
    original_amount, due_date, billing_type, source, status,
    description, late_charge_config
  )
  SELECT
    p_tenant_id,
    v_lease_id,
    p_customer_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'rental_cycle',
    'pending',
    NULLIF(TRIM(c->>'description'), ''),
    p_late_charge_config
  FROM jsonb_array_elements(p_charges) AS c;

  IF p_security_deposit IS NOT NULL THEN
    -- Paga: due_date = data do pagamento (não faz sentido vencer no futuro
    -- uma cobrança já quitada). Pendente: due_date = data de vencimento informada.
    v_deposit_due_date := CASE
      WHEN p_deposit_paid THEN COALESCE(p_deposit_payment_date, p_start_date)
      ELSE COALESCE(p_deposit_due_date, p_start_date)
    END;

    INSERT INTO billings (
      tenant_id, lease_id, customer_id,
      original_amount, due_date, billing_type, source, status,
      description, paid_at
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_security_deposit, v_deposit_due_date, 'deposit', 'deposit',
      CASE WHEN p_deposit_paid THEN 'paid' ELSE 'pending' END,
      'Caução',
      CASE WHEN p_deposit_paid THEN COALESCE(p_deposit_payment_date, p_start_date) END
    ) RETURNING id INTO v_deposit_billing_id;

    INSERT INTO deposits (
      tenant_id, rental_id, customer_id,
      amount, balance, status, received_at, billing_id
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_security_deposit,
      CASE WHEN p_deposit_paid THEN p_security_deposit ELSE 0 END,
      (CASE WHEN p_deposit_paid THEN 'received' ELSE 'pending' END)::deposit_status,
      CASE WHEN p_deposit_paid THEN COALESCE(p_deposit_payment_date, p_start_date) END,
      v_deposit_billing_id
    );
  END IF;

  UPDATE vehicles
  SET status     = 'rented',
      updated_at = now()
  WHERE id = p_vehicle_id AND tenant_id = p_tenant_id;

  -- Vistoria de check-in/check-out (RF-009, RF-010, RN-001, RN-002, RN-003):
  -- as duas nascem 'pending' na mesma transação — check-out só é listado como
  -- executável pela UI quando rentals.status indica encerrada (Spec 0009 §3.1).
  IF p_checkin_checkout_inspection_profile_id IS NOT NULL THEN
    INSERT INTO inspections (
      tenant_id, rental_id, inspection_profile_id, kind, status
    ) VALUES
      (p_tenant_id, v_lease_id, p_checkin_checkout_inspection_profile_id, 'checkin',  'pending'),
      (p_tenant_id, v_lease_id, p_checkin_checkout_inspection_profile_id, 'checkout', 'pending');
  END IF;

  -- Agendamento upfront de vistoria periódica (RF-011): 1 linha por ciclo,
  -- de start_date + frequência até end_date — mesmo padrão de geração
  -- antecipada de cobranças (ADR 0009).
  IF p_periodic_inspection_profile_id IS NOT NULL AND p_periodic_inspection_frequency_days IS NOT NULL THEN
    v_schedule_date := p_start_date + (p_periodic_inspection_frequency_days || ' days')::INTERVAL;
    WHILE v_schedule_date <= p_end_date LOOP
      INSERT INTO inspection_schedules (tenant_id, rental_id, target_date)
      VALUES (p_tenant_id, v_lease_id, v_schedule_date);
      v_schedule_date := v_schedule_date + (p_periodic_inspection_frequency_days || ' days')::INTERVAL;
    END LOOP;
  END IF;

  RETURN v_lease_id;
END;
$$;
