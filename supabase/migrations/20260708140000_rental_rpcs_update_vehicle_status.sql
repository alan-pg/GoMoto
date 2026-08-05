-- As RPCs de locação nunca atualizavam vehicles.status, causando veículos
-- alugados a continuar aparecendo como disponíveis.
-- Corrige create_rental_with_charges e terminate_rental.

-- ============================================================
-- RPC: criar locação — marca veículo como 'rented'
-- ============================================================
CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id        UUID,
  p_vehicle_id       UUID,
  p_customer_id      UUID,
  p_cycle            TEXT,
  p_due_day          INTEGER,
  p_cycle_amount     NUMERIC,
  p_start_date       DATE,
  p_end_date         DATE,
  p_use_pro_rata     BOOLEAN,
  p_charges          JSONB,
  p_security_deposit NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id UUID;
BEGIN
  -- Lock no veículo para evitar locação concorrente
  PERFORM id FROM rentals
  WHERE vehicle_id = p_vehicle_id
    AND status = 'active'
    AND tenant_id = p_tenant_id
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED';
  END IF;

  -- Criar locação
  INSERT INTO rentals (
    tenant_id, vehicle_id, customer_id,
    cycle, due_day, cycle_amount, use_pro_rata,
    start_date, end_date, status, security_deposit
  ) VALUES (
    p_tenant_id, p_vehicle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active', p_security_deposit
  ) RETURNING id INTO v_lease_id;

  -- Bulk insert de cobranças
  INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
  SELECT
    p_tenant_id,
    v_lease_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending'
  FROM jsonb_array_elements(p_charges) AS c;

  -- Marcar veículo como alugado
  UPDATE vehicles
  SET status     = 'rented',
      updated_at = now()
  WHERE id = p_vehicle_id AND tenant_id = p_tenant_id;

  RETURN v_lease_id;
END;
$$;

-- ============================================================
-- RPC: encerrar locação — devolve veículo para 'available'
-- ============================================================
CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_lease_id         UUID,
  p_termination_date DATE,
  p_new_status       TEXT DEFAULT 'closed'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id UUID;
BEGIN
  SELECT vehicle_id INTO v_vehicle_id
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active';

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Cancelar cobranças futuras pendentes
  UPDATE billings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE lease_id    = p_lease_id
    AND tenant_id   = p_tenant_id
    AND due_date    > p_termination_date
    AND status      = 'pending';

  -- Encerrar locação
  UPDATE rentals
  SET status     = p_new_status,
      end_date   = p_termination_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  -- Devolver veículo para disponível
  UPDATE vehicles
  SET status     = 'available',
      updated_at = now()
  WHERE id = v_vehicle_id AND tenant_id = p_tenant_id;
END;
$$;
