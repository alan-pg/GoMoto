-- ---------------------------------------------------------------------------
-- Nova versão da política de encargo por atraso
-- ---------------------------------------------------------------------------
-- Até aqui a política só existia porque o seed a inseriu: não havia nenhuma
-- escrita em `late_charge_policies` fora de migration. Configurações tinha um
-- `saveFinancialSettings` que gravava JSON em `settings.late_charge_defaults`,
-- chave que NINGUÉM lê — a emissão sempre resolveu a política desta tabela.
-- Era a mesma armadilha do campo de encargo por locação, que foi removido: uma
-- tela que aceita o número, responde "salvo", e cobra outra coisa.
--
-- Versão é IMUTÁVEL e nova política é linha nova (Princípio 3). Editar a
-- vigente mudaria retroativamente o que clientes antigos devem — a cobrança
-- guarda `late_charge_policy_id`, então o que foi emitido continua valendo o
-- que valia no dia.
--
-- A trava serializa a numeração. `MAX(version) + 1` lido no app dá a duas
-- gravações simultâneas o mesmo número: uma entra, a outra estoura no UNIQUE
-- com erro de chave duplicada — que o operador leria como falha do sistema.
-- Travar o TENANT é o escopo exato da sequência, que é por tenant.
--
-- `effective_from` não anda para trás: uma versão "vigente desde antes" mudaria
-- a política de cobranças emitidas entre aquela data e hoje, que é exatamente o
-- retroativo que a versão existe para impedir.

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

  IF p_effective_from < CURRENT_DATE THEN
    RAISE EXCEPTION 'EFFECTIVE_FROM_IN_PAST';
  END IF;

  -- As demais faixas (fração <= 1 para percentual, não-negativos) já são CHECK
  -- da tabela: repetir aqui só criaria uma segunda verdade para manter.
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

COMMENT ON FUNCTION fn_create_late_charge_policy IS
  'Cria nova versão da política de encargo. Numeração serializada por tenant; effective_from nunca retroage.';
