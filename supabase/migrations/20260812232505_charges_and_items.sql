-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 08/17: cobrança e seus itens.
--
-- Substitui `billings`. Duas mudanças estruturais:
--
-- 1. COBRANÇA COMPOSTA. `billings` tinha um único original_amount, o que torna
--    inexprimível a cobrança com aluguel + multa + juros que os requisitos
--    pedem. Agora a cobrança tem itens, e cada item carrega sua própria origem
--    — rastreabilidade por item, não por cobrança.
--
-- 2. SEM COLUNA DE SALDO. total_amount e paid_amount são derivados na view
--    charge_balances (Princípio 2). É o que impede o drift que hoje afeta
--    billings.credit_applied.
--
-- `overdue` não é status: atraso é due_date < CURRENT_DATE, derivado
-- (Princípio 4). Hoje o app já não confia no status armazenado — o dashboard
-- consulta `status='overdue' OR (status='pending' AND due_date < today)`.

-- ---------------------------------------------------------------------------
-- Numeração sequencial por tenant
-- ---------------------------------------------------------------------------
-- MAX(charge_number)+1 seria race-prone. O contador com UPDATE ... RETURNING
-- serializa pelo lock de linha, que é o comportamento desejado.

CREATE TABLE tenant_charge_counters (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE tenant_charge_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_charge_counters ON tenant_charge_counters
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

GRANT ALL ON TABLE tenant_charge_counters TO authenticated;
GRANT ALL ON TABLE tenant_charge_counters TO service_role;

CREATE OR REPLACE FUNCTION fn_next_charge_number(p_tenant_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_next BIGINT;
BEGIN
  INSERT INTO tenant_charge_counters (tenant_id, last_number)
  VALUES (p_tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_number = tenant_charge_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION fn_next_charge_number IS
  'Spec 0014: próximo número de cobrança do tenant. Atômico via lock de linha do UPSERT.';

-- ---------------------------------------------------------------------------
-- Cobrança
-- ---------------------------------------------------------------------------

CREATE TABLE charges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  rental_id   UUID REFERENCES rentals(id) ON DELETE RESTRICT,

  charge_number BIGINT NOT NULL,
  status        charge_status NOT NULL DEFAULT 'open',
  issue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date      DATE NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'BRL',

  -- Ponteiro para a política vigente na emissão, não cópia de JSON.
  -- Alterar a política depois não muda o encargo desta cobrança.
  late_charge_policy_id UUID REFERENCES late_charge_policies(id),

  -- Renegociação e parcelamento: a cobrança nova aponta para a que substitui.
  replaces_charge_id UUID REFERENCES charges(id),
  installment_number SMALLINT CHECK (installment_number IS NULL OR installment_number > 0),
  installment_count  SMALLINT CHECK (installment_count  IS NULL OR installment_count  > 0),

  cancellation_reason TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, charge_number),
  CONSTRAINT charges_no_self_replacement
    CHECK (replaces_charge_id IS NULL OR replaces_charge_id <> id),
  CONSTRAINT charges_installment_coherent
    CHECK ((installment_number IS NULL) = (installment_count IS NULL)
           AND (installment_number IS NULL OR installment_number <= installment_count))
);

COMMENT ON TABLE charges IS
  'Spec 0014: cobrança emitida. Sem total_amount/paid_amount — derivados em charge_balances (Princípio 2). Sem status overdue — derivado de due_date (Princípio 4).';

CREATE INDEX idx_charges_tenant_status   ON charges (tenant_id, status);
CREATE INDEX idx_charges_tenant_due      ON charges (tenant_id, due_date);
CREATE INDEX idx_charges_customer        ON charges (tenant_id, customer_id, status);
CREATE INDEX idx_charges_rental          ON charges (tenant_id, rental_id) WHERE rental_id IS NOT NULL;
-- Cobranças em aberto e vencidas: caminho quente de aging e inadimplência.
CREATE INDEX idx_charges_open_due        ON charges (tenant_id, due_date) WHERE status = 'open';

CREATE TRIGGER trg_charges_updated_at
  BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Documento emitido é imutável no conteúdo (Princípio 5). O que pode mudar é
-- o status — cancelar e dar baixa são decisões legítimas — e a justificativa.
CREATE OR REPLACE FUNCTION fn_protect_issued_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_id           IS DISTINCT FROM OLD.customer_id           OR
     NEW.rental_id             IS DISTINCT FROM OLD.rental_id             OR
     NEW.charge_number         IS DISTINCT FROM OLD.charge_number         OR
     NEW.issue_date            IS DISTINCT FROM OLD.issue_date            OR
     NEW.due_date              IS DISTINCT FROM OLD.due_date              OR
     NEW.currency              IS DISTINCT FROM OLD.currency              OR
     NEW.late_charge_policy_id IS DISTINCT FROM OLD.late_charge_policy_id
  THEN
    RAISE EXCEPTION
      'Cobrança % já emitida: conteúdo é imutável (ADR 0024, Princípio 5). Vencimento e valor mudam por renegociação, que cria nova cobrança via replaces_charge_id.',
      OLD.charge_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_charges_protect_issued
  BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION fn_protect_issued_charge();

-- ---------------------------------------------------------------------------
-- Itens
-- ---------------------------------------------------------------------------

CREATE TABLE charge_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id      UUID NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,

  description    TEXT NOT NULL,
  -- Conta creditada quando o item é lançado: receita_locacao, repasse_multa,
  -- receita_encargos_atraso… É o item que define a natureza econômica.
  credit_account_code TEXT NOT NULL REFERENCES financial_accounts(code),

  quantity       NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount    NUMERIC(14,2) NOT NULL,
  amount         NUMERIC(14,2) NOT NULL,

  -- Origem polimórfica POR ITEM. Substitui as colunas esparsas fine_id /
  -- maintenance_id de billings, que exigiam DDL a cada módulo novo.
  source_module  TEXT NOT NULL,
  source_id      UUID,

  vehicle_id     UUID REFERENCES vehicles(id),
  cost_center_id UUID REFERENCES cost_centers(id),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT charge_items_amount_matches_unit
    CHECK (amount = ROUND(quantity * unit_amount, 2))
);

