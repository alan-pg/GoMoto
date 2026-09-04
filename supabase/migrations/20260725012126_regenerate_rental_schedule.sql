-- Extensão de Reajustar locação: permite também mudar ciclo, dia de
-- vencimento e pro rata (além de valor/encargos, já cobertos por
-- adjust_rental). Mudar a forma do cronograma não dá pra fazer com
-- UPDATE in-place — cancela as cobranças pendentes futuras e regera com
-- generateCycleCharges a partir do ponto de corte calculado em TS.

BEGIN;

-- ============================================================
-- 1. credit_applications — coluna de estorno (RNF-005: sem apagar nada)
-- ============================================================
ALTER TABLE credit_applications
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ NULL;

-- ============================================================
-- 2. rental_adjustments — rastreia também mudança de ciclo/dia/pro-rata
-- (nullable: reajuste de valor puro continua só usando as colunas
-- previous_cycle_amount/new_cycle_amount, como hoje)
-- ============================================================
ALTER TABLE rental_adjustments
  ADD COLUMN IF NOT EXISTS previous_cycle        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS new_cycle             VARCHAR(10),
  ADD COLUMN IF NOT EXISTS previous_due_day      SMALLINT,
  ADD COLUMN IF NOT EXISTS new_due_day           SMALLINT,
  ADD COLUMN IF NOT EXISTS previous_use_pro_rata BOOLEAN,
  ADD COLUMN IF NOT EXISTS new_use_pro_rata      BOOLEAN;

-- ============================================================
-- 3. regenerate_rental_schedule — cancela pendentes futuras + estorna
-- crédito aplicado nelas + gera novas cobranças + atualiza a locação,
-- tudo atomicamente. TypeScript calcula cutoff, IDs a cancelar,
-- reversões de crédito e as novas cobranças (generateCycleCharges);
-- esta função só escreve.
-- ============================================================
CREATE OR REPLACE FUNCTION regenerate_rental_schedule(
  p_tenant_id              UUID,
  p_lease_id               UUID,
  p_new_cycle              TEXT,
  p_new_due_day            INTEGER,
  p_new_cycle_amount       NUMERIC,
  p_new_use_pro_rata       BOOLEAN,
  p_new_late_charge_config JSONB,
  p_justification          TEXT,
  p_adjusted_by            UUID,
  p_cancel_billing_ids     JSONB,
  p_credit_reversals       JSONB,
  p_new_charges            JSONB
) RETURNS TABLE(cancelled_count INTEGER, created_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rental      RECORD;
  v_customer_id UUID;
  v_cancelled   INTEGER;
  v_created     INTEGER;
BEGIN
  SELECT cycle, due_day, cycle_amount, use_pro_rata, late_charge_config, customer_id
  INTO v_rental
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  v_customer_id := v_rental.customer_id;

  -- Estorna crédito aplicado nas cobranças que serão canceladas
  UPDATE credit_applications ca
  SET reversed_at = now()
  FROM jsonb_array_elements_text(p_cancel_billing_ids) AS bid
  WHERE ca.billing_id = bid::UUID
    AND ca.tenant_id  = p_tenant_id
    AND ca.reversed_at IS NULL;

  UPDATE customer_credits cc
  SET available_balance = cc.available_balance + (r->>'amount')::NUMERIC,
      updated_at         = now()
  FROM jsonb_array_elements(p_credit_reversals) AS r
  WHERE cc.id        = (r->>'credit_id')::UUID
    AND cc.tenant_id = p_tenant_id;

  -- Cancela as cobranças pendentes que não batem mais com o novo padrão
  UPDATE billings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND lease_id  = p_lease_id
    AND status    = 'pending'
    AND id IN (SELECT (jsonb_array_elements_text(p_cancel_billing_ids))::UUID);

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- Gera as novas cobranças a partir do ponto de corte
  INSERT INTO billings (
    tenant_id, lease_id, customer_id,
    original_amount, due_date, billing_type, status,
    description, source, late_charge_config
  )
  SELECT
    p_tenant_id, p_lease_id, v_customer_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending',
    NULLIF(TRIM(c->>'description'), ''),
    'rental_cycle',
    p_new_late_charge_config
  FROM jsonb_array_elements(p_new_charges) AS c;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  INSERT INTO rental_adjustments (
    tenant_id, rental_id,
    previous_cycle_amount, new_cycle_amount,
    previous_config, new_config,
    previous_cycle, new_cycle,
    previous_due_day, new_due_day,
    previous_use_pro_rata, new_use_pro_rata,
    updated_billings_count, justification, adjusted_by
  ) VALUES (
    p_tenant_id, p_lease_id,
    v_rental.cycle_amount, p_new_cycle_amount,
    v_rental.late_charge_config, p_new_late_charge_config,
    v_rental.cycle, p_new_cycle,
    v_rental.due_day, p_new_due_day,
    v_rental.use_pro_rata, p_new_use_pro_rata,
    v_cancelled, p_justification, p_adjusted_by
  );

  UPDATE rentals
  SET cycle              = p_new_cycle,
      due_day            = p_new_due_day,
      cycle_amount       = p_new_cycle_amount,
      use_pro_rata       = p_new_use_pro_rata,
      late_charge_config = COALESCE(p_new_late_charge_config, late_charge_config),
      updated_at         = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  RETURN QUERY SELECT v_cancelled, v_created;
END;
$$;

COMMIT;
