-- ============================================================
-- Migration 0004-3: Spec 0004 — RPCs atômicos de locação
-- create_rental_with_charges, terminate_rental, renew_rental
-- Todos SECURITY DEFINER — tenant_id validado pelo caller (Server Action).
-- ============================================================

-- ============================================================
-- RPC: criar locação com cobranças (operação atômica)
-- Usa SELECT FOR UPDATE NOWAIT para evitar locação concorrente.
-- ============================================================
CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id      UUID,
  p_motorcycle_id  UUID,
  p_customer_id    UUID,
  p_cycle          TEXT,
  p_due_day        INTEGER,
  p_cycle_amount   NUMERIC,
  p_start_date     DATE,
  p_end_date       DATE,
  p_use_pro_rata   BOOLEAN,
  p_charges        JSONB   -- [{ due_date, amount, billing_type }]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id UUID;
BEGIN
  -- Tenta adquirir lock no veículo (falha imediata se já locado)
  PERFORM id FROM rentals
  WHERE motorcycle_id = p_motorcycle_id
    AND status = 'active'
    AND tenant_id = p_tenant_id
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED';
  END IF;

  -- Criar locação
  INSERT INTO rentals (
    tenant_id, motorcycle_id, customer_id,
    cycle, due_day, cycle_amount, use_pro_rata,
    start_date, end_date, status
  ) VALUES (
    p_tenant_id, p_motorcycle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active'
  ) RETURNING id INTO v_lease_id;

  -- Bulk insert de cobranças em um único statement
  INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
  SELECT
    p_tenant_id,
    v_lease_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending'
  FROM jsonb_array_elements(p_charges) AS c;

  RETURN v_lease_id;
END;
$$;

-- ============================================================
-- RPC: encerrar locação
-- Cancela cobranças futuras e fecha (ou transfere) a locação.
-- ============================================================
CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_lease_id         UUID,
  p_termination_date DATE,
  p_new_status       TEXT DEFAULT 'closed'  -- 'closed' ou 'transferred'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Cancelar cobranças futuras pendentes
  UPDATE billings
  SET status = 'cancelled', updated_at = now()
  WHERE lease_id = p_lease_id
    AND tenant_id = p_tenant_id
    AND due_date > p_termination_date
    AND status = 'pending';

  -- Encerrar locação
  UPDATE rentals
  SET status    = p_new_status,
      end_date  = p_termination_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;
END;
$$;

-- ============================================================
-- RPC: renovar locação
-- Atualiza data de fim e insere novas cobranças.
-- ============================================================
CREATE OR REPLACE FUNCTION renew_rental(
  p_tenant_id            UUID,
  p_lease_id             UUID,
  p_new_end_date         DATE,
  p_complementary_action JSONB,  -- { action: 'update'|'insert', billing_id?, amount, due_date? }
  p_new_charges          JSONB   -- [{ due_date, amount, billing_type }]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Atualizar data de fim
  UPDATE rentals
  SET end_date   = p_new_end_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  -- Tratar última cobrança (recalcular ou inserir complementar)
  IF p_complementary_action IS NOT NULL THEN
    IF (p_complementary_action->>'action') = 'update' THEN
      UPDATE billings
      SET original_amount = (p_complementary_action->>'amount')::NUMERIC,
          updated_at = now()
      WHERE id = (p_complementary_action->>'billing_id')::UUID
        AND tenant_id = p_tenant_id;
    ELSE
      -- 'insert': criar cobrança complementar
      INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
      VALUES (
        p_tenant_id, p_lease_id,
        (p_complementary_action->>'amount')::NUMERIC,
        (p_complementary_action->>'due_date')::DATE,
        'complementary', 'pending'
      );
    END IF;
  END IF;

  -- Bulk insert novas cobranças de ciclo
  IF p_new_charges IS NOT NULL AND jsonb_array_length(p_new_charges) > 0 THEN
    INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
    SELECT
      p_tenant_id, p_lease_id,
      (c->>'amount')::NUMERIC,
      (c->>'due_date')::DATE,
      COALESCE(c->>'billing_type', 'cycle'),
      'pending'
    FROM jsonb_array_elements(p_new_charges) AS c;
  END IF;
END;
$$;
