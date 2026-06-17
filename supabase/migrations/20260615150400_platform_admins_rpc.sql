-- ============================================================
-- F5 — RPCs do CRUD de platform_admins
-- ============================================================
-- Centraliza no banco:
--   - resolução de email → user_id (auth.users não é acessível por REST)
--   - guard de "pelo menos um owner" (não pode ficar sem owner)
--   - escrita da trilha em platform_audit_logs
--
-- As 4 funções são SECURITY DEFINER. Cada uma reverifica o role do caller
-- (`get_platform_role()`) porque SD bypassa a RLS — manter o gate
-- "só owner manage" exigido pela policy `platform_admins_manage`.
-- Erros são levantados com SQLSTATE custom para o app traduzir:
--   42501 → acesso negado
--   23514 → invariante violado (último owner)
--   23505 → já existe
--   P0002 → não encontrado
-- ============================================================

-- list_platform_admins: tabela enriquecida com email/nome para a tela.
-- Mantém auth.users isolado do PostgREST público.
CREATE OR REPLACE FUNCTION list_platform_admins()
RETURNS TABLE (
    user_id          UUID,
    email            TEXT,
    name             TEXT,
    role             TEXT,
    created_at       TIMESTAMPTZ,
    created_by_email TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        pa.user_id,
        u.email::TEXT,
        COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))::TEXT,
        pa.role::TEXT,
        pa.created_at,
        creator.email::TEXT
      FROM platform_admins pa
      JOIN auth.users u             ON u.id = pa.user_id
      LEFT JOIN auth.users creator  ON creator.id = pa.created_by
     WHERE is_platform_admin()
     ORDER BY
        CASE pa.role WHEN 'owner' THEN 0 ELSE 1 END,
        pa.created_at ASC;
$$;

-- add_platform_admin_by_email: olha o user pelo email e promove.
-- Falha se o usuário ainda não existe em auth.users — F9 cuidará do invite.
CREATE OR REPLACE FUNCTION add_platform_admin_by_email(p_email TEXT, p_role TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor   UUID := auth.uid();
    v_user_id UUID;
BEGIN
    IF get_platform_role() <> 'owner' THEN
        RAISE EXCEPTION 'apenas owners podem adicionar platform_admin' USING ERRCODE='42501';
    END IF;
    IF p_role NOT IN ('owner', 'operator') THEN
        RAISE EXCEPTION 'role inválida' USING ERRCODE='22023';
    END IF;

    SELECT id INTO v_user_id
      FROM auth.users
     WHERE LOWER(email) = LOWER(p_email)
     LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'usuário % não encontrado em auth.users', p_email USING ERRCODE='P0002';
    END IF;

    INSERT INTO platform_admins (user_id, role, created_by)
    VALUES (v_user_id, p_role, v_actor);
    -- UNIQUE em user_id → conflito vira 23505 e o app traduz.

    INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (v_actor, 'platform_admin.add', 'platform_admin', v_user_id,
            jsonb_build_object('email', LOWER(p_email), 'role', p_role));

    RETURN v_user_id;
END;
$$;

-- set_platform_admin_role: troca de role com guard de "≥1 owner".
CREATE OR REPLACE FUNCTION set_platform_admin_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor        UUID := auth.uid();
    v_current_role TEXT;
    v_owner_count  INT;
BEGIN
    IF get_platform_role() <> 'owner' THEN
        RAISE EXCEPTION 'apenas owners podem alterar role' USING ERRCODE='42501';
    END IF;
    IF p_role NOT IN ('owner', 'operator') THEN
        RAISE EXCEPTION 'role inválida' USING ERRCODE='22023';
    END IF;

    SELECT role INTO v_current_role FROM platform_admins WHERE user_id = p_user_id;
    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'platform_admin não encontrado' USING ERRCODE='P0002';
    END IF;

    IF v_current_role = p_role THEN
        RETURN;  -- noop; evita log poluído
    END IF;

    IF v_current_role = 'owner' THEN
        SELECT COUNT(*) INTO v_owner_count FROM platform_admins WHERE role = 'owner';
        IF v_owner_count <= 1 THEN
            RAISE EXCEPTION 'a plataforma precisa de pelo menos um owner' USING ERRCODE='23514';
        END IF;
    END IF;

    UPDATE platform_admins SET role = p_role, updated_at = NOW() WHERE user_id = p_user_id;

    INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (v_actor, 'platform_admin.set_role', 'platform_admin', p_user_id,
            jsonb_build_object('from', v_current_role, 'to', p_role));
END;
$$;

-- remove_platform_admin: idem, com guard adicional contra remover último owner.
CREATE OR REPLACE FUNCTION remove_platform_admin(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor       UUID := auth.uid();
    v_target_role TEXT;
    v_owner_count INT;
BEGIN
    IF get_platform_role() <> 'owner' THEN
        RAISE EXCEPTION 'apenas owners podem remover platform_admin' USING ERRCODE='42501';
    END IF;

    SELECT role INTO v_target_role FROM platform_admins WHERE user_id = p_user_id;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'platform_admin não encontrado' USING ERRCODE='P0002';
    END IF;

    IF v_target_role = 'owner' THEN
        SELECT COUNT(*) INTO v_owner_count FROM platform_admins WHERE role = 'owner';
        IF v_owner_count <= 1 THEN
            RAISE EXCEPTION 'a plataforma precisa de pelo menos um owner' USING ERRCODE='23514';
        END IF;
    END IF;

    DELETE FROM platform_admins WHERE user_id = p_user_id;

    INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (v_actor, 'platform_admin.remove', 'platform_admin', p_user_id,
            jsonb_build_object('was_role', v_target_role));
END;
$$;

GRANT EXECUTE ON FUNCTION list_platform_admins()                       TO authenticated;
GRANT EXECUTE ON FUNCTION add_platform_admin_by_email(TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION set_platform_admin_role(UUID, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION remove_platform_admin(UUID)                  TO authenticated;
