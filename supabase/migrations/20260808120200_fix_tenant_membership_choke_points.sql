-- ============================================================
-- Spec 0011 — fecha um gap descoberto em teste manual ao vivo: a
-- migration anterior (20260808120100) só filtrou status='active' em
-- get_user_tenants() — a função consultada pela RLS de TODAS as
-- tabelas de domínio (tenant_isolation.sql). Mas RLS de tenant_members
-- e tenants não usa get_user_tenants(): usa duas outras SECURITY
-- DEFINER dedicadas (get_user_tenant_memberships() /
-- get_user_admin_tenant_memberships()), criadas em
-- 20260615150300_fix_tenant_members_recursion.sql para evitar
-- recursão de RLS. Sem esse fix, um Owner/Admin revogado:
--   - continuava resolvendo tenantId via getCurrentTenantId()
--     (usada por requireTenantOwnerOrAdmin(), (dashboard)/layout.tsx,
--     logAction) — a página de "acesso revogado" (RF-021) nunca
--     disparava, o dashboard renderizava vazio em vez de bloquear;
--   - continuava com direito de INSERT/UPDATE/DELETE em
--     tenant_members via PostgREST direto (bypassando as RPCs desta
--     Spec, que têm seu próprio guard de status — defesa em
--     profundidade, mas a policy de base não devia depender só disso).
-- Mesmo padrão SECURITY DEFINER, só adicionando o filtro que faltava.
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_tenant_memberships()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION get_user_admin_tenant_memberships()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id
      FROM tenant_members
     WHERE user_id = auth.uid()
       AND role IN ('owner', 'admin')
       AND status = 'active';
$$;

-- "Owners can update their tenants" (tenants_and_tenant_members.sql)
-- consulta tenant_members inline (não via função) — mesmo fix direto.
DROP POLICY IF EXISTS "Owners can update their tenants" ON tenants;

CREATE POLICY "Owners can update their tenants"
    ON tenants FOR UPDATE TO authenticated
    USING (
        id IN (
            SELECT tenant_id FROM tenant_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
        )
    );