COMMENT ON TABLE charge_items IS
  'Spec 0014: item da cobrança. Append-only. INSERT permitido depois da emissão (é assim que encargo realizado vira item); UPDATE e DELETE bloqueados.';

CREATE INDEX idx_charge_items_charge ON charge_items (charge_id);
CREATE INDEX idx_charge_items_source ON charge_items (tenant_id, source_module, source_id);
CREATE INDEX idx_charge_items_vehicle ON charge_items (tenant_id, vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Item é append-only. INSERT continua livre — encargo de atraso realizado vira
-- item novo na cobrança existente. Alterar ou apagar item, não.
CREATE TRIGGER trg_charge_items_immutable
  BEFORE UPDATE OR DELETE ON charge_items
  FOR EACH ROW EXECUTE FUNCTION fn_reject_financial_mutation();

-- ---------------------------------------------------------------------------
-- FKs pendentes das migrations anteriores
-- ---------------------------------------------------------------------------

ALTER TABLE financial_entries
  ADD CONSTRAINT financial_entries_charge_id_fkey
  FOREIGN KEY (charge_id) REFERENCES charges(id) ON DELETE RESTRICT;

ALTER TABLE rental_billing_schedules
  ADD CONSTRAINT rental_billing_schedules_charge_id_fkey
  FOREIGN KEY (charge_id) REFERENCES charges(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE charges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_charges ON charges
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_charge_items ON charge_items
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- Cliente vê as próprias cobranças e itens (tela de pagamento no app).
CREATE POLICY customer_read_own_charges ON charges
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT current_customer_ids()));

CREATE POLICY customer_read_own_charge_items ON charge_items
  FOR SELECT TO authenticated
  USING (charge_id IN (
    SELECT c.id FROM charges c WHERE c.customer_id IN (SELECT current_customer_ids())
  ));

GRANT ALL ON TABLE charges      TO authenticated;
GRANT ALL ON TABLE charge_items TO authenticated;
GRANT ALL ON TABLE charges      TO service_role;
GRANT ALL ON TABLE charge_items TO service_role;
