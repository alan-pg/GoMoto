-- ============================================================
-- Fase 5 — Multi-tenancy: tenant_id em todas as tabelas de domínio
-- ============================================================
-- Esta migration:
-- 1. Cria um tenant default ('GoMoto Bonze') para os dados existentes.
-- 2. Adiciona coluna tenant_id NOT NULL em todas as tabelas de domínio.
--    Para registros pré-existentes, faz backfill com o tenant default.
-- 3. Cria índices em tenant_id para performance.
-- 4. Reescreve TODAS as policies RLS para filtrar por get_user_tenants().
--
-- ⚠️ Ordem importa: alguns ALTER TABLE precisam acontecer ANTES da reescrita
--    das policies para não quebrar o filtro.
-- ============================================================

-- ============================================================
-- 1. TENANT DEFAULT (backfill de dados existentes)
-- ============================================================
INSERT INTO tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'GoMoto Bonze', 'gomoto-bonze')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. ADICIONAR tenant_id NAS TABELAS
-- Adiciona como nullable, faz backfill, depois marca NOT NULL.
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
        EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE', tbl);
        EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL', tbl, '00000000-0000-0000-0000-000000000001');
        EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
        EXECUTE format('CREATE INDEX idx_%I_tenant_id ON %I(tenant_id)', tbl, tbl);
    END LOOP;
END $$;

-- ============================================================
-- 3. REESCREVER RLS POLICIES
-- Remove as policies "USING (true)" e cria policies filtradas por tenant.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can access motorcycles"        ON motorcycles;
DROP POLICY IF EXISTS "Authenticated users can access customers"          ON customers;
DROP POLICY IF EXISTS "Authenticated users can access contracts"          ON contracts;
DROP POLICY IF EXISTS "Authenticated users can access billings"           ON billings;
DROP POLICY IF EXISTS "Authenticated users can access incomes"            ON incomes;
DROP POLICY IF EXISTS "Authenticated users can access expenses"           ON expenses;
DROP POLICY IF EXISTS "Authenticated users can access fines"              ON fines;
DROP POLICY IF EXISTS "Authenticated users can access maintenance_items"  ON maintenance_items;
DROP POLICY IF EXISTS "Authenticated users can access maintenances"       ON maintenances;
DROP POLICY IF EXISTS "Authenticated users can access checklists"         ON checklists;
DROP POLICY IF EXISTS "Authenticated users can access processes"          ON processes;
DROP POLICY IF EXISTS "Authenticated users can access settings"           ON settings;
DROP POLICY IF EXISTS "Authenticated users can access contract_templates" ON contract_templates;
DROP POLICY IF EXISTS "Authenticated users can access queue_entries"      ON queue_entries;
DROP POLICY IF EXISTS "Authenticated users can access audit_logs"         ON audit_logs;

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
            CREATE POLICY "tenant_isolation_%s"
              ON %I FOR ALL TO authenticated
              USING (tenant_id IN (SELECT get_user_tenants()))
              WITH CHECK (tenant_id IN (SELECT get_user_tenants()))
        $pol$, tbl, tbl);
    END LOOP;
END $$;
