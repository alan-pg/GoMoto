-- ============================================================
-- Migration: billing_fine_type_and_fixes
-- 1. Adiciona billing_type 'fine' + FK fine_id para rastrear multas cobradas
-- 2. Atualiza RPC create_rental_with_charges: description + customer_id nos billings
-- 3. Atualiza RPC renew_rental: customer_id + description nas novas cobranças
-- 4. Corrige RLS mobile: customer_read_own_billings cobre customer_id direto
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Novo billing_type 'fine' e FK fine_id
-- ============================================================

ALTER TABLE billings
  DROP CONSTRAINT IF EXISTS billings_billing_type_check;

ALTER TABLE billings
  ADD CONSTRAINT billings_billing_type_check
  CHECK (billing_type IN ('cycle', 'one_time', 'complementary', 'fine'));

ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS fine_id UUID REFERENCES fines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billings_fine_id ON billings(tenant_id, fine_id)
  WHERE fine_id IS NOT NULL;

-- ============================================================
-- 2. RPC create_rental_with_charges — adiciona description e customer_id
-- (Substitui versão de 20260707232506_add_security_deposit_to_rentals.sql)
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

  INSERT INTO billings (
    tenant_id, lease_id, customer_id,
    original_amount, due_date, billing_type, status,
    description
  )
  SELECT
    p_tenant_id,
    v_lease_id,
    p_customer_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending',
    NULLIF(TRIM(c->>'description'), '')
  FROM jsonb_array_elements(p_charges) AS c;

  RETURN v_lease_id;
END;
$$;

-- ============================================================
-- 3. RPC renew_rental — adiciona customer_id e description
-- (Substitui versão de 20260624000003_rental_rpcs.sql)
-- ============================================================
CREATE OR REPLACE FUNCTION renew_rental(
  p_tenant_id            UUID,
  p_lease_id             UUID,
  p_new_end_date         DATE,
  p_complementary_action JSONB,
  p_new_charges          JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  UPDATE rentals
  SET end_date   = p_new_end_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  IF p_complementary_action IS NOT NULL THEN
    IF (p_complementary_action->>'action') = 'update' THEN
      UPDATE billings
      SET original_amount = (p_complementary_action->>'amount')::NUMERIC,
          updated_at = now()
      WHERE id = (p_complementary_action->>'billing_id')::UUID
        AND tenant_id = p_tenant_id;
    ELSE
      INSERT INTO billings (
        tenant_id, lease_id, customer_id,
        original_amount, due_date, billing_type, status,
        description
      ) VALUES (
        p_tenant_id, p_lease_id, v_customer_id,
        (p_complementary_action->>'amount')::NUMERIC,
        (p_complementary_action->>'due_date')::DATE,
        'complementary', 'pending',
        NULLIF(TRIM(p_complementary_action->>'description'), '')
      );
    END IF;
  END IF;

  IF p_new_charges IS NOT NULL AND jsonb_array_length(p_new_charges) > 0 THEN
    INSERT INTO billings (
      tenant_id, lease_id, customer_id,
      original_amount, due_date, billing_type, status,
      description
    )
    SELECT
      p_tenant_id,
      p_lease_id,
      v_customer_id,
      (c->>'amount')::NUMERIC,
      (c->>'due_date')::DATE,
      COALESCE(c->>'billing_type', 'cycle'),
      'pending',
      NULLIF(TRIM(c->>'description'), '')
    FROM jsonb_array_elements(p_new_charges) AS c;
  END IF;
END;
$$;

-- ============================================================
-- 4. Corrige RLS mobile: inclui cobranças via customer_id direto
-- (Substitui "customer_read_own_billings" de 20260624000002)
-- ============================================================
DROP POLICY IF EXISTS "customer_read_own_billings" ON billings;

CREATE POLICY "customer_read_own_billings" ON billings
  FOR SELECT TO authenticated
  USING (
    -- Cobranças vinculadas a locação do cliente (cycle, one_time, complementary)
    lease_id IN (
      SELECT r.id FROM rentals r
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = auth.uid()
        AND r.tenant_id = billings.tenant_id
    )
    OR
    -- Cobranças avulsas sem locação ou cobranças de multa vinculadas ao cliente
    customer_id IN (
      SELECT c.id FROM customers c
      WHERE c.user_id = auth.uid()
        AND c.tenant_id = billings.tenant_id
    )
  );

COMMIT;
