-- ============================================================
-- Migration 0004-1: Spec 0004 — Schema base de locações
-- Renomeia contracts → rentals, estende billings, cria
-- clients_documents, queue_enabled em tenants.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Renomear contracts → rentals
-- ============================================================
ALTER TABLE contracts RENAME TO rentals;

-- Renomear policy de isolamento de tenant que ficou com nome antigo
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rentals' AND policyname = 'tenant_isolation_contracts'
  ) THEN
    ALTER POLICY "tenant_isolation_contracts" ON rentals RENAME TO "tenant_isolation_rentals";
  END IF;
END $$;

-- Renomear indexes que referenciam 'contracts' (se existirem)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'rentals' AND indexname LIKE '%contracts%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
      r.indexname, replace(r.indexname, 'contracts', 'rentals'));
  END LOOP;
END $$;

-- ============================================================
-- 2. Atualizar CHECK de status em rentals
-- (remove 'cancelled' e 'broken' que eram do modelo antigo)
-- ============================================================
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'rentals'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rentals DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_status_check
  CHECK (status IN ('active', 'closed'));

-- ============================================================
-- 3. Adicionar campos de ciclo de locação
-- ============================================================
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS cycle          VARCHAR(10),
  ADD COLUMN IF NOT EXISTS due_day        SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS use_pro_rata   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS start_date     DATE,
  ADD COLUMN IF NOT EXISTS end_date       DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rentals'::regclass AND conname = 'rentals_cycle_check'
  ) THEN
    ALTER TABLE rentals
      ADD CONSTRAINT rentals_cycle_check CHECK (cycle IN ('weekly', 'monthly'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rentals'::regclass AND conname = 'rentals_due_day_check'
  ) THEN
    ALTER TABLE rentals
      ADD CONSTRAINT rentals_due_day_check CHECK (due_day BETWEEN 1 AND 28);
  END IF;
END $$;

-- ============================================================
-- 4. Estender queue_entries (adicionar status e converted_at)
-- ============================================================
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS status       VARCHAR(20) NOT NULL DEFAULT 'waiting',
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'queue_entries'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE queue_entries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE queue_entries
  ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN ('waiting', 'converted', 'cancelled'));

-- ============================================================
-- 5. Tabela clients_documents (upload de documentos de clientes)
-- ============================================================
CREATE TABLE IF NOT EXISTS clients_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL
    CHECK (document_type IN ('drivers_license_front', 'drivers_license_back', 'id_front', 'id_back', 'other')),
  storage_path  TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_clients_documents_updated_at
  BEFORE UPDATE ON clients_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clients_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_clients_documents" ON clients_documents
  FOR ALL TO authenticated
  USING  (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- ============================================================
-- 6. Adicionar queue_enabled ao tenant
-- ============================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS queue_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- 7. Índices compostos para queries frequentes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rentals_tenant_status ON rentals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_motorcycle    ON rentals(tenant_id, motorcycle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_customer      ON rentals(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_clients_docs_customer ON clients_documents(tenant_id, customer_id);

COMMIT;
