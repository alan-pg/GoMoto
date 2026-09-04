-- ---------------------------------------------------------------------------
-- Limpeza: dimensões inertes e valores derivados guardados em coluna
-- ---------------------------------------------------------------------------
-- Auditoria de 2026-08-14 sobre a própria Spec 0014. Três achados, todos
-- introduzidos por mim ao escrever a spec — vale corrigir antes de crescer.
--
-- 1. `branches`, `cost_centers` e `fiscal_documents` foram criadas antecipando
--    multi-filial e documento fiscal. Nenhuma linha, nenhum uso no app, e as
--    colunas de dimensão que existiam para servi-las estavam 100% NULL: 0 de
--    110 transações, 0 de 202 lançamentos, 0 de 62 cobranças. Nenhuma tela
--    jamais pediu filial ou centro de custo.
--
--    Três tabelas, cinco colunas, índices e políticas RLS sustentando um
--    requisito que ninguém pediu. Readicionar depois custa uma migration;
--    manter custa para sempre. Sai.
--
-- 2. `vehicle_financial_position` expõe `acquisition_cost` e
--    `accumulated_depreciation`, alimentados por eventos (`vehicle_acquired`,
--    `depreciation_posted`) que existem na regra pura e NÃO TÊM CHAMADOR. As
--    duas colunas retornam zero por construção. Campo que sempre retorna zero é
--    pior que campo ausente: alguém constrói relatório em cima e não percebe.
--    ROI hoje sai de `vehicles.acquisition_value`.
--
-- 3. `charges.status` guardava uma derivação. `paid` é "o saldo zerou" —
--    calculável. Só `cancelled` e `written_off` são decisões humanas. O código
--    escrevia `status='paid'` como último passo, DEPOIS do lançamento, e a view
--    usava `status='open'` para calcular atraso. Se aquele UPDATE falhasse, a
--    cobrança ficava em aberto com saldo zero: listada como devendo, possivelmente
--    marcada como vencida. É o mesmo defeito do `customers.delinquency_status`
--    que esta ADR removeu, em escala menor — e contradiz o Princípio 2.
--
--    A coluna passa a guardar só decisão; a view deriva o resto.

-- ---------------------------------------------------------------------------
-- 1. Dimensões inertes
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS income_statement;

ALTER TABLE charges              DROP COLUMN IF EXISTS branch_id;
ALTER TABLE charge_items         DROP COLUMN IF EXISTS cost_center_id;
ALTER TABLE financial_entries    DROP COLUMN IF EXISTS cost_center_id;
ALTER TABLE financial_transactions DROP COLUMN IF EXISTS branch_id;
ALTER TABLE payables             DROP COLUMN IF EXISTS branch_id;
ALTER TABLE payables             DROP COLUMN IF EXISTS cost_center_id;

DROP TABLE IF EXISTS fiscal_documents;
DROP TABLE IF EXISTS cost_centers;
DROP TABLE IF EXISTS branches;

