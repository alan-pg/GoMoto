-- ============================================================
-- F1 (parte 1) — Control plane: platform_admins + auditoria
-- ============================================================
-- Cria a camada "acima dos tenants" formalizada pela ADR 0004 e
-- pelo PRD 0001 (Área Administrativa da Plataforma):
--
-- - platform_admins: pessoas com poder sobre TODA a plataforma
--   (CRUD de empresas, suspensão, dashboard global). Independente
--   de tenant_members; o vínculo é com auth.users diretamente.
-- - platform_audit_logs: trilha de ações sensíveis do platform_admin
--   (suspensão de tenant, promoção/rebaixamento de admin, etc.).
-- - is_platform_admin() / get_platform_role(): SECURITY DEFINER helpers
--   para RLS e para o app.
-- - Policies PERMISSIVE adicionais (`platform_admin_bypass_*`) em
--   todas as tabelas de domínio. RLS no Postgres combina PERMISSIVE
--   por OR — então essas adicionam acesso sem mexer nas existentes
--   `tenant_isolation_*`. Reversível: bastam DROPs.
-- - Policies de platform_admin em tenants/tenant_members, que dão
--   visão e gestão global ao platform admin (criar/editar/suspender).
-- ============================================================

-- ============================================================
-- TABELA: platform_admins
-- Hierarquia simples: 'owner' faz tudo, 'operator' faz CRUD operacional
-- mas não promove/rebaixa outros platform_admins.
-- ============================================================
CREATE TABLE platform_admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'operator')) DEFAULT 'operator',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_platform_admins_user_id ON platform_admins(user_id);

CREATE TRIGGER trg_platform_admins_updated_at
    BEFORE UPDATE ON platform_admins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABELA: platform_audit_logs
-- Trilha de ações do control plane. Não usa updated_at — append-only.
-- ============================================================
CREATE TABLE platform_audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    action      VARCHAR(80) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id   UUID,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_logs_actor    ON platform_audit_logs(actor_id);
CREATE INDEX idx_platform_audit_logs_target   ON platform_audit_logs(target_type, target_id);
CREATE INDEX idx_platform_audit_logs_created  ON platform_audit_logs(created_at DESC);

-- ============================================================
-- FUNÇÕES HELPER
-- SECURITY DEFINER para escapar do RLS da própria platform_admins
-- (evita recursão de policy).
-- ============================================================
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM platform_admins WHERE user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION get_platform_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT role FROM platform_admins WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- RLS — platform_admins
-- Qualquer platform_admin lê a tabela. Só 'owner' altera/insere/remove.
-- ============================================================
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admins_read"
    ON platform_admins FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "platform_admins_manage"
    ON platform_admins FOR ALL TO authenticated
    USING (get_platform_role() = 'owner')
    WITH CHECK (get_platform_role() = 'owner');

-- ============================================================
-- RLS — platform_audit_logs
-- Append-only: qualquer platform_admin INSERTa registrando ações.
-- Leitura também só para platform_admins. Sem UPDATE/DELETE (omitidos).
-- ============================================================
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_audit_logs_read"
    ON platform_audit_logs FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "platform_audit_logs_insert"
    ON platform_audit_logs FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() AND actor_id = auth.uid());

-- ============================================================
-- BYPASS POLICIES NAS TABELAS DE DOMÍNIO
-- PERMISSIVE adicional → combina por OR com tenant_isolation_*.
-- O platform_admin enxerga TUDO; tenant_members continuam restritos
-- ao próprio tenant. Reversível com simples DROP POLICY.
-- ============================================================
DO $$
DECLARE
    tbl TEXT;
    domain_tables TEXT[] := ARRAY[
        'motorcycles', 'customers', 'contracts', 'billings',
        'incomes', 'expenses', 'fines', 'maintenance_items',
        'maintenances', 'checklists', 'processes', 'settings',
        'contract_templates', 'queue_entries', 'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY domain_tables LOOP
        EXECUTE format($pol$
            CREATE POLICY "platform_admin_bypass_%s"
              ON %I FOR ALL TO authenticated
              USING (is_platform_admin())
              WITH CHECK (is_platform_admin())
        $pol$, tbl, tbl);
    END LOOP;
END $$;

-- ============================================================
-- POLICIES DE PLATFORM ADMIN EM tenants / tenant_members
-- O platform_admin enxerga TODOS os tenants e seus membros,
-- e pode criar/editar/suspender qualquer um.
-- ============================================================
CREATE POLICY "platform_admin_read_all_tenants"
    ON tenants FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "platform_admin_manage_tenants"
    ON tenants FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

CREATE POLICY "platform_admin_read_all_tenant_members"
    ON tenant_members FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "platform_admin_manage_tenant_members"
    ON tenant_members FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());
