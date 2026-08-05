-- ============================================================
-- F4 (hotfix) — Quebra a recursão de RLS em tenant_members
-- ============================================================
-- A migration 20260615150100 reescreveu as policies de SELECT de
-- `tenants` e `tenant_members` consultando `tenant_members` direto
-- (para que membros de tenant suspenso ainda vejam o próprio row).
-- O efeito colateral: a SELECT policy de tenant_members tem um
-- subselect contra tenant_members, e o planner reabre a policy →
-- "infinite recursion detected in policy for relation tenant_members".
--
-- Correção: expõe uma SECURITY DEFINER que devolve os tenant_ids do
-- caller IGNORANDO suspensão. As policies passam a consumir essa
-- função (que foge da própria RLS porque roda como definer).
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_tenant_memberships()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid();
$$;

DROP POLICY IF EXISTS "Members can read their tenants"        ON tenants;
DROP POLICY IF EXISTS "Members can read peers in same tenant" ON tenant_members;
DROP POLICY IF EXISTS "Owners/admins can manage members"      ON tenant_members;

CREATE POLICY "Members can read their tenants"
    ON tenants FOR SELECT TO authenticated
    USING (id IN (SELECT get_user_tenant_memberships()));

CREATE POLICY "Members can read peers in same tenant"
    ON tenant_members FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_memberships()));

-- A policy de gestão antes consultava tenant_members direto exigindo
-- role IN ('owner','admin'). Para preservar essa restrição sem
-- recursão, criamos outra SECURITY DEFINER focada em roles de gestão.
CREATE OR REPLACE FUNCTION get_user_admin_tenant_memberships()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id
      FROM tenant_members
     WHERE user_id = auth.uid()
       AND role IN ('owner', 'admin');
$$;

CREATE POLICY "Owners/admins can manage members"
    ON tenant_members FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_admin_tenant_memberships()))
    WITH CHECK (tenant_id IN (SELECT get_user_admin_tenant_memberships()));
