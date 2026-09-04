-- ============================================================
-- PRD 0011 — ciclo de vida de tenant_members: status (revogar/
-- reativar) + RPCs de convite/gestão. get_user_tenants() passa a
-- ser o choke point único que bloqueia acesso de revogado em toda
-- RLS existente (nenhuma outra policy muda).
-- ============================================================

ALTER TABLE tenant_members
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'));

CREATE INDEX idx_tenant_members_tenant_status ON tenant_members(tenant_id, status);

CREATE OR REPLACE FUNCTION get_user_tenants()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND status = 'active';
$$;

-- ============================================================
-- get_own_membership_status — usado só pelo (dashboard)/layout.tsx pra
-- distinguir "nunca foi membro" (redirect /login, comportamento atual)
-- de "acesso revogado" (página de aviso). Precisa bypassar RLS porque
-- get_user_tenants()/a policy de tenant_members já filtram status='active',
-- então um revogado não enxergaria a própria linha via query normal.
-- ============================================================
CREATE OR REPLACE FUNCTION get_own_membership_status()
RETURNS TABLE (tenant_id UUID, status TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tm.tenant_id, tm.status
    FROM tenant_members tm
    WHERE tm.user_id = auth.uid()
    ORDER BY tm.created_at ASC
    LIMIT 1;
$$;

-- ============================================================
-- check_user_email_conflict — RF-003/004/008/009/010.
-- auth.users não é acessível via PostgREST (mesmo motivo já
-- documentado em platform_admins_rpc.sql).
-- ============================================================
CREATE OR REPLACE FUNCTION check_user_email_conflict(p_email TEXT)
RETURNS TABLE (
    user_id           UUID,
    is_platform_admin BOOLEAN,
    tenant_id         UUID,
    tenant_member_id  UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        u.id,
        EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id),
        tm.tenant_id,
        tm.id
    FROM auth.users u
    LEFT JOIN tenant_members tm ON tm.user_id = u.id
    WHERE LOWER(u.email) = LOWER(p_email)
    LIMIT 1;
$$;

-- ============================================================
-- list_tenant_members — RF-013/014. Enriquece com email/nome
-- (join auth.users) e já filtra por busca. Gate de role dentro
-- da própria função (defesa em profundidade além do 404 de rota).
-- ============================================================
CREATE OR REPLACE FUNCTION list_tenant_members(p_search TEXT DEFAULT NULL)
RETURNS TABLE (
    id          UUID,
    user_id     UUID,
    email       TEXT,
    name        TEXT,
    role        TEXT,
    status      TEXT,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        tm.id,
        tm.user_id,
        u.email::TEXT,
        COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))::TEXT,
        tm.role,
        tm.status,
        tm.created_at
    FROM tenant_members tm
    JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id IN (SELECT get_user_tenants())
      AND EXISTS (
        SELECT 1 FROM tenant_members caller
        WHERE caller.user_id = auth.uid() AND caller.role IN ('owner', 'admin') AND caller.status = 'active'
      )
      AND (
        p_search IS NULL OR p_search = ''
        OR u.email ILIKE '%' || p_search || '%'
        OR COALESCE(u.raw_user_meta_data->>'name', '') ILIKE '%' || p_search || '%'
      )
    ORDER BY
        CASE tm.status WHEN 'active' THEN 0 ELSE 1 END,
        CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,
        u.email;
$$;

