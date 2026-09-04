-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 04/17: dimensões organizacionais.
--
-- branches e cost_centers existem desde já porque são DIMENSÕES do lançamento:
-- acrescentá-las depois exigiria ALTER em financial_entries, que é append-only
-- e a tabela mais quente do domínio. Custo agora: duas tabelas pequenas.

CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  cnpj            TEXT,
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  base_currency   CHAR(3) NOT NULL DEFAULT 'BRL',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE branches IS
  'Spec 0014: filial. Dimensão de lançamento — permite resultado por filial sem alterar o ledger.';

-- No máximo uma matriz por tenant.
CREATE UNIQUE INDEX idx_branches_one_hq_per_tenant
  ON branches (tenant_id) WHERE is_headquarters;

CREATE INDEX idx_branches_tenant ON branches (tenant_id);

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_branches ON branches
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT ALL ON TABLE branches TO authenticated;
GRANT ALL ON TABLE branches TO service_role;

-- ---------------------------------------------------------------------------

CREATE TABLE cost_centers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE cost_centers IS
  'Spec 0014: centro de custo configurável pelo tenant. É a extensibilidade analítica que substitui abrir contas próprias no plano global.';

CREATE INDEX idx_cost_centers_tenant ON cost_centers (tenant_id) WHERE active;

CREATE TRIGGER trg_cost_centers_updated_at
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cost_centers ON cost_centers
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT ALL ON TABLE cost_centers TO authenticated;
GRANT ALL ON TABLE cost_centers TO service_role;
