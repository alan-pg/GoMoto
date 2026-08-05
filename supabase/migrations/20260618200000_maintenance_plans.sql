-- ============================================================
-- PRD 0003 — F1 (slim): fundação do plano de manutenção
-- ============================================================
-- Cria as duas tabelas centrais do plano de manutenção e amarra
-- a moto a um plano via FK nullable:
--
--   - maintenance_plans       → plano nomeado por tenant (com is_default)
--   - maintenance_plan_items  → itens canônicos do plano com intervalos,
--                                threshold e flag is_critical (reservada
--                                para PRD futuro de "regras avançadas")
--   - motorcycles.maintenance_plan_id → FK nullable; motos existentes
--                                 sobem sem plano e ganham banner discreto
--                                 na tela /motos (PRD §10.3).
--
-- Nesta fatia (slim) **não tocamos** em maintenance_items órfã (drop fica
-- para F1.5 depois de F2 migrar o wizard) nem em maintenances.standard_item_id.
-- A constante hardcoded STANDARD_INTERVALS continua viva em @gomoto/core
-- até a refatoração das funções puras (F1.5).
--
-- ADR 0006 §1 motiva o desenho (tenant cria N planos; sem catálogo global).
-- ============================================================

-- ============================================================
-- 1. TABELA: maintenance_plans
-- Plano nomeado por tenant. `is_default` único parcial garante 1 default
-- ativo por tenant — pré-seleção no wizard de motos (F2).
-- ============================================================
CREATE TABLE maintenance_plans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    description  TEXT,
    is_default   BOOLEAN NOT NULL DEFAULT false,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX maintenance_plans_default_unique
    ON maintenance_plans (tenant_id)
    WHERE is_default = true AND archived_at IS NULL;

CREATE INDEX idx_maintenance_plans_tenant ON maintenance_plans(tenant_id);

CREATE TRIGGER trg_maintenance_plans_updated_at
    BEFORE UPDATE ON maintenance_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. TABELA: maintenance_plan_items
-- Item canônico do plano. `category` agrupa para regras contratuais
-- por categoria (F3). `type` exclui 'corrective' — corretiva vive em
-- maintenances sem plan_item_id. CHECK garante pelo menos 1 intervalo.
-- `is_critical` é flag reservada (D8 do ADR — sem uso operacional no V1).
-- ============================================================
CREATE TABLE maintenance_plan_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id              UUID NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,

    name                 VARCHAR(200) NOT NULL,
    category             VARCHAR(20) NOT NULL CHECK (category IN (
                            'oil', 'filter', 'brake', 'tire', 'wear_part',
                            'inspection', 'fluid', 'transmission', 'other'
                         )),
    type                 VARCHAR(20) NOT NULL CHECK (type IN (
                            'preventive', 'inspection'
                         )) DEFAULT 'preventive',

    interval_km          INTEGER CHECK (interval_km IS NULL OR interval_km > 0),
    interval_days        INTEGER CHECK (interval_days IS NULL OR interval_days > 0),
    warn_threshold_pct   INTEGER CHECK (warn_threshold_pct IS NULL OR (warn_threshold_pct > 0 AND warn_threshold_pct <= 100)),
    is_critical          BOOLEAN NOT NULL DEFAULT false,

    tip                  TEXT,
    sort_order           INTEGER NOT NULL DEFAULT 0,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_maintenance_plan_items_has_interval
        CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)
);

CREATE INDEX idx_maintenance_plan_items_tenant ON maintenance_plan_items(tenant_id);
CREATE INDEX idx_maintenance_plan_items_plan   ON maintenance_plan_items(plan_id);

CREATE TRIGGER trg_maintenance_plan_items_updated_at
    BEFORE UPDATE ON maintenance_plan_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. motorcycles.maintenance_plan_id → FK nullable
-- ON DELETE SET NULL para preservar a moto se o plano for excluído
-- (cenário improvável já que tenant arquiva; FK aceita o caso).
-- ============================================================
ALTER TABLE motorcycles
    ADD COLUMN maintenance_plan_id UUID REFERENCES maintenance_plans(id) ON DELETE SET NULL;

CREATE INDEX idx_motorcycles_maintenance_plan ON motorcycles(maintenance_plan_id);

-- ============================================================
-- 4. RLS — isolamento por tenant + bypass de platform_admin
-- Espelha o padrão de vehicle_documents (PRD 0002 / migration motorcycle_documentation).
-- ============================================================
ALTER TABLE maintenance_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_plan_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_maintenance_plans"
    ON maintenance_plans FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_maintenance_plans"
    ON maintenance_plans FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

CREATE POLICY "tenant_isolation_maintenance_plan_items"
    ON maintenance_plan_items FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_maintenance_plan_items"
    ON maintenance_plan_items FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());
