-- Módulo Financeiro (Spec 0008) — Passo 10: extensão de rentals
-- Adiciona late_charge_config; migra security_deposit para tabela deposits;
-- atualiza RPC create_rental_with_charges para compatibilidade com novo schema.

BEGIN;

-- ============================================================
-- 1. Adiciona late_charge_config à locação
-- ============================================================
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS late_charge_config JSONB;

-- ============================================================
-- 2. Backfill: migra security_deposit existente para deposits
-- Sistema pré-produção — sem dados históricos esperados.
-- ============================================================
INSERT INTO deposits (
  tenant_id, rental_id, customer_id,
  amount, balance, status, received_at
)
SELECT
  r.tenant_id,
  r.id,
  r.customer_id,
  r.security_deposit,
  CASE
    WHEN r.security_deposit_returned_at IS NOT NULL THEN 0
    ELSE r.security_deposit
  END,
  CASE
    WHEN r.security_deposit_returned_at IS NOT NULL
    THEN 'fully_returned'::deposit_status
    ELSE 'received'::deposit_status
  END,
  r.start_date
FROM rentals r
WHERE r.security_deposit IS NOT NULL;

-- ============================================================
-- 3. Atualiza RPC create_rental_with_charges
-- - Mantém p_security_deposit para retrocompatibilidade com actions.ts existente
-- - Remove security_deposit do INSERT em rentals (coluna será dropada)
-- - Cria registro em deposits se p_security_deposit fornecido
-- - Adiciona p_late_charge_config (DEFAULT NULL — actions.ts existente não passa)
-- ============================================================
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
  p_security_deposit   NUMERIC DEFAULT NULL,
  p_late_charge_config JSONB   DEFAULT NULL
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
    late_charge_config
  ) VALUES (
    p_tenant_id, p_vehicle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active',
    p_late_charge_config
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
    INSERT INTO deposits (
      tenant_id, rental_id, customer_id,
      amount, balance, status, received_at
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_security_deposit, p_security_deposit,
      'received', p_start_date
    );
  END IF;

  UPDATE vehicles
  SET status     = 'rented',
      updated_at = now()
  WHERE id = p_vehicle_id AND tenant_id = p_tenant_id;

  RETURN v_lease_id;
END;
$$;

-- ============================================================
-- 4. Drop das colunas de security_deposit (agora em deposits)
-- ============================================================
ALTER TABLE rentals
  DROP COLUMN IF EXISTS security_deposit,
  DROP COLUMN IF EXISTS security_deposit_returned_at;

COMMIT;
