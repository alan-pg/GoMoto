-- ============================================================
-- F1 (parte 2) — Suspensão de tenants + ajustes em get_user_tenants
-- ============================================================
-- A ADR 0004 §5 prevê suspender uma locadora (atraso, inadimplência,
-- requisição do operador) sem deletar o tenant. Esta migration:
--
-- 1. Adiciona em `tenants`: suspended_at / suspended_reason /
--    suspended_by / created_by. A coluna `active` legada continua
--    existindo, mas o campo de verdade passa a ser suspended_at IS NULL.
-- 2. Reescreve get_user_tenants() para retornar APENAS tenants não
--    suspensos — isso bloqueia, por construção, qualquer acesso a
--    dados de domínio quando o tenant está suspenso (porque todas as
--    policies tenant_isolation_* filtram por get_user_tenants).
-- 3. Reescreve as policies de SELECT em tenants e tenant_members para
--    NÃO usar get_user_tenants — em vez disso, consultam tenant_members
--    diretamente. Assim, um membro de um tenant suspenso ainda
--    ENXERGA seu próprio tenant_row (para o middleware mostrar a UX
--    "locadora suspensa" no web), mas não enxerga DADOS do tenant.
-- 4. Mantém intacta a policy de gestão de membros (owner/admin do
--    próprio tenant) — só foi reescrita para ficar coerente com a
--    nova visão e ser idempotente.
-- ============================================================

-- ============================================================
-- 1. ALTER TABLE tenants
-- ============================================================
ALTER TABLE tenants
    ADD COLUMN suspended_at      TIMESTAMPTZ NULL,
    ADD COLUMN suspended_reason  TEXT NULL,
    ADD COLUMN suspended_by      UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN created_by        UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_tenants_suspended_at ON tenants(suspended_at) WHERE suspended_at IS NOT NULL;

-- ============================================================
-- 2. get_user_tenants() — passa a filtrar tenants suspensos
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_tenants()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tm.tenant_id
      FROM tenant_members tm
      JOIN tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = auth.uid()
       AND t.suspended_at IS NULL;
$$;

-- ============================================================
-- 3. Policies de SELECT em tenants / tenant_members
-- Continuam visíveis MESMO se suspenso — para o middleware do web
-- conseguir ler o tenant e mostrar "locadora suspensa". O bloqueio
-- de dados acontece nas tabelas de domínio via get_user_tenants.
-- ============================================================
DROP POLICY IF EXISTS "Members can read their tenants"        ON tenants;
DROP POLICY IF EXISTS "Members can read peers in same tenant" ON tenant_members;

CREATE POLICY "Members can read their tenants"
    ON tenants FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Members can read peers in same tenant"
    ON tenant_members FOR SELECT TO authenticated
    USING (
        tenant_id IN (
            SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
        )
    );
