-- Módulo Financeiro (Spec 0008) — Passo 9: extensão de billings
-- Adiciona colunas de origem, encargos, crédito e dispensa.
-- Converte payment_method de VARCHAR para o ENUM criado no passo 1.

BEGIN;

-- ============================================================
-- Novas colunas
-- ============================================================
ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS source             billing_source NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS maintenance_id     UUID REFERENCES maintenances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_charge_config JSONB,
  ADD COLUMN IF NOT EXISTS credit_applied     NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_waived     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_reason      TEXT,
  ADD COLUMN IF NOT EXISTS waiver_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waiver_at          TIMESTAMPTZ;

-- Backfill: mapeia billing_type existente para source
UPDATE billings SET source = 'rental_cycle' WHERE billing_type = 'cycle';
UPDATE billings SET source = 'fine'         WHERE billing_type = 'fine';
-- 'one_time', 'complementary' e qualquer outro permanecem como 'manual'

-- ============================================================
-- Migra payment_method de VARCHAR para ENUM
-- Valores existentes: pix, cash, credit_card, debit_card, bank_transfer, NULL
-- Todos são válidos no payment_method_type ENUM.
-- ============================================================
ALTER TABLE billings DROP CONSTRAINT IF EXISTS billings_payment_method_check;

ALTER TABLE billings
  ALTER COLUMN payment_method TYPE payment_method_type
  USING payment_method::payment_method_type;

-- ============================================================
-- Índice composto para o trigger de inadimplência (ADR 0014)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_billings_tenant_customer_status
  ON billings(tenant_id, customer_id, status);

COMMIT;
