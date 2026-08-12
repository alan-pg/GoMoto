-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 10/17: contas a pagar e responsabilidade financeira.
--
-- Unifica o lado da empresa, hoje espalhado entre expenses, vehicle_obligations,
-- o custo de maintenances e a multa de responsabilidade da empresa — cada um com
-- seu próprio vocabulário de status de pagamento.
--
-- Resolve F-07: os requisitos pedem despesa da empresa, do cliente ou
-- compartilhada, com rateio e cobrança automática da parte do cliente. A tabela
-- expenses não tem coluna de responsabilidade, nem customer_id, nem rental_id.
-- A ADR 0013 afirma que `is_company_expense` existe — nunca existiu.
--
-- Resolve F-17 (Princípio 7): o rateio é gravado em VALORES. Percentual inteiro
-- não representa 1/3 e deixa centavo sem dono; percentual é entrada de UI.

CREATE TABLE payables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       UUID REFERENCES branches(id),

  description     TEXT NOT NULL,
  expense_account_code TEXT NOT NULL REFERENCES financial_accounts(code),
  cost_center_id  UUID REFERENCES cost_centers(id),

  vehicle_id      UUID REFERENCES vehicles(id),
  rental_id       UUID REFERENCES rentals(id),
  vendor_name     TEXT,

  -- competência: quando o custo ocorreu. vencimento: quando a empresa paga.
  -- Separá-las é o que permite custo por período sem depender do fluxo de caixa.
  competence_date DATE NOT NULL,
  due_date        DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status          payable_status NOT NULL DEFAULT 'open',
  paid_at         DATE,

  -- Rateio em valores (Princípio 7)
  responsibility  responsibility_type NOT NULL DEFAULT 'company',
  customer_id     UUID REFERENCES customers(id),
  customer_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (customer_amount >= 0),
  reimbursement   reimbursement_mode NOT NULL DEFAULT 'none',

  source_module   TEXT NOT NULL,
  source_id       UUID,
  attachment_url  TEXT,

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- As cinco regras que tornam rateio incoerente ingravável.
  CONSTRAINT payables_customer_amount_within_total
    CHECK (customer_amount <= amount),
  CONSTRAINT payables_company_has_no_customer_share
    CHECK (responsibility <> 'company'  OR customer_amount = 0),
  CONSTRAINT payables_customer_pays_all
    CHECK (responsibility <> 'customer' OR customer_amount = amount),
  CONSTRAINT payables_share_needs_customer
    CHECK (customer_amount = 0 OR customer_id IS NOT NULL),
  CONSTRAINT payables_share_needs_reimbursement
    CHECK (customer_amount = 0 OR reimbursement <> 'none'),

  CONSTRAINT payables_paid_has_date
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

COMMENT ON TABLE payables IS
  'Spec 0014: conta a pagar da empresa, com responsabilidade e rateio. Unifica expenses, vehicle_obligations, custo de manutenção e multa da empresa.';
COMMENT ON COLUMN payables.customer_amount IS
  'Parte do cliente, em valor. Percentual é entrada de UI, nunca armazenamento (Princípio 7).';
COMMENT ON COLUMN payables.reimbursement IS
  'charge: parte do cliente vira charge_item. credit: vira crédito do cliente. none: só quando customer_amount = 0.';

CREATE INDEX idx_payables_tenant_status    ON payables (tenant_id, status);
CREATE INDEX idx_payables_tenant_due       ON payables (tenant_id, due_date) WHERE status = 'open';
CREATE INDEX idx_payables_competence       ON payables (tenant_id, competence_date);
CREATE INDEX idx_payables_vehicle          ON payables (tenant_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_payables_customer         ON payables (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_payables_source           ON payables (tenant_id, source_module, source_id);

CREATE TRIGGER trg_payables_updated_at
  BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- FK pendente da migration 06
-- ---------------------------------------------------------------------------

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_payable_id_fkey
  FOREIGN KEY (payable_id) REFERENCES payables(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payables ON payables
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT ALL ON TABLE payables TO authenticated;
GRANT ALL ON TABLE payables TO service_role;
