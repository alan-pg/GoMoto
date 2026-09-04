-- ============================================================
-- Spec 0009 — Módulo de Vistoria
-- Migration 2: inspections, inspection_schedules, vínculos em
-- rentals, bucket inspection-photos.
-- ============================================================

CREATE TYPE inspection_kind   AS ENUM ('checkin', 'checkout', 'periodic');
CREATE TYPE inspection_status AS ENUM ('pending', 'completed', 'submitted', 'approved', 'rejected');

CREATE TABLE inspection_schedules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rental_id    UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
    target_date  DATE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_schedules_tenant     ON inspection_schedules(tenant_id);
CREATE INDEX idx_inspection_schedules_rental      ON inspection_schedules(tenant_id, rental_id);
CREATE INDEX idx_inspection_schedules_target_date ON inspection_schedules(tenant_id, target_date);

CREATE TRIGGER update_inspection_schedules_updated_at
    BEFORE UPDATE ON inspection_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_inspection_schedules" ON inspection_schedules
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_inspection_schedules" ON inspection_schedules
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- Cliente lê apenas os agendamentos das próprias locações (padrão ADR 0003 §5 / current_customer_ids())
CREATE POLICY "customer_self_select_inspection_schedules" ON inspection_schedules
    FOR SELECT TO authenticated
    USING (
        rental_id IN (
            SELECT id FROM rentals WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

-- ------------------------------------------------------------

CREATE TABLE inspections (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rental_id             UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
    inspection_profile_id UUID NOT NULL REFERENCES inspection_profiles(id) ON DELETE RESTRICT,
    schedule_id           UUID REFERENCES inspection_schedules(id) ON DELETE RESTRICT,

    kind    inspection_kind   NOT NULL,
    status  inspection_status NOT NULL,

    -- Snapshot dos itens do perfil no momento da execução — editar/arquivar
    -- o perfil depois NÃO altera vistorias já registradas.
    -- answers: [{ item_id, name, status: 'ok'|'not_ok', note }]
    -- photos:  [{ item_id, label, is_required, storage_path }]
    answers  JSONB NOT NULL DEFAULT '[]',
    photos   JSONB NOT NULL DEFAULT '[]',

    executed_by_user_id  UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    executed_at           TIMESTAMPTZ,

    review_notes  TEXT,
    reviewed_by   UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    reviewed_at   TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_inspections_status_per_kind CHECK (
        (kind IN ('checkin', 'checkout') AND status IN ('pending', 'completed'))
        OR
        (kind = 'periodic' AND status IN ('submitted', 'approved', 'rejected'))
    ),
    CONSTRAINT chk_inspections_periodic_needs_schedule CHECK (
        (kind = 'periodic') = (schedule_id IS NOT NULL)
    ),
    CONSTRAINT chk_inspections_rejection_needs_reason CHECK (
        status <> 'rejected' OR review_notes IS NOT NULL
    )
);

CREATE INDEX idx_inspections_tenant            ON inspections(tenant_id);
CREATE INDEX idx_inspections_rental             ON inspections(tenant_id, rental_id);
CREATE INDEX idx_inspections_tenant_kind_status ON inspections(tenant_id, kind, status);
CREATE INDEX idx_inspections_schedule           ON inspections(schedule_id) WHERE schedule_id IS NOT NULL;

-- RN-013: no máximo 1 aprovação válida por agendamento
CREATE UNIQUE INDEX uq_inspections_schedule_approved
    ON inspections(schedule_id) WHERE status = 'approved';

CREATE TRIGGER update_inspections_updated_at
    BEFORE UPDATE ON inspections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_inspections" ON inspections
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_inspections" ON inspections
    FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

-- Cliente lê apenas as próprias vistorias (nunca escreve via RLS — grava via
-- Route Handler com admin client / service role, que ignora RLS por design)
CREATE POLICY "customer_self_select_inspections" ON inspections
    FOR SELECT TO authenticated
    USING (
        rental_id IN (
            SELECT id FROM rentals WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

-- ============================================================
-- rentals: vínculos de Perfil de Vistoria (RF-006, RF-007, RN-004, RN-005)
-- Precisa vir ANTES das policies de leitura do cliente abaixo, que
-- referenciam rentals.periodic_inspection_profile_id.
-- ============================================================

ALTER TABLE rentals
    ADD COLUMN checkin_checkout_inspection_profile_id UUID REFERENCES inspection_profiles(id) ON DELETE RESTRICT,
    ADD COLUMN periodic_inspection_profile_id         UUID REFERENCES inspection_profiles(id) ON DELETE RESTRICT,
    ADD COLUMN periodic_inspection_frequency_days     INTEGER CHECK (periodic_inspection_frequency_days IS NULL OR periodic_inspection_frequency_days > 0);

ALTER TABLE rentals
    ADD CONSTRAINT chk_rentals_periodic_inspection_requires_frequency CHECK (
        (periodic_inspection_profile_id IS NULL) = (periodic_inspection_frequency_days IS NULL)
    );

CREATE INDEX idx_rentals_checkin_checkout_inspection_profile ON rentals(checkin_checkout_inspection_profile_id) WHERE checkin_checkout_inspection_profile_id IS NOT NULL;
CREATE INDEX idx_rentals_periodic_inspection_profile         ON rentals(periodic_inspection_profile_id) WHERE periodic_inspection_profile_id IS NOT NULL;

-- rentals já tem RLS "tenant_isolation_rentals" cobrindo todas as colunas —
-- nada de RLS novo necessário (não é tabela nova).

-- Cliente lê os itens do perfil vinculado à própria vistoria periódica
-- (necessário para renderizar o formulário de execução no app)
CREATE POLICY "customer_self_select_inspection_profiles" ON inspection_profiles
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT periodic_inspection_profile_id FROM rentals
            WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

CREATE POLICY "customer_self_select_inspection_profile_checklist_items" ON inspection_profile_checklist_items
    FOR SELECT TO authenticated
    USING (
        profile_id IN (
            SELECT periodic_inspection_profile_id FROM rentals
            WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

CREATE POLICY "customer_self_select_inspection_profile_photo_items" ON inspection_profile_photo_items
    FOR SELECT TO authenticated
    USING (
        profile_id IN (
            SELECT periodic_inspection_profile_id FROM rentals
            WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

-- ============================================================
-- Bucket: inspection-photos — privado, leitura via signed URL
-- Path: <tenant_id>/<inspection_id>/<item_slug>.<ext>
-- Mesmo padrão de fine-documents / rental-documents.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inspection-photos', 'inspection-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "inspection-photos: leitura autenticada"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');

CREATE POLICY "inspection-photos: upload autenticado"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');

CREATE POLICY "inspection-photos: update autenticado"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');

CREATE POLICY "inspection-photos: delete autenticado"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'inspection-photos' AND auth.role() = 'authenticated');
