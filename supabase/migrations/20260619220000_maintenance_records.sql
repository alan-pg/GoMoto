-- ============================================================
-- F5.1 — Tabela `maintenance_records` (registro do cliente + aprovação)
--
-- PRD 0003 §F5 / ADR 0006 §"Revisão" (2026-06-19): o cliente registra
-- pelo mobile que executou uma manutenção. O operador no web revisa
-- (fotos + KM + custo) e aprova ou rejeita. Só na aprovação é que
-- `maintenances` ganha completed=true e os campos effective_*.
--
-- Por que tabela separada (e não `maintenances.status='pending_approval'`):
--   1) RLS trivial — cliente INSERT/SELECT só nas próprias; `maintenances`
--      segue write-only do operador, sem condicional por status.
--   2) Audit de rejeições preservado — se cliente reenvia 2x antes de
--      aprovar, fica registrado.
--   3) PRDs futuros (rateio, OS) consomem só `maintenances`, sem ver
--      pendências do cliente.
--
-- O bucket `maintenance-files` (initial_schema) é reusado — público com
-- upload por autenticado. URLs ficam em odometer_photo_url / invoice_photo_url.
-- ============================================================

CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    -- Quando o cliente fecha uma manutenção pré-agendada (preventiva do plano),
    -- liga aqui. Quando registra uma corretiva avulsa, fica NULL e o operador
    -- decide se cria uma `maintenances` na aprovação ou descarta.
    maintenance_id UUID REFERENCES maintenances(id) ON DELETE SET NULL,
    motorcycle_id UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,
    -- Dados informados pelo cliente (espelho dos campos do modal web atual).
    actual_km INTEGER NOT NULL CHECK (actual_km >= 0),
    cost NUMERIC(10, 2) CHECK (cost IS NULL OR cost >= 0),
    workshop VARCHAR(200),
    odometer_photo_url TEXT,
    invoice_photo_url TEXT,
    notes TEXT,
    -- Fluxo de aprovação.
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maintenance_records_tenant_id ON maintenance_records(tenant_id);
CREATE INDEX idx_maintenance_records_customer_id ON maintenance_records(customer_id);
CREATE INDEX idx_maintenance_records_status ON maintenance_records(status);

CREATE TRIGGER trg_maintenance_records_updated_at
    BEFORE UPDATE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS: operador (tenant_members via get_user_tenants) — FULL access
-- ============================================================
CREATE POLICY "tenant_isolation_maintenance_records" ON maintenance_records
    FOR ALL
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- ============================================================
-- RLS: cliente lê os próprios registros
-- ============================================================
CREATE POLICY "customer_self_select_maintenance_records" ON maintenance_records
    FOR SELECT
    TO authenticated
    USING (customer_id IN (SELECT current_customer_ids()));

-- ============================================================
-- RLS: cliente cria registros vinculados a si mesmo
--
-- WITH CHECK restringe o INSERT — sem USING porque é write-only do
-- ponto de vista do cliente (leitura cai na policy de SELECT acima).
-- O cliente NUNCA atualiza/deleta — esse caminho é exclusivo do
-- operador via tenant_isolation_maintenance_records.
-- ============================================================
CREATE POLICY "customer_self_insert_maintenance_records" ON maintenance_records
    FOR INSERT
    TO authenticated
    WITH CHECK (customer_id IN (SELECT current_customer_ids()));
