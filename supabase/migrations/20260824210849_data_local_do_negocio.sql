-- ---------------------------------------------------------------------------
-- "Hoje" é o hoje do operador, não o do servidor
-- ---------------------------------------------------------------------------
-- O banco roda em UTC. Das 21h à meia-noite, todo dia, `CURRENT_DATE` já é o
-- dia seguinte enquanto a tela do operador ainda mostra o dia corrente.
--
-- Isso derrubou a guarda de retroatividade da política de encargo: às 21h, o
-- operador escolhia "em vigor a partir de hoje" — a data que o próprio
-- formulário sugeriu — e o banco recusava com "não pode começar antes de hoje".
--
-- A função nomeia a data do negócio para que exista UM lugar a mudar no dia em
-- que o produto precisar de fuso por tenant.
CREATE OR REPLACE FUNCTION fn_business_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
$$;

COMMENT ON FUNCTION fn_business_today IS
  'Data corrente no fuso do negócio. CURRENT_DATE é UTC e adianta um dia das 21h à meia-noite.';

CREATE OR REPLACE FUNCTION fn_create_late_charge_policy(
  p_tenant_id           UUID,
  p_fee_type            late_fee_type,
  p_fee_value           NUMERIC,
  p_daily_interest_rate NUMERIC,
  p_grace_period_days   SMALLINT,
  p_min_amount          NUMERIC,
  p_effective_from      DATE,
  p_created_by          UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_version INT;
  v_id      UUID;
BEGIN
  PERFORM 1 FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  -- `fn_business_today()`, não `CURRENT_DATE`: a data que o operador vê na tela.
  IF p_effective_from < fn_business_today() THEN
    RAISE EXCEPTION 'EFFECTIVE_FROM_IN_PAST';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id;

  INSERT INTO late_charge_policies (
    tenant_id, version, effective_from, fee_type, fee_value,
    daily_interest_rate, grace_period_days, min_amount, created_by
  ) VALUES (
    p_tenant_id, v_version, p_effective_from, p_fee_type, p_fee_value,
    p_daily_interest_rate, p_grace_period_days, p_min_amount, p_created_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
