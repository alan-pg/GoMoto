-- ============================================================
-- GoMoto — Schema inicial do banco de dados
-- Migration gerada a partir de supabase-schema.sql (legado)
-- Single-tenant. Multi-tenancy será introduzida na Fase 5.
-- ============================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABELA: motorcycles
-- ============================================================
CREATE TABLE motorcycles (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_plate          VARCHAR(10) UNIQUE,
    model                  VARCHAR(100),
    make                   VARCHAR(100),
    year                   VARCHAR(10),
    color                  VARCHAR(50),
    renavam                VARCHAR(20),
    chassis                VARCHAR(20),
    fuel                   VARCHAR(50),
    engine_capacity        VARCHAR(20),
    previous_owner         VARCHAR(200),
    previous_owner_cpf     VARCHAR(14),
    purchase_date          DATE,
    fipe_value             DECIMAL(10,2),
    maintenance_up_to_date BOOLEAN DEFAULT false,
    status                 VARCHAR(20) CHECK (status IN ('available', 'rented', 'maintenance', 'inactive')) DEFAULT 'available',
    photo_url              TEXT,
    km_current             INTEGER DEFAULT 0,
    observations           TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: customers
-- ============================================================
CREATE TABLE customers (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                        VARCHAR(200),
    cpf                         VARCHAR(14) UNIQUE,
    rg                          VARCHAR(20),
    state                       VARCHAR(2),
    phone                       VARCHAR(20),
    email                       VARCHAR(200),
    address                     TEXT,
    zip_code                    VARCHAR(10),
    emergency_contact           VARCHAR(300),
    drivers_license             VARCHAR(20),
    drivers_license_validity    DATE,
    drivers_license_category    VARCHAR(10),
    birth_date                  DATE,
    payment_status              VARCHAR(50),
    drivers_license_photo_url   TEXT,
    document_photo_url          TEXT,
    observations                TEXT,
    in_queue                    BOOLEAN NOT NULL DEFAULT false,
    active                      BOOLEAN NOT NULL DEFAULT true,
    departure_date              DATE,
    departure_reason            TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: contracts
-- ============================================================
CREATE TABLE contracts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id      UUID REFERENCES customers(id) ON DELETE CASCADE,
    motorcycle_id    UUID REFERENCES motorcycles(id) ON DELETE CASCADE,
    start_date       DATE,
    end_date         DATE,
    monthly_amount   DECIMAL(10,2),
    status           VARCHAR(20) CHECK (status IN ('active', 'closed', 'cancelled', 'broken')) DEFAULT 'active',
    pdf_url          TEXT,
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: billings
-- ============================================================
CREATE TABLE billings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id      UUID REFERENCES contracts(id) ON DELETE CASCADE,
    customer_id      UUID REFERENCES customers(id) ON DELETE CASCADE,
    description      VARCHAR(300),
    amount           DECIMAL(10,2),
    due_date         DATE,
    status           VARCHAR(20) CHECK (status IN ('pending', 'paid', 'overdue', 'loss')) DEFAULT 'pending',
    payment_date     DATE,
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: incomes
-- ============================================================
CREATE TABLE incomes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle          VARCHAR(10),
    date             DATE,
    lessee           VARCHAR(200),
    amount           DECIMAL(10,2),
    reference        VARCHAR(50),
    payment_method   VARCHAR(50),
    period_from      DATE,
    period_to        DATE,
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: expenses
-- ============================================================
CREATE TABLE expenses (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    description      VARCHAR(300),
    amount           DECIMAL(10,2),
    category         VARCHAR(100),
    date             DATE,
    motorcycle_id    UUID REFERENCES motorcycles(id) ON DELETE SET NULL,
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: fines
-- ============================================================
CREATE TABLE fines (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id      UUID REFERENCES customers(id) ON DELETE CASCADE,
    motorcycle_id    UUID REFERENCES motorcycles(id) ON DELETE CASCADE,
    description      VARCHAR(300),
    amount           DECIMAL(10,2),
    infraction_date  DATE,
    due_date         DATE,
    status           VARCHAR(20) CHECK (status IN ('pending', 'paid')) DEFAULT 'pending',
    payment_date     DATE,
    responsible      VARCHAR(20) CHECK (responsible IN ('customer', 'company')) DEFAULT 'customer',
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: maintenance_items
-- ============================================================
CREATE TABLE maintenance_items (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(200),
    km_interval      INTEGER,
    day_interval     INTEGER,
    type             VARCHAR(20) CHECK (type IN ('preventive', 'corrective', 'inspection')),
    tip              TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: maintenances
-- ============================================================
CREATE TABLE maintenances (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    motorcycle_id        UUID REFERENCES motorcycles(id) ON DELETE CASCADE,
    standard_item_id     UUID REFERENCES maintenance_items(id) ON DELETE CASCADE,
    type                 VARCHAR(20) CHECK (type IN ('preventive', 'corrective', 'inspection')),
    description          VARCHAR(300),
    predicted_km         INTEGER,
    actual_km            INTEGER,
    scheduled_date       DATE,
    completed_date       DATE,
    cost                 DECIMAL(10,2),
    completed            BOOLEAN NOT NULL DEFAULT false,
    workshop             VARCHAR(200) DEFAULT 'Oficina do Careca',
    odometer_photo_url   TEXT,
    invoice_photo_url    TEXT,
    observations         TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: checklists
-- ============================================================
CREATE TABLE checklists (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    motorcycle_id    UUID REFERENCES motorcycles(id) ON DELETE CASCADE,
    contract_id      UUID REFERENCES contracts(id) ON DELETE CASCADE,
    type             VARCHAR(20) CHECK (type IN ('delivery', 'return')),
    date             DATE,
    current_km       INTEGER,
    fuel_level       INTEGER CHECK (fuel_level >= 0 AND fuel_level <= 100),
    items            JSONB NOT NULL DEFAULT '[]'::jsonb,
    signature_url    TEXT,
    observations     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: processes
-- ============================================================
CREATE TABLE processes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question    TEXT,
    answer      TEXT,
    category    VARCHAR(100),
    "order"     INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: settings
-- ============================================================
CREATE TABLE settings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         VARCHAR(100) NOT NULL UNIQUE,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: contract_templates (modelos de contrato .docx)
-- ============================================================
CREATE TABLE contract_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug        VARCHAR(100) NOT NULL UNIQUE,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    file_url    TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: queue_entries (fila de espera)
-- ============================================================
CREATE TABLE queue_entries (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id  UUID REFERENCES customers(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: audit_logs (rastreamento de ações)
-- ============================================================
CREATE TABLE audit_logs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL,
    action           VARCHAR(50) NOT NULL,
    table_name       VARCHAR(100),
    record_id        UUID,
    old_data         JSONB,
    new_data         JSONB,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================
-- FUNÇÃO: atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER trg_motorcycles_updated_at
    BEFORE UPDATE ON motorcycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_billings_updated_at
    BEFORE UPDATE ON billings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_fines_updated_at
    BEFORE UPDATE ON fines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_maintenances_updated_at
    BEFORE UPDATE ON maintenances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_processes_updated_at
    BEFORE UPDATE ON processes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_queue_entries_updated_at
    BEFORE UPDATE ON queue_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — apenas usuários autenticados (single-tenant)
-- Multi-tenancy será introduzida na Fase 5: as policies serão reescritas
-- usando auth.uid() + tenant_id.
-- ============================================================
ALTER TABLE motorcycles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE billings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE incomes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE processes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can access motorcycles"        ON motorcycles        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access customers"          ON customers          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access contracts"          ON contracts          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access billings"           ON billings           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access incomes"            ON incomes            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access expenses"           ON expenses           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access fines"              ON fines              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access maintenance_items"  ON maintenance_items  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access maintenances"       ON maintenances       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access checklists"         ON checklists         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access processes"          ON processes          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access settings"           ON settings           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access contract_templates" ON contract_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access queue_entries"      ON queue_entries      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can access audit_logs"         ON audit_logs         FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- STORAGE: bucket maintenance-files
-- (público, máx 10MB, apenas imagens)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'maintenance-files',
  'maintenance-files',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "maintenance-files: leitura publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'maintenance-files');

CREATE POLICY "maintenance-files: upload autenticado"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'maintenance-files' AND auth.role() = 'authenticated');

CREATE POLICY "maintenance-files: delecao autenticada"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'maintenance-files' AND auth.role() = 'authenticated');
