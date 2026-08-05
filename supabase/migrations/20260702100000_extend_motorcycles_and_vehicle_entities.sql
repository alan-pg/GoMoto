-- Spec 0006 — Revisão do Módulo de Veículos
-- Migration principal: ENUMs, extensão de motorcycles, vehicle_status_history, vehicle_photos, bucket

-- ─── 1. ENUMs ────────────────────────────────────────────────────────────────

CREATE TYPE vehicle_status AS ENUM (
  'available',
  'rented',
  'reserved',
  'maintenance',
  'sinister',
  'sold',
  'inactive'
);

CREATE TYPE vehicle_photo_slot AS ENUM (
  'principal', 'front', 'left_side', 'right_side', 'rear', 'dashboard'
);

-- ─── 2. Backfill acquisition_type antes de alterar o CHECK ───────────────────

UPDATE motorcycles SET acquisition_type = 'used'  WHERE acquisition_type = 'purchase';
UPDATE motorcycles SET acquisition_type = 'other' WHERE acquisition_type = 'lease';

-- ─── 3. Converter status VARCHAR → ENUM ──────────────────────────────────────

ALTER TABLE motorcycles
  DROP CONSTRAINT IF EXISTS motorcycles_status_check;

-- Dropar default antes de alterar tipo (PostgreSQL não faz cast automático de DEFAULT)
ALTER TABLE motorcycles
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE motorcycles
  ALTER COLUMN status TYPE vehicle_status USING status::vehicle_status;

ALTER TABLE motorcycles
  ALTER COLUMN status SET DEFAULT 'available'::vehicle_status;

-- ─── 4. Atualizar CHECK de acquisition_type ──────────────────────────────────

ALTER TABLE motorcycles
  DROP CONSTRAINT IF EXISTS motorcycles_acquisition_type_check;

ALTER TABLE motorcycles
  ADD CONSTRAINT motorcycles_acquisition_type_check
  CHECK (acquisition_type IN (
    'zero_km', 'used', 'settled', 'financed', 'consignment', 'donation', 'other'
  ));

-- ─── 5. Novas colunas em motorcycles ─────────────────────────────────────────

ALTER TABLE motorcycles
  ADD COLUMN IF NOT EXISTS km_entry                 INTEGER,
  ADD COLUMN IF NOT EXISTS has_tracker              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracker_brand            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tracker_model            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tracker_imei             VARCHAR(15),
  ADD COLUMN IF NOT EXISTS has_insurance            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_monthly_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS insurance_expiry_date    DATE;

ALTER TABLE motorcycles
  ADD CONSTRAINT motorcycles_tracker_imei_format
    CHECK (tracker_imei IS NULL OR tracker_imei ~ '^\d{15}$'),
  ADD CONSTRAINT motorcycles_tracker_fields_coherence
    CHECK (has_tracker = true OR (tracker_brand IS NULL AND tracker_model IS NULL AND tracker_imei IS NULL)),
  ADD CONSTRAINT motorcycles_insurance_fields_coherence
    CHECK (has_insurance = true OR (insurance_monthly_amount IS NULL AND insurance_expiry_date IS NULL));

-- Índices adicionais para performance (§8)
CREATE INDEX IF NOT EXISTS idx_motorcycles_tenant_status
  ON motorcycles(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_motorcycles_tenant_created
  ON motorcycles(tenant_id, created_at DESC);

-- ─── 6. Tabela vehicle_status_history (append-only) ──────────────────────────

CREATE TABLE vehicle_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  motorcycle_id   UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,
  previous_status vehicle_status,
  new_status      vehicle_status NOT NULL,
  changed_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Sem updated_at: append-only (ADR 0011)
);

CREATE INDEX idx_vsh_motorcycle ON vehicle_status_history(motorcycle_id);
CREATE INDEX idx_vsh_tenant     ON vehicle_status_history(tenant_id);
CREATE INDEX idx_vsh_created    ON vehicle_status_history(motorcycle_id, created_at DESC);

ALTER TABLE vehicle_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vsh_select_tenant" ON vehicle_status_history
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

CREATE POLICY "vsh_insert_tenant" ON vehicle_status_history
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
-- UPDATE e DELETE bloqueados por ausência de política (RN-007)

-- ─── 7. Tabela vehicle_photos ─────────────────────────────────────────────────

CREATE TABLE vehicle_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  motorcycle_id UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,
  slot          vehicle_photo_slot NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_vehicle_photos_slot ON vehicle_photos(motorcycle_id, slot);
CREATE INDEX idx_vehicle_photos_tenant      ON vehicle_photos(tenant_id);
CREATE INDEX idx_vehicle_photos_motorcycle  ON vehicle_photos(motorcycle_id);

CREATE TRIGGER update_vehicle_photos_updated_at
  BEFORE UPDATE ON vehicle_photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vehicle_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_vehicle_photos" ON vehicle_photos
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- ─── 8. Bucket vehicle-photos ────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-photos', 'vehicle-photos', false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "vehicle_photos_tenant_access" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM tenant_members WHERE user_id = auth.uid()
    )
  );
