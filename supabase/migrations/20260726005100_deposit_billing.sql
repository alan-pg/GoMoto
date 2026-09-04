-- Caução passa a gerar uma cobrança de verdade (billing_type='deposit'),
-- paga ou pendente conforme o operador indicar na criação. O pagamento
-- dessa cobrança (fluxo normal de /cobrancas) libera o saldo da caução.

BEGIN;

-- ============================================================
-- 1. Novo status: caução registrada mas ainda não paga
-- ============================================================
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'pending';

-- ============================================================
-- 2. billings.billing_type e billing_source reconhecem 'deposit'
-- ============================================================
ALTER TABLE billings DROP CONSTRAINT IF EXISTS billings_billing_type_check;
ALTER TABLE billings ADD CONSTRAINT billings_billing_type_check
  CHECK (billing_type IN ('cycle', 'one_time', 'complementary', 'fine', 'deposit'));

ALTER TYPE billing_source ADD VALUE IF NOT EXISTS 'deposit';

COMMIT;

-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que o
-- valor é referenciado — o restante (que usa 'pending'/'deposit' em
-- CREATE OR REPLACE FUNCTION, não em DML, então é seguro) segue em uma
-- segunda transação implícita.

BEGIN;

-- ============================================================
-- 3. deposits referencia a cobrança que a originou; received_at só é
-- preenchido quando a cobrança é efetivamente paga (não mais NOT NULL)
-- ============================================================
ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS billing_id UUID REFERENCES billings(id) ON DELETE SET NULL,
  ALTER COLUMN received_at DROP NOT NULL;

-- ============================================================
-- 4. create_rental_with_charges — novo parâmetro p_deposit_paid.
-- Default true preserva o comportamento atual pra qualquer chamador que
-- não passe o parâmetro (caução sempre tratada como recebida na hora).
--
-- Adicionar parâmetro cria uma NOVA sobrecarga em vez de substituir a
-- existente (mesmo problema que 20260721000001_fix_create_rental_rpc_overload.sql
-- já teve que corrigir) — por isso o DROP explícito da assinatura de 12
-- parâmetros antes do CREATE.
-- ============================================================
DROP FUNCTION IF EXISTS create_rental_with_charges(
  UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB, NUMERIC, JSONB
);

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
  p_security_deposit   NUMERIC  DEFAULT NULL,
  p_late_charge_config JSONB    DEFAULT NULL,
  p_deposit_paid       BOOLEAN  DEFAULT true
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id           UUID;
  v_deposit_billing_id UUID;
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
    INSERT INTO billings (
      tenant_id, lease_id, customer_id,
      original_amount, due_date, billing_type, source, status,
      description, paid_at
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_security_deposit, p_start_date, 'deposit', 'deposit',
      CASE WHEN p_deposit_paid THEN 'paid' ELSE 'pending' END,
      'Caução',
      CASE WHEN p_deposit_paid THEN now() ELSE NULL END
    ) RETURNING id INTO v_deposit_billing_id;

    INSERT INTO deposits (
      tenant_id, rental_id, customer_id,
      amount, balance, status, received_at, billing_id
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_security_deposit,
      CASE WHEN p_deposit_paid THEN p_security_deposit ELSE 0 END,
      (CASE WHEN p_deposit_paid THEN 'received' ELSE 'pending' END)::deposit_status,
      CASE WHEN p_deposit_paid THEN p_start_date ELSE NULL END,
      v_deposit_billing_id
    );
  END IF;

  UPDATE vehicles
  SET status     = 'rented',
      updated_at = now()
  WHERE id = p_vehicle_id AND tenant_id = p_tenant_id;

  RETURN v_lease_id;
END;
$$;

COMMIT;
