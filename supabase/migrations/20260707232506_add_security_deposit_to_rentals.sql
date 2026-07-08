-- Adiciona caução (depósito de segurança) à locação
-- O campo é opcional: nem todos os contratos exigem caução
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS security_deposit              NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS security_deposit_returned_at  DATE          NULL;

-- Atualiza RPC para aceitar caução (parâmetro com DEFAULT NULL mantém retrocompatibilidade)
CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id          UUID,
  p_vehicle_id         UUID,
  p_customer_id        UUID,
  p_cycle              TEXT,
  p_due_day            INTEGER,
  p_cycle_amount       NUMERIC,
  p_start_date         DATE,
  p_end_date           DATE,
  p_use_pro_rata       BOOLEAN,
  p_charges            JSONB,
  p_security_deposit   NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id UUID;
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
    security_deposit
  ) VALUES (
    p_tenant_id, p_vehicle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active',
    p_security_deposit
  ) RETURNING id INTO v_lease_id;

  INSERT INTO billings (tenant_id, lease_id, customer_id, original_amount, due_date, billing_type, status)
  SELECT
    p_tenant_id,
    v_lease_id,
    p_customer_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending'
  FROM jsonb_array_elements(p_charges) AS c;

  RETURN v_lease_id;
END;
$$;
