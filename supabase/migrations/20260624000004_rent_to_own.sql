-- ============================================================
-- Migration 0004-4: Spec 0004 — Suporte Rent-to-Own
-- Adiciona contract_type e status 'transferred' à tabela rentals.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Adicionar tipo de locação
-- ============================================================
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) NOT NULL DEFAULT 'rental';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rentals'::regclass AND conname = 'rentals_contract_type_check'
  ) THEN
    ALTER TABLE rentals
      ADD CONSTRAINT rentals_contract_type_check
      CHECK (contract_type IN ('rental', 'rent_to_own'));
  END IF;
END $$;

-- ============================================================
-- 2. Adicionar status 'transferred' (Rent-to-Own concluído)
-- ============================================================
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_status_check;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_status_check
  CHECK (status IN ('active', 'closed', 'transferred'));

-- ============================================================
-- 3. Índice auxiliar para queries por tipo
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rentals_contract_type ON rentals(tenant_id, contract_type);

COMMIT;
