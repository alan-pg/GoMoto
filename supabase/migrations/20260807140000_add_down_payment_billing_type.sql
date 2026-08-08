-- Spec 0010 — Entrada não reembolsável na locação.
-- Entrada é só uma cobrança (billings) com billing_type='down_payment' e
-- source='down_payment' — sem tabela nova, ao contrário da Caução (RN-001).

BEGIN;
ALTER TYPE billing_source ADD VALUE IF NOT EXISTS 'down_payment';
COMMIT;

-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que o
-- valor é referenciado (mesmo padrão de 20260726005100_deposit_billing.sql).
BEGIN;
ALTER TABLE billings DROP CONSTRAINT IF EXISTS billings_billing_type_check;
ALTER TABLE billings ADD CONSTRAINT billings_billing_type_check
  CHECK (billing_type IN ('cycle', 'one_time', 'complementary', 'fine', 'deposit', 'down_payment'));
COMMIT;
