-- ============================================================
-- PRD 0002 — F1: expenses.payment_status + updated_at
-- ============================================================
-- Hoje toda expense é tratada como já paga (lançada depois do fato).
-- A nova coluna `payment_status` cobre o caso futuro de despesa com
-- vencimento programado (ex: peça encomendada). Default 'paid' preserva
-- a semântica atual sem precisar de backfill.
--
-- updated_at + trigger seguem o padrão das demais tabelas de domínio.
-- ============================================================

ALTER TABLE expenses
    ADD COLUMN payment_status VARCHAR(20)
        CHECK (payment_status IN ('pending', 'paid')) DEFAULT 'paid',
    ADD COLUMN paid_at        DATE,
    ADD COLUMN updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Quando payment_status='paid' mas paid_at é NULL, assume a data do lançamento
-- como proxy (`date`). Mantém compat para a view financial_events somar tudo.
UPDATE expenses
   SET paid_at = date
 WHERE payment_status = 'paid' AND paid_at IS NULL;

CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
