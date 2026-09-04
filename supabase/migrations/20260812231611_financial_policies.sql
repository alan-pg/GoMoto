-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 05/17: políticas financeiras tipadas e versionadas.
--
-- Substitui o padrão atual de guardar política como JSON em settings key/value
-- parseado com ::jsonb dentro de trigger. Hoje, JSON malformado é engolido por
-- `EXCEPTION WHEN OTHERS` e o sistema segue com defaults hardcoded, em silêncio
-- (ver fn_recalculate_delinquency e fn_auto_apply_credit).
--
-- Aqui as colunas são tipadas com CHECK: o banco rejeita configuração inválida
-- na escrita. E são versionadas: alterar política nunca reescreve o passado —
-- o documento fixa a versão vigente na emissão por ponteiro (charges.late_charge_policy_id),
-- não por cópia de JSON.

-- ---------------------------------------------------------------------------
-- Encargo por atraso
-- ---------------------------------------------------------------------------

CREATE TABLE late_charge_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version             INT  NOT NULL,
  effective_from      DATE NOT NULL,
  -- fixed: fee_value em reais. percentage: fee_value como fração (0.02 = 2%)
  fee_type            late_fee_type NOT NULL,
  fee_value           NUMERIC(10,4) NOT NULL CHECK (fee_value >= 0),
  daily_interest_rate NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (daily_interest_rate >= 0),
  grace_period_days   SMALLINT NOT NULL DEFAULT 0 CHECK (grace_period_days >= 0),
  min_amount          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  -- percentual é fração, não inteiro: barra o clássico "2" querendo dizer 2%
  CONSTRAINT late_charge_percentage_is_fraction
    CHECK (fee_type <> 'percentage' OR fee_value <= 1)
);

COMMENT ON TABLE late_charge_policies IS
  'Spec 0014: política de encargo por atraso, tipada e versionada. Substitui late_charge_config JSONB copiado por cobrança.';

-- ---------------------------------------------------------------------------
-- Inadimplência
-- ---------------------------------------------------------------------------

CREATE TABLE delinquency_policies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version          INT  NOT NULL,
  effective_from   DATE NOT NULL,
  late_days        SMALLINT NOT NULL DEFAULT 1  CHECK (late_days        >= 0),
  delinquent_count SMALLINT NOT NULL DEFAULT 3  CHECK (delinquent_count >= 1),
  delinquent_days  SMALLINT NOT NULL DEFAULT 30 CHECK (delinquent_days  >= 1),
  blocked_count    SMALLINT NOT NULL DEFAULT 5  CHECK (blocked_count    >= 1),
  blocked_days     SMALLINT NOT NULL DEFAULT 60 CHECK (blocked_days     >= 1),
  auto_block       BOOLEAN  NOT NULL DEFAULT false,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  -- bloqueio tem que ser mais severo que inadimplência, senão a escada não faz sentido
  CONSTRAINT delinquency_thresholds_ordered
    CHECK (blocked_count >= delinquent_count AND blocked_days >= delinquent_days)
);

COMMENT ON TABLE delinquency_policies IS
  'Spec 0014: limiares de inadimplência. Consumidos por classifyDelinquency() em @gomoto/core sobre a view customer_delinquency — não por trigger (ADR 0024 reverte a ADR 0014).';

-- ---------------------------------------------------------------------------
-- Crédito do cliente
-- ---------------------------------------------------------------------------

CREATE TABLE credit_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version               INT  NOT NULL,
  effective_from        DATE NOT NULL,
  auto_apply            BOOLEAN NOT NULL DEFAULT false,
  -- NULL = crédito não expira
  default_validity_days SMALLINT CHECK (default_validity_days IS NULL OR default_validity_days > 0),
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

COMMENT ON TABLE credit_policies IS
  'Spec 0014: política de crédito. Aplicação abate a cobrança de vencimento mais antigo, percorre todos os créditos não expirados e nunca incide sobre caução.';

-- ---------------------------------------------------------------------------
-- Triggers, RLS e índices — idênticos nas três
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['late_charge_policies', 'delinquency_policies', 'credit_policies']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);

    EXECUTE format(
      'CREATE INDEX idx_%1$s_lookup ON %1$s (tenant_id, effective_from DESC, version DESC)', t);

    EXECUTE format('ALTER TABLE %1$s ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY tenant_isolation_%1$s ON %1$s TO authenticated
         USING (tenant_id IN (SELECT get_user_tenants()))
         WITH CHECK (tenant_id IN (SELECT get_user_tenants()))', t);

    EXECUTE format('GRANT ALL ON TABLE %1$s TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE %1$s TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: versão 1 para todo tenant existente
-- ---------------------------------------------------------------------------
-- Diferente do mapeamento de DRE (migration 03, que resolve por default global),
-- aqui a política precisa existir de fato: o encargo cobrado do cliente tem de
-- ser rastreável a uma linha versionada, não a um default implícito no código.

INSERT INTO late_charge_policies (tenant_id, version, effective_from, fee_type, fee_value, daily_interest_rate, grace_period_days)
SELECT id, 1, '2000-01-01'::date, 'percentage', 0.02, 0.00033, 0 FROM tenants;

INSERT INTO delinquency_policies (tenant_id, version, effective_from)
SELECT id, 1, '2000-01-01'::date FROM tenants;

INSERT INTO credit_policies (tenant_id, version, effective_from, auto_apply)
SELECT id, 1, '2000-01-01'::date, false FROM tenants;
