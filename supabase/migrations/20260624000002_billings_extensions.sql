-- ============================================================
-- Migration 0004-2: Spec 0004 — Extensões de billings + RLS mobile
-- Renomeia colunas, adiciona campos de desconto/tipo/pagamento,
-- e cria política RLS para cliente mobile.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Renomear contract_id → lease_id
-- ============================================================
ALTER TABLE billings RENAME COLUMN contract_id TO lease_id;

-- Atualizar FK que referencia a tabela renomeada (contracts → rentals)
-- O PostgreSQL preserva a FK mas o nome pode conter 'contracts'
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'billings'::regclass AND contype = 'f'
    AND conname LIKE '%contract%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE billings DROP CONSTRAINT %I', constraint_name);
    ALTER TABLE billings
      ADD CONSTRAINT billings_lease_id_fkey
      FOREIGN KEY (lease_id) REFERENCES rentals(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 2. Renomear amount → original_amount
-- ============================================================
ALTER TABLE billings RENAME COLUMN amount TO original_amount;

-- ============================================================
-- 3. Adicionar campos de desconto, tipo e pagamento
-- ============================================================
ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason  TEXT,
  ADD COLUMN IF NOT EXISTS billing_type     VARCHAR(20) NOT NULL DEFAULT 'cycle',
  ADD COLUMN IF NOT EXISTS payment_method   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS paid_at          DATE,
  ADD COLUMN IF NOT EXISTS paid_by          UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS discounted_by    UUID REFERENCES auth.users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billings'::regclass AND conname = 'billings_billing_type_check'
  ) THEN
    ALTER TABLE billings
      ADD CONSTRAINT billings_billing_type_check
      CHECK (billing_type IN ('cycle', 'one_time', 'complementary'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billings'::regclass AND conname = 'billings_payment_method_check'
  ) THEN
    ALTER TABLE billings
      ADD CONSTRAINT billings_payment_method_check
      CHECK (payment_method IN ('pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer')
             OR payment_method IS NULL);
  END IF;
END $$;

-- ============================================================
-- 4. Atualizar CHECK de status (adiciona cancelled e prejudice)
-- ============================================================
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'billings'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE billings DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE billings
  ADD CONSTRAINT billings_status_check
  CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled', 'prejudice'));

-- ============================================================
-- 5. Índices compostos para queries frequentes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_billings_lease         ON billings(tenant_id, lease_id);
CREATE INDEX IF NOT EXISTS idx_billings_status        ON billings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_billings_due_date      ON billings(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_billings_lease_status  ON billings(tenant_id, lease_id, status);

-- ============================================================
-- 6. RLS mobile: cliente lê apenas próprias cobranças
-- ============================================================
CREATE POLICY "customer_read_own_billings" ON billings
  FOR SELECT TO authenticated
  USING (
    lease_id IN (
      SELECT r.id FROM rentals r
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = auth.uid()
        AND r.tenant_id = billings.tenant_id
    )
  );

COMMIT;
