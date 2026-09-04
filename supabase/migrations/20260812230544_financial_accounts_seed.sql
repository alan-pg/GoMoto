-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 02/17: plano de contas.
--
-- Catálogo GLOBAL, sem tenant_id. Exceção deliberada à regra do CLAUDE.md,
-- seguindo o precedente já existente de permissions / permission_modules:
-- o plano de contas é definido pelo produto, não pelo tenant. O que o tenant
-- configura é (a) o centro de custo e (b) a linha de DRE das contas marcadas
-- is_configurable — ver migration 03.

CREATE TABLE financial_accounts (
  code             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             account_kind NOT NULL,
  normal_direction entry_direction NOT NULL,
  -- true = tenant pode remapear a linha de DRE desta conta (ADR 0024, Princípio 6)
  is_configurable  BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE financial_accounts IS
  'Spec 0014: plano de contas global. Sem tenant_id por decisão (ADR 0024), precedente: permissions.';
COMMENT ON COLUMN financial_accounts.is_configurable IS
  'Se true, o tenant pode remapear a linha de DRE em tenant_account_mappings.';

INSERT INTO financial_accounts (code, name, kind, normal_direction, is_configurable, sort_order) VALUES
  -- Ativo
  ('caixa_e_bancos',          'Caixa e bancos',            'asset',         'debit',  false,  10),
  ('contas_a_receber',        'Contas a receber',          'asset',         'debit',  false,  20),
  ('frota_veiculos',          'Frota de veículos',         'asset',         'debit',  true,   30),
  ('depreciacao_acumulada',   'Depreciação acumulada',     'asset',         'credit', true,   40),

  -- Passivo — estrutural, nunca configurável: é dinheiro de terceiro
  ('caucoes_a_devolver',      'Cauções a devolver',        'liability',     'credit', false, 110),
  ('creditos_de_clientes',    'Créditos de clientes',      'liability',     'credit', false, 120),
  ('contas_a_pagar',          'Contas a pagar',            'liability',     'credit', false, 130),

  -- Receita
  ('receita_locacao',         'Receita de locação',        'revenue',       'credit', false, 210),
  ('receita_encargos_atraso', 'Receita de encargos',       'revenue',       'credit', true,  220),
  ('receita_venda_ativo',     'Receita de venda de ativo', 'revenue',       'credit', true,  230),

  -- Despesa
  ('despesa_manutencao',      'Despesa de manutenção',     'expense',       'debit',  false, 310),
  ('despesa_multa',           'Despesa com multas',        'expense',       'debit',  false, 320),
  ('despesa_documentacao',    'Despesa de documentação',   'expense',       'debit',  false, 330),
  ('despesa_seguro',          'Despesa de seguro',         'expense',       'debit',  false, 340),
  ('despesa_operacional',     'Despesa operacional',       'expense',       'debit',  false, 350),
  ('despesa_depreciacao',     'Despesa de depreciação',    'expense',       'debit',  true,  360),
  ('perda_inadimplencia',     'Perda por inadimplência',   'expense',       'debit',  false, 370),

  -- Repasse ao cliente. Conta própria, JAMAIS abatida dentro da despesa nem
  -- somada à receita — é essa granularidade que permite ao tenant escolher
  -- entre tratamento bruto e líquido sem perder informação (ADR 0024).
  ('repasse_manutencao',      'Repasse de manutenção',     'reimbursement', 'credit', true,  410),
  ('repasse_multa',           'Repasse de multa',          'reimbursement', 'credit', true,  420),
  ('repasse_operacional',     'Repasse de despesa',        'reimbursement', 'credit', true,  430);

-- Catálogo global: leitura para qualquer autenticado, escrita só por migration.
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_accounts_read ON financial_accounts
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON TABLE financial_accounts TO authenticated;
GRANT ALL    ON TABLE financial_accounts TO service_role;
