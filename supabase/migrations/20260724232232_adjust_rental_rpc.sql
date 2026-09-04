-- Módulo Financeiro (PRD 0008, F11) — RPC de reajuste de locação (RF-027–031)
-- e correção de inconsistência em renew_rental (source/late_charge_config
-- ausentes no INSERT de cobranças, deixando-as com source='manual' em vez
-- de 'rental_cycle').

BEGIN;

-- ============================================================
-- 1. adjust_rental — reajusta valor do ciclo e encargos (RF-027–031)
--
-- TypeScript já calcula, por cobrança pendente, o novo valor (RN-027 —
-- recalculo proporcional para pro rata); esta função só escreve
-- atomicamente: lock na locação, UPDATE em lote nas cobranças pendentes
-- (nunca toca pagas/vencidas/canceladas — RN-026), histórico imutável em
-- rental_adjustments (RN-028), UPDATE do valor/encargos na locação.
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_rental(
  p_tenant_id              UUID,
  p_lease_id               UUID,
  p_new_cycle_amount       NUMERIC,
  p_new_late_charge_config JSONB,
  p_justification          TEXT,
  p_adjusted_by            UUID,
  p_billing_updates        JSONB  -- [{billing_id, new_amount}, ...] já calculado em TS
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_cycle_amount NUMERIC;
  v_previous_config       JSONB;
  v_updated_count         INTEGER;
BEGIN
  SELECT cycle_amount, late_charge_config
  INTO v_previous_cycle_amount, v_previous_config
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  UPDATE billings b
  SET original_amount = (u->>'new_amount')::NUMERIC,
      updated_at      = now()
  FROM jsonb_array_elements(p_billing_updates) AS u
  WHERE b.id          = (u->>'billing_id')::UUID
    AND b.tenant_id    = p_tenant_id
    AND b.lease_id     = p_lease_id
    AND b.status       = 'pending'        -- RN-026: nunca toca paga/cancelada
    AND b.due_date    >= CURRENT_DATE;    -- RN-026: nem vencida (status fica 'pending' até ser paga — overdue é derivado, nunca gravado)

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  INSERT INTO rental_adjustments (
    tenant_id, rental_id,
    previous_cycle_amount, new_cycle_amount,
    previous_config, new_config,
    updated_billings_count, justification, adjusted_by
  ) VALUES (
    p_tenant_id, p_lease_id,
    v_previous_cycle_amount, p_new_cycle_amount,
    v_previous_config, p_new_late_charge_config,
    v_updated_count, p_justification, p_adjusted_by
  );

  UPDATE rentals
  SET cycle_amount        = p_new_cycle_amount,
      late_charge_config  = COALESCE(p_new_late_charge_config, late_charge_config),
      updated_at          = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  RETURN v_updated_count;
END;
$$;

-- ============================================================
-- 2. renew_rental — corrige source/late_charge_config ausentes no INSERT
-- (bug adjacente: cobranças de renovação caíam no default source='manual'
-- em vez de 'rental_cycle', inconsistente com create_rental_with_charges)
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
  v_customer_id        UUID;
  v_late_charge_config JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  SELECT customer_id, late_charge_config INTO v_customer_id, v_late_charge_config
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
        description, source, late_charge_config
      ) VALUES (
        p_tenant_id, p_lease_id, v_customer_id,
        (p_complementary_action->>'amount')::NUMERIC,
        (p_complementary_action->>'due_date')::DATE,
        'complementary', 'pending',
        NULLIF(TRIM(p_complementary_action->>'description'), ''),
        'rental_cycle', v_late_charge_config
      );
    END IF;
  END IF;

  IF p_new_charges IS NOT NULL AND jsonb_array_length(p_new_charges) > 0 THEN
    INSERT INTO billings (
      tenant_id, lease_id, customer_id,
      original_amount, due_date, billing_type, status,
      description, source, late_charge_config
    )
    SELECT
      p_tenant_id,
      p_lease_id,
      v_customer_id,
      (c->>'amount')::NUMERIC,
      (c->>'due_date')::DATE,
      COALESCE(c->>'billing_type', 'cycle'),
      'pending',
      NULLIF(TRIM(c->>'description'), ''),
      'rental_cycle',
      v_late_charge_config
    FROM jsonb_array_elements(p_new_charges) AS c;
  END IF;
END;
$$;

COMMIT;