-- A escrita atômica no ledger deixa de aceitar as dimensões removidas.
CREATE OR REPLACE FUNCTION post_financial_transaction(
  p_tenant_id   UUID,
  p_transaction JSONB,
  p_entries     JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION
      'Lançamento exige contrapartida: recebido % perna(s) (ADR 0024, Princípio 1).',
      jsonb_array_length(p_entries)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO financial_transactions (
    tenant_id, event_type, occurred_at, description,
    currency, exchange_rate, source_module, source_id,
    reverses_transaction_id, created_by
  )
  VALUES (
    p_tenant_id,
    p_transaction->>'event_type',
    COALESCE((p_transaction->>'occurred_at')::timestamptz, now()),
    p_transaction->>'description',
    COALESCE(p_transaction->>'currency', 'BRL'),
    COALESCE((p_transaction->>'exchange_rate')::numeric, 1),
    p_transaction->>'source_module',
    NULLIF(p_transaction->>'source_id', '')::uuid,
    NULLIF(p_transaction->>'reverses_transaction_id', '')::uuid,
    NULLIF(p_transaction->>'created_by', '')::uuid
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO financial_entries (
    tenant_id, transaction_id, account_code, direction, amount,
    customer_id, vehicle_id, rental_id, charge_id, payable_id
  )
  SELECT
    p_tenant_id,
    v_tx_id,
    e->>'account_code',
    (e->>'direction')::entry_direction,
    (e->>'amount')::numeric,
    NULLIF(e->>'customer_id', '')::uuid,
    NULLIF(e->>'vehicle_id', '')::uuid,
    NULLIF(e->>'rental_id', '')::uuid,
    NULLIF(e->>'charge_id', '')::uuid,
    NULLIF(e->>'payable_id', '')::uuid
  FROM jsonb_array_elements(p_entries) AS e;

  RETURN v_tx_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. DRE sem a dimensão de filial
-- ---------------------------------------------------------------------------

CREATE VIEW income_statement WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  date_trunc('month', t.occurred_at)::date AS period,
  r.report_line_code,
  r.in_tax_base,
  -sum(e.amount_signed) AS amount
FROM financial_entries e
JOIN financial_transactions t ON t.id = e.transaction_id
JOIN financial_accounts a ON a.code = e.account_code
CROSS JOIN LATERAL fn_resolve_report_line(e.tenant_id, e.account_code, t.occurred_at::date) r(report_line_code, in_tax_base)
WHERE a.kind = ANY (ARRAY['revenue'::account_kind, 'expense'::account_kind, 'reimbursement'::account_kind])
GROUP BY e.tenant_id, date_trunc('month', t.occurred_at), r.report_line_code, r.in_tax_base;

-- ---------------------------------------------------------------------------
-- 3. Posição do veículo sem os campos estruturalmente zerados
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS vehicle_financial_position;

CREATE VIEW vehicle_financial_position WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.vehicle_id,
  COALESCE(-sum(e.amount_signed) FILTER (WHERE a.kind = 'revenue'), 0) AS operating_revenue,
  COALESCE(sum(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0) AS gross_costs,
  COALESCE(-sum(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement'), 0) AS reimbursed,
  COALESCE(-sum(e.amount_signed) FILTER (WHERE a.kind IN ('revenue', 'reimbursement')), 0)
    - COALESCE(sum(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0) AS net_result,
  COALESCE(sum(e.amount_signed) FILTER (WHERE a.code = 'despesa_manutencao'), 0) AS maintenance_cost,
  COALESCE(sum(e.amount_signed) FILTER (WHERE a.code = 'despesa_documentacao'), 0) AS documentation_cost,
  COALESCE(sum(e.amount_signed) FILTER (WHERE a.code = 'despesa_seguro'), 0) AS insurance_cost,
  COALESCE(sum(e.amount_signed) FILTER (WHERE a.code = 'despesa_multa'), 0) AS fines_cost
FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.vehicle_id IS NOT NULL
GROUP BY e.tenant_id, e.vehicle_id;

-- ---------------------------------------------------------------------------
-- 4. Status da cobrança: coluna guarda decisão, view deriva o resto
-- ---------------------------------------------------------------------------

-- `customer_delinquency` lê desta view; recriada logo abaixo, sem alteração.
DROP VIEW IF EXISTS charge_balances CASCADE;

CREATE VIEW charge_balances WITH (security_invoker = true) AS
SELECT
  c.id AS charge_id,
  c.tenant_id,
  c.customer_id,
  c.rental_id,
  c.charge_number,
  -- `paid` é derivado: saldo zerado. A coluna só decide cancelamento e baixa.
  CASE
    WHEN c.status IN ('cancelled', 'written_off') THEN c.status
    WHEN COALESCE(i.total, 0) - COALESCE(a.allocated, 0) <= 0 THEN 'paid'::charge_status
    ELSE 'open'::charge_status
  END AS status,
  c.issue_date,
  c.due_date,
  c.currency,
  COALESCE(i.total, 0) AS total_amount,
  COALESCE(a.allocated, 0) AS paid_amount,
  COALESCE(i.total, 0) - COALESCE(a.allocated, 0) AS open_amount,
  c.status NOT IN ('cancelled', 'written_off')
    AND COALESCE(i.total, 0) > COALESCE(a.allocated, 0)
    AND c.due_date < CURRENT_DATE AS is_overdue,
  GREATEST(0, CURRENT_DATE - c.due_date) AS days_overdue
FROM charges c
LEFT JOIN LATERAL (
  SELECT sum(ci.amount) AS total FROM charge_items ci WHERE ci.charge_id = c.id
) i ON true
LEFT JOIN LATERAL (
  SELECT sum(pa.amount) AS allocated
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
   WHERE pa.charge_id = c.id AND p.reversed_at IS NULL
) a ON true;

COMMENT ON VIEW charge_balances IS
  'Saldo e estado derivados. `status` calcula `paid`; a coluna em charges guarda apenas decisão humana (cancelamento e baixa).';

-- Recriada porque depende de charge_balances (derrubada em cascata acima).
CREATE VIEW customer_delinquency WITH (security_invoker = true) AS
SELECT
  tenant_id,
  customer_id,
  count(*) AS overdue_count,
  max(days_overdue) AS max_days_overdue,
  sum(open_amount) AS overdue_amount,
  min(due_date) AS oldest_due_date
FROM charge_balances
WHERE is_overdue
GROUP BY tenant_id, customer_id;
