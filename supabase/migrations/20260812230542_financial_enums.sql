-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 01/17: enums do novo domínio financeiro.
--
-- Só CREATE aqui. Os enums obsoletos (billing_source, billing_pix_status,
-- deposit_movement_type, deposit_status, credit_origin, delinquency_level)
-- ainda são referenciados pelas tabelas legadas e só podem cair na
-- migration 15 (drop_legacy_financial).
--
-- Preservados sem alteração: payment_method_type, late_fee_type.

-- Direção do lançamento. amount_signed deriva daqui:
-- debit  => +amount
-- credit => -amount
CREATE TYPE entry_direction AS ENUM ('debit', 'credit');

-- Natureza da conta.
-- 'reimbursement' é entrada de resultado cuja linha de DRE é política do
-- tenant (ADR 0024, Princípio 6) — repasse de multa/manutenção ao cliente.
-- As demais naturezas são estruturais e não configuráveis.
CREATE TYPE account_kind AS ENUM (
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'reimbursement'
);

-- Ciclo da linha de cronograma da locação (plano, mutável).
-- 'superseded' cobre a linha substituída por reajuste.
CREATE TYPE schedule_status AS ENUM (
  'scheduled',
  'issued',
  'cancelled',
  'superseded'
);

-- Ciclo da cobrança emitida (documento, imutável).
-- 'overdue' NÃO existe aqui: atraso é derivado de due_date < CURRENT_DATE
-- na view charge_balances (ADR 0024, Princípio 4).
-- Pagamento parcial é estado do saldo, não do documento.
CREATE TYPE charge_status AS ENUM (
  'open',
  'paid',
  'cancelled',
  'written_off'
);

-- Responsabilidade financeira de uma conta a pagar.
CREATE TYPE responsibility_type AS ENUM ('company', 'customer', 'shared');

CREATE TYPE payable_status AS ENUM ('open', 'paid', 'cancelled');

-- Como a parte do cliente num rateio retorna para a empresa.
CREATE TYPE reimbursement_mode AS ENUM ('none', 'charge', 'credit');

COMMENT ON TYPE entry_direction     IS 'Spec 0014: direção do lançamento no ledger.';
COMMENT ON TYPE account_kind        IS 'Spec 0014: natureza da conta. reimbursement tem linha de DRE definida por tenant.';
COMMENT ON TYPE schedule_status     IS 'Spec 0014: ciclo da linha de cronograma da locação.';
COMMENT ON TYPE charge_status       IS 'Spec 0014: ciclo da cobrança. Atraso é derivado, não armazenado.';
COMMENT ON TYPE responsibility_type IS 'Spec 0014: responsabilidade financeira (empresa/cliente/rateio).';
COMMENT ON TYPE payable_status      IS 'Spec 0014: ciclo da conta a pagar.';
COMMENT ON TYPE reimbursement_mode  IS 'Spec 0014: forma de retorno da parte do cliente no rateio.';
