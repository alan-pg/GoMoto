-- ============================================================
-- PRD 0002 — F1: schema do dossiê documental do veículo
-- ============================================================
-- Acrescenta a identidade documental atual em motorcycles e cria as
-- duas tabelas centrais do PRD 0002:
--
--   - vehicle_documents     → histórico de CRV/CRLV emitidos para o veículo
--   - vehicle_obligations   → pagamentos anuais (IPVA, licenciamento, DPVAT,
--                             seguro opcional, taxas DETRAN)
--
-- Não cria o cache `motorcycles.documentation_status` (decisão D4 do PRD):
-- o status agregado é derivado em runtime por @gomoto/core/rules/documentation.
-- Quando o PRD de alertas vier, ele adiciona o cache + trigger.
-- ============================================================

-- ============================================================
-- 1. Identidade documental atual + dados de aquisição em motorcycles
-- Todas as colunas são NULLable para preservar registros existentes.
-- ============================================================
ALTER TABLE motorcycles
    -- Proprietário registrado HOJE no CRV/CRLV vigente.
    -- Pode coincidir com previous_owner enquanto a transferência não acontece.
    ADD COLUMN registered_owner_name      VARCHAR(200),
    ADD COLUMN registered_owner_document  VARCHAR(20),
    ADD COLUMN registered_owner_type      VARCHAR(10) CHECK (registered_owner_type IN ('cpf', 'cnpj')),
    ADD COLUMN registration_state         VARCHAR(2),
    ADD COLUMN ownership_transferred      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN ownership_transfer_date    DATE,

    -- Aquisição pela empresa (≠ FIPE, que é referência de mercado).
    ADD COLUMN acquisition_type           VARCHAR(20)
        CHECK (acquisition_type IN ('zero_km', 'purchase', 'consignment', 'lease', 'donation', 'other'))
        DEFAULT 'purchase',
    ADD COLUMN acquisition_amount         DECIMAL(10, 2);

-- ============================================================
-- 2. TABELA: vehicle_documents
-- Histórico de documentos físicos/digitais (CRV, CRLV, recibo de transferência).
-- O índice parcial garante exatamente um documento vigente por (moto, tipo).
-- ============================================================
CREATE TABLE vehicle_documents (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    motorcycle_id              UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,

    type                       VARCHAR(30) NOT NULL
        CHECK (type IN ('crv', 'crlv', 'transfer_receipt', 'other')),
    exercise_year              INTEGER,
    document_number            VARCHAR(50),
    issued_at                  DATE,

    registered_owner_name      VARCHAR(200),
    registered_owner_document  VARCHAR(20),
    registered_owner_type      VARCHAR(10) CHECK (registered_owner_type IN ('cpf', 'cnpj')),

    file_url                   TEXT,
    is_current                 BOOLEAN NOT NULL DEFAULT false,
    observations               TEXT,

    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX vehicle_documents_current_unique
    ON vehicle_documents (motorcycle_id, type)
    WHERE is_current = true;

CREATE INDEX idx_vehicle_documents_tenant      ON vehicle_documents(tenant_id);
CREATE INDEX idx_vehicle_documents_motorcycle  ON vehicle_documents(motorcycle_id);

CREATE TRIGGER trg_vehicle_documents_updated_at
    BEFORE UPDATE ON vehicle_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. TABELA: vehicle_obligations
-- Pagamentos recorrentes obrigatórios (IPVA, licenciamento, DPVAT) e opcionais
-- (seguro, taxa CRV-e, taxas DETRAN avulsas).
--
-- `overdue` no CHECK existe para permitir o futuro PRD de alertas escrever
-- esse status — no V1 só pending/paid/exempt/cancelled são escritos; overdue
-- é derivado em runtime via effectiveStatus().
-- ============================================================
CREATE TABLE vehicle_obligations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    motorcycle_id       UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,

    type                VARCHAR(30) NOT NULL CHECK (type IN (
        'ipva', 'licensing', 'dpvat', 'insurance', 'crv_issuance', 'detran_fee', 'other'
    )),
    reference_year      INTEGER NOT NULL,
    description         VARCHAR(300),

    amount              DECIMAL(10, 2) NOT NULL,
    due_date            DATE NOT NULL,

    status              VARCHAR(20) NOT NULL CHECK (status IN (
        'pending', 'paid', 'overdue', 'exempt', 'cancelled'
    )) DEFAULT 'pending',
    paid_at             DATE,
    payment_method      VARCHAR(50),
    payment_reference   VARCHAR(200),

    receipt_url         TEXT,
    observations        TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IPVA / licenciamento / emissão de CRV têm 1 instância por ano-exercício.
-- DPVAT, seguro e taxas avulsas podem ter múltiplas → ficam fora do índice.
CREATE UNIQUE INDEX vehicle_obligations_year_unique
    ON vehicle_obligations (motorcycle_id, type, reference_year)
    WHERE type IN ('ipva', 'licensing', 'crv_issuance');

CREATE INDEX idx_vehicle_obligations_tenant      ON vehicle_obligations(tenant_id);
CREATE INDEX idx_vehicle_obligations_motorcycle  ON vehicle_obligations(motorcycle_id);
CREATE INDEX idx_vehicle_obligations_due
    ON vehicle_obligations(due_date)
    WHERE status IN ('pending', 'overdue');

CREATE TRIGGER trg_vehicle_obligations_updated_at
    BEFORE UPDATE ON vehicle_obligations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. RLS — isola por tenant + bypass de platform_admin.
-- Espelha o padrão já estabelecido em platform_admins.sql e tenant_isolation.sql.
-- ============================================================
ALTER TABLE vehicle_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_obligations  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_vehicle_documents"
    ON vehicle_documents FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_vehicle_documents"
    ON vehicle_documents FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());

CREATE POLICY "tenant_isolation_vehicle_obligations"
    ON vehicle_obligations FOR ALL TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY "platform_admin_bypass_vehicle_obligations"
    ON vehicle_obligations FOR ALL TO authenticated
    USING (is_platform_admin())
    WITH CHECK (is_platform_admin());