-- ============================================================
-- set_tenant_member_role — RF-015/016/017, RN-003/004.
-- ============================================================
CREATE OR REPLACE FUNCTION set_tenant_member_role(p_member_id UUID, p_new_role TEXT)
RETURNS TABLE (old_role TEXT, new_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor         UUID := auth.uid();
    v_actor_role    TEXT;
    v_target_tenant UUID;
    v_target_user   UUID;
    v_current_role  TEXT;
    v_owner_count   INT;
    v_rank          JSONB := '{"viewer":1,"operator":2,"admin":3,"owner":4}'::JSONB;
BEGIN
    SELECT role INTO v_actor_role FROM tenant_members WHERE user_id = v_actor AND status = 'active';
    IF v_actor_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'apenas owner/admin alteram papel' USING ERRCODE = '42501';
    END IF;

    IF p_new_role NOT IN ('owner', 'admin', 'operator', 'viewer') THEN
        RAISE EXCEPTION 'papel inválido' USING ERRCODE = '22023';
    END IF;

    SELECT tenant_id, user_id, role INTO v_target_tenant, v_target_user, v_current_role
      FROM tenant_members WHERE id = p_member_id AND status = 'active';
    IF v_target_tenant IS NULL OR v_target_tenant NOT IN (SELECT get_user_tenants()) THEN
        RAISE EXCEPTION 'membro não encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF v_current_role = p_new_role THEN
        RETURN QUERY SELECT v_current_role, p_new_role;
        RETURN;
    END IF;

    IF v_target_user = v_actor AND (v_rank ->> p_new_role)::INT > (v_rank ->> v_current_role)::INT THEN
        RAISE EXCEPTION 'não é possível se autopromover' USING ERRCODE = '42501';
    END IF;

    IF v_current_role = 'owner' AND p_new_role <> 'owner' THEN
        SELECT COUNT(*) INTO v_owner_count FROM tenant_members
          WHERE tenant_id = v_target_tenant AND role = 'owner' AND status = 'active';
        IF v_owner_count <= 1 THEN
            RAISE EXCEPTION 'o tenant precisa de ao menos 1 owner ativo' USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE tenant_members SET role = p_new_role WHERE id = p_member_id;

    RETURN QUERY SELECT v_current_role, p_new_role;
END;
$$;

-- ============================================================
-- revoke_tenant_member — RF-018/019/020, RN-003/005. Idempotente
-- se já revogado (concorrência, ver §3.3).
-- ============================================================
CREATE OR REPLACE FUNCTION revoke_tenant_member(p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor         UUID := auth.uid();
    v_actor_role    TEXT;
    v_target_tenant UUID;
    v_target_user   UUID;
    v_target_role   TEXT;
    v_target_status TEXT;
    v_owner_count   INT;
BEGIN
    SELECT role INTO v_actor_role FROM tenant_members WHERE user_id = v_actor AND status = 'active';
    IF v_actor_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'apenas owner/admin revogam acesso' USING ERRCODE = '42501';
    END IF;

    SELECT tenant_id, user_id, role, status INTO v_target_tenant, v_target_user, v_target_role, v_target_status
      FROM tenant_members WHERE id = p_member_id;
    IF v_target_tenant IS NULL OR v_target_tenant NOT IN (SELECT get_user_tenants()) THEN
        RAISE EXCEPTION 'membro não encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF v_target_status = 'revoked' THEN
        RETURN; -- idempotente
    END IF;

    IF v_target_user = v_actor THEN
        RAISE EXCEPTION 'você não pode revogar o próprio acesso' USING ERRCODE = '42501';
    END IF;

    IF v_target_role = 'owner' THEN
        SELECT COUNT(*) INTO v_owner_count FROM tenant_members
          WHERE tenant_id = v_target_tenant AND role = 'owner' AND status = 'active';
        IF v_owner_count <= 1 THEN
            RAISE EXCEPTION 'o tenant precisa de ao menos 1 owner ativo' USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE tenant_members SET status = 'revoked' WHERE id = p_member_id;
END;
$$;

-- ============================================================
-- reactivate_tenant_member — RF-024/025/026. role não é tocado.
-- ============================================================
CREATE OR REPLACE FUNCTION reactivate_tenant_member(p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor         UUID := auth.uid();
    v_actor_role    TEXT;
    v_target_tenant UUID;
BEGIN
    SELECT role INTO v_actor_role FROM tenant_members WHERE user_id = v_actor AND status = 'active';
    IF v_actor_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'apenas owner/admin reativam acesso' USING ERRCODE = '42501';
    END IF;

    SELECT tenant_id INTO v_target_tenant FROM tenant_members WHERE id = p_member_id;
    IF v_target_tenant IS NULL OR v_target_tenant NOT IN (SELECT get_user_tenants()) THEN
        RAISE EXCEPTION 'membro não encontrado' USING ERRCODE = 'P0002';
    END IF;

    UPDATE tenant_members SET status = 'active' WHERE id = p_member_id AND status = 'revoked';
END;
$$;

GRANT EXECUTE ON FUNCTION get_own_membership_status()             TO authenticated;
GRANT EXECUTE ON FUNCTION check_user_email_conflict(TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION list_tenant_members(TEXT)                TO authenticated;
GRANT EXECUTE ON FUNCTION set_tenant_member_role(UUID, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_tenant_member(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_tenant_member(UUID)           TO authenticated;

-- ============================================================
-- RNF-005 — audit_logs precisa ser imutável, igual platform_audit_logs
-- já é. Gap pré-existente encontrado na Spec 0011 §6.3: a policy
-- "tenant_isolation_audit_logs" (Fase 5, tenant_isolation.sql) é
-- FOR ALL — hoje qualquer membro do tenant consegue UPDATE/DELETE em
-- audit_logs do próprio tenant. Substituída por SELECT/INSERT only;
-- sem policy de UPDATE/DELETE, RLS nega por padrão pra qualquer role,
-- inclusive Owner.
-- ============================================================
DROP POLICY IF EXISTS "tenant_isolation_audit_logs" ON audit_logs;

CREATE POLICY "tenant_isolation_audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "tenant_isolation_audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));
