-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 03/17: camada de classificação para relatório.
--
-- ADR 0024, Princípio 6: o ledger registra o FATO; o tenant escolhe a
-- CLASSIFICAÇÃO. O GoMoto é multi-tenant e empresas em Simples, Lucro
-- Presumido e Lucro Real recebem orientações contábeis divergentes sobre o
-- mesmo fato — nenhuma delas é "a certa".
--
-- Desenho: default GLOBAL na conta + override POR TENANT. Um tenant que nunca
-- configurar nada recebe o tratamento conservador (repasse como recuperação de
-- despesa) sem depender de seed por tenant — o que elimina a classe de falha
-- "tenant novo sem mapeamento gera DRE vazio".

-- ---------------------------------------------------------------------------
-- Catálogo global de linhas de demonstrativo
-- ---------------------------------------------------------------------------

CREATE TABLE report_lines (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  statement  TEXT NOT NULL CHECK (statement IN ('dre', 'cash_flow', 'balance')),
  sort_order INT  NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE report_lines IS
  'Spec 0014: catálogo global de linhas de demonstrativo. Sem tenant_id (catálogo de produto).';

INSERT INTO report_lines (code, name, statement, sort_order) VALUES
  ('gross_revenue',     'Receita bruta',              'dre', 10),
  ('expense_recovery',  'Recuperação de despesas',    'dre', 20),
  ('operating_cost',    'Custos operacionais',        'dre', 30),
  ('depreciation',      'Depreciação',                'dre', 40),
  ('financial_income',  'Receitas financeiras',       'dre', 50),
  ('loss_provision',    'Perdas',                     'dre', 60);

ALTER TABLE report_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_lines_read ON report_lines
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON TABLE report_lines TO authenticated;
GRANT ALL    ON TABLE report_lines TO service_role;

-- ---------------------------------------------------------------------------
-- Default global por conta
-- ---------------------------------------------------------------------------

ALTER TABLE financial_accounts
  ADD COLUMN default_report_line_code TEXT REFERENCES report_lines(code),
  ADD COLUMN default_in_tax_base      BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN financial_accounts.default_report_line_code IS
  'Linha de DRE usada quando o tenant não define override. NULL = fora do DRE (conta patrimonial).';
COMMENT ON COLUMN financial_accounts.default_in_tax_base IS
  'Default conservador para base de receita bruta. Tenant pode sobrescrever.';

-- Contas de resultado. Patrimoniais (asset/liability) ficam com NULL: não entram no DRE.
UPDATE financial_accounts SET default_report_line_code = 'gross_revenue',    default_in_tax_base = true
  WHERE code IN ('receita_locacao', 'receita_venda_ativo');

UPDATE financial_accounts SET default_report_line_code = 'financial_income', default_in_tax_base = true
  WHERE code = 'receita_encargos_atraso';

-- Default conservador: repasse é recuperação de despesa, FORA da base fiscal.
-- O tenant que precisar do tratamento bruto remapeia para gross_revenue.
UPDATE financial_accounts SET default_report_line_code = 'expense_recovery', default_in_tax_base = false
  WHERE kind = 'reimbursement';

UPDATE financial_accounts SET default_report_line_code = 'operating_cost',   default_in_tax_base = false
  WHERE code IN ('despesa_manutencao', 'despesa_multa', 'despesa_documentacao',
                 'despesa_seguro', 'despesa_operacional');

UPDATE financial_accounts SET default_report_line_code = 'depreciation',     default_in_tax_base = false
  WHERE code = 'despesa_depreciacao';

UPDATE financial_accounts SET default_report_line_code = 'loss_provision',   default_in_tax_base = false
  WHERE code = 'perda_inadimplencia';

-- Toda conta de resultado precisa de linha de DRE; toda patrimonial não pode ter.
ALTER TABLE financial_accounts ADD CONSTRAINT financial_accounts_report_line_coherent
  CHECK (
    (kind IN ('revenue', 'expense', 'reimbursement') AND default_report_line_code IS NOT NULL)
    OR
    (kind IN ('asset', 'liability', 'equity')        AND default_report_line_code IS NULL)
  );

-- ---------------------------------------------------------------------------
-- Override por tenant, versionado
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_account_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version          INT  NOT NULL,
  effective_from   DATE NOT NULL,
  account_code     TEXT NOT NULL REFERENCES financial_accounts(code),
  report_line_code TEXT NOT NULL REFERENCES report_lines(code),
  in_tax_base      BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version, account_code)
);

COMMENT ON TABLE tenant_account_mappings IS
  'Spec 0014: override da linha de DRE por tenant. Versionado e resolvido por effective_from contra a DATA DO FATO, nunca a da consulta — mudar a política hoje não reescreve o demonstrativo do ano passado.';

-- Só contas marcadas is_configurable podem ser remapeadas. Impede que um
-- tenant reclassifique caixa ou caução, que são estruturais (ADR 0024).
CREATE OR REPLACE FUNCTION fn_assert_account_configurable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM financial_accounts
     WHERE code = NEW.account_code AND is_configurable
  ) THEN
    RAISE EXCEPTION 'Conta % não é reclassificável: sua natureza é estrutural (ADR 0024).',
      NEW.account_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_account_mappings_configurable
  BEFORE INSERT OR UPDATE ON tenant_account_mappings
  FOR EACH ROW EXECUTE FUNCTION fn_assert_account_configurable();

CREATE TRIGGER trg_tenant_account_mappings_updated_at
  BEFORE UPDATE ON tenant_account_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_tenant_account_mappings_lookup
  ON tenant_account_mappings (tenant_id, account_code, effective_from DESC);

ALTER TABLE tenant_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_account_mappings ON tenant_account_mappings
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT ALL ON TABLE tenant_account_mappings TO authenticated;
GRANT ALL ON TABLE tenant_account_mappings TO service_role;

-- ---------------------------------------------------------------------------
-- Resolução: override do tenant vigente na data do fato, senão default global
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_resolve_report_line(
  p_tenant_id    UUID,
  p_account_code TEXT,
  p_occurred_on  DATE
)
RETURNS TABLE (report_line_code TEXT, in_tax_base BOOLEAN)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(m.report_line_code, a.default_report_line_code),
         COALESCE(m.in_tax_base,      a.default_in_tax_base)
    FROM financial_accounts a
    LEFT JOIN LATERAL (
      SELECT tm.report_line_code, tm.in_tax_base
        FROM tenant_account_mappings tm
       WHERE tm.tenant_id      = p_tenant_id
         AND tm.account_code   = a.code
         AND tm.effective_from <= p_occurred_on
       ORDER BY tm.effective_from DESC, tm.version DESC
       LIMIT 1
    ) m ON true
   WHERE a.code = p_account_code;
$$;

COMMENT ON FUNCTION fn_resolve_report_line IS
  'Spec 0014: resolve a linha de DRE de uma conta para um tenant numa data. Override do tenant vence o default global; sem override, o default conservador se aplica.';
