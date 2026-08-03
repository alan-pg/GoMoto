-- ============================================================
-- Spec 0009 — Módulo de Vistoria
-- Migration 1: Perfil de Vistoria (checklist + itens de imagem)
-- ADR 0015: entidade única, reaproveitada nos dois vínculos de rentals.
-- ============================================================

CREATE TABLE inspection_profiles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    description  TEXT,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_profiles_tenant ON inspection_profiles(tenant_id);

CREATE TRIGGER update_inspection_profiles_updated_at
    BEFORE UPDATE ON inspection_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_inspection_profiles" ON inspection_profiles
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_inspection_profiles" ON inspection_profiles
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- ------------------------------------------------------------

CREATE TABLE inspection_profile_checklist_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    profile_id  UUID NOT NULL REFERENCES inspection_profiles(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_profile_checklist_items_tenant  ON inspection_profile_checklist_items(tenant_id);
CREATE INDEX idx_inspection_profile_checklist_items_profile ON inspection_profile_checklist_items(profile_id);

CREATE TRIGGER update_inspection_profile_checklist_items_updated_at
    BEFORE UPDATE ON inspection_profile_checklist_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_profile_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_inspection_profile_checklist_items" ON inspection_profile_checklist_items
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_inspection_profile_checklist_items" ON inspection_profile_checklist_items
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- ------------------------------------------------------------

CREATE TABLE inspection_profile_photo_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    profile_id   UUID NOT NULL REFERENCES inspection_profiles(id) ON DELETE CASCADE,
    label        VARCHAR(100) NOT NULL,
    is_required  BOOLEAN NOT NULL DEFAULT true,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_profile_photo_items_tenant  ON inspection_profile_photo_items(tenant_id);
CREATE INDEX idx_inspection_profile_photo_items_profile ON inspection_profile_photo_items(profile_id);

CREATE TRIGGER update_inspection_profile_photo_items_updated_at
    BEFORE UPDATE ON inspection_profile_photo_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_profile_photo_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_inspection_profile_photo_items" ON inspection_profile_photo_items
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_inspection_profile_photo_items" ON inspection_profile_photo_items
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());
