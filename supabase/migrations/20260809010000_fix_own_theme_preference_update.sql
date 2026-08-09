-- ============================================================
-- Bug encontrado ao vivo (relato do usuário, 2026-08-09): salvar
-- Aparência em /configuracoes reporta sucesso mas não persiste pra
-- usuários com papel operator/viewer.
--
-- Causa: updateThemePreferenceAction faz UPDATE direto em
-- tenant_members. A única policy de UPDATE pra tenant_members
-- (fora platform_admin) é "Owners/admins can manage members", que
-- exige role IN ('owner','admin') via get_user_admin_tenant_memberships()
-- — pensada pra GESTÃO de outros membros, não pra alguém editar a
-- própria linha. operator/viewer nunca conseguiram ter essa policy
-- aplicada a si mesmos; o bug só ficou visível agora porque a Spec
-- 0011 é a primeira feature que cria tenant_members com esses papéis
-- (antes, só existia o owner criado por create_tenant_with_owner).
--
-- supabase-js não reporta erro nesse caso: RLS silenciosamente
-- filtra a linha do UPDATE (0 linhas afetadas), e sem .select() o
-- client não tem como perceber — a Server Action via { ok: true }.
--
-- Fix: RPC SECURITY DEFINER dedicada, mesmo padrão já usado em toda
-- escrita própria de tenant_members nesta base (check_user_email_conflict,
-- set_tenant_member_role, get_own_membership_status etc.) — só altera
-- theme_brand/color_mode da própria linha do caller, nunca role/status.
-- ============================================================

CREATE OR REPLACE FUNCTION update_own_theme_preference(p_theme_brand TEXT, p_color_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_theme_brand NOT IN ('frota-confiavel', 'estrada', 'sinalizacao', 'classico') THEN
        RAISE EXCEPTION 'tema inválido' USING ERRCODE = '22023';
    END IF;
    IF p_color_mode NOT IN ('system', 'light', 'dark') THEN
        RAISE EXCEPTION 'modo de cor inválido' USING ERRCODE = '22023';
    END IF;

    UPDATE tenant_members
       SET theme_brand = p_theme_brand, color_mode = p_color_mode
     WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION update_own_theme_preference(TEXT, TEXT) TO authenticated;
