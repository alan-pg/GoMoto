-- ============================================================
-- Fase 5 — Multi-tenancy: tenants + tenant_members
-- ============================================================
-- Cria as duas tabelas que sustentam o isolamento por organização.
-- - tenants: organizações que usam o GoMoto (ex.: "GoMoto Bonze")
-- - tenant_members: vínculo user (auth.users) ↔ tenant com role
--
-- Helper function get_user_tenants() é usada pelas RLS policies
-- das tabelas de domínio (próxima migration) para filtrar linhas.
-- ============================================================

-- ============================================================
-- TABELA: tenants
-- ============================================================
CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABELA: tenant_members
-- ============================================================
CREATE TABLE tenant_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')) DEFAULT 'operator',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_tenant_members_user_id ON tenant_members(user_id);
CREATE INDEX idx_tenant_members_tenant_id ON tenant_members(tenant_id);

CREATE TRIGGER trg_tenant_members_updated_at
    BEFORE UPDATE ON tenant_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FUNÇÃO: get_user_tenants()
-- Retorna o conjunto de tenant_ids aos quais o usuário autenticado pertence.
-- Usada como subquery nas policies RLS das tabelas de domínio.
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_tenants()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;

-- ============================================================
-- RLS — tenants
-- O usuário só enxerga os tenants nos quais é membro.
-- ============================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their tenants"
    ON tenants FOR SELECT TO authenticated
    USING (id IN (SELECT get_user_tenants()));

CREATE POLICY "Owners can update their tenants"
    ON tenants FOR UPDATE TO authenticated
    USING (
        id IN (
            SELECT tenant_id FROM tenant_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

-- ============================================================
-- RLS — tenant_members
-- O usuário enxerga os membros dos tenants nos quais ele é membro.
-- Só owners/admins podem gerenciar membros.
-- ============================================================
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read peers in same tenant"
    ON tenant_members FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "Owners/admins can manage members"
    ON tenant_members FOR ALL TO authenticated
    USING (
        tenant_id IN (
            SELECT tenant_id FROM tenant_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    )
    WITH CHECK (
        tenant_id IN (
            SELECT tenant_id FROM tenant_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );
