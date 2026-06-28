-- ============================================================
-- Enforça exclusividade mútua entre platform_admins e tenant_members.
-- RN-015: um usuário não pode ser simultaneamente Platform Admin e membro
-- de qualquer tenant. Triggers impedem a inserção nas duas direções.
-- ============================================================

-- Verifica que quem entra em platform_admins não é tenant_member
CREATE OR REPLACE FUNCTION check_not_tenant_member()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_members WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Usuário já é membro de tenant e não pode ser Platform Admin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_admin_not_tenant_member
  BEFORE INSERT ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION check_not_tenant_member();

-- Verifica que quem entra em tenant_members não é platform_admin
CREATE OR REPLACE FUNCTION check_not_platform_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Usuário já é Platform Admin e não pode ser membro de tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_member_not_platform_admin
  BEFORE INSERT ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION check_not_platform_admin();
