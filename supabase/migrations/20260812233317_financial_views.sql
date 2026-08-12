-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 14/17: views derivadas.
--
-- Todo saldo e todo estado dependente do relógio vivem aqui (Princípios 2 e 4).
--
-- Forma obrigatória: LEFT JOIN LATERAL com subconsulta agregada por linha,
-- NUNCA JOIN irmão seguido de SUM. É essa forma que torna o fan-out de F-01
-- inexpressável — vehicle_cost_summary cruzava 4 LEFT JOIN irmãos e somava,
-- multiplicando cada agregação pela cardinalidade das outras três (erro medido
-- de 5×).
--
-- Todas com security_invoker = true: o isolamento por tenant é herdado da RLS
-- das tabelas base.

-- ---------------------------------------------------------------------------
-- Saldo da cobrança
-- ---------------------------------------------------------------------------

CREATE VIEW charge_balances WITH (security_invoker = true) AS
SELECT
  c.id            AS charge_id,
  c.tenant_id,
  c.customer_id,
  c.rental_id,
  c.charge_number,
  c.status,
  c.issue_date,
  c.due_date,
  c.currency,
  COALESCE(i.total, 0)                        AS total_amount,
  COALESCE(a.allocated, 0)                    AS paid_amount,
  COALESCE(i.total, 0) - COALESCE(a.allocated, 0) AS open_amount,
  (
    c.status = 'open'
    AND COALESCE(i.total, 0) > COALESCE(a.allocated, 0)
    AND c.due_date < CURRENT_DATE
  )                                           AS is_overdue,
  GREATEST(0, CURRENT_DATE - c.due_date)      AS days_overdue
FROM charges c
LEFT JOIN LATERAL (
  SELECT SUM(ci.amount) AS total
    FROM charge_items ci
   WHERE ci.charge_id = c.id
) i ON true
LEFT JOIN LATERAL (
  SELECT SUM(pa.amount) AS allocated
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
   WHERE pa.charge_id = c.id
     AND p.reversed_at IS NULL          -- pagamento estornado não quita
) a ON true;

COMMENT ON VIEW charge_balances IS
  'Spec 0014: saldo e atraso da cobrança, derivados. Substitui billings.status=overdue, que ninguém escrevia, e os campos de saldo que dessincronizavam.';

-- ---------------------------------------------------------------------------
-- Inadimplência — substitui o trigger inerte da ADR 0014
-- ---------------------------------------------------------------------------
-- A view entrega os FATOS. A classificação em current/late/delinquent/blocked
-- fica em classifyDelinquency() de @gomoto/core, aplicada sobre a política
-- versionada — regra de negócio não vive em PL/pgSQL.

CREATE VIEW customer_delinquency WITH (security_invoker = true) AS
SELECT
  cb.tenant_id,
  cb.customer_id,
  COUNT(*)                  AS overdue_count,
  MAX(cb.days_overdue)      AS max_days_overdue,
  SUM(cb.open_amount)       AS overdue_amount,
  MIN(cb.due_date)          AS oldest_due_date
FROM charge_balances cb
WHERE cb.is_overdue
GROUP BY cb.tenant_id, cb.customer_id;

COMMENT ON VIEW customer_delinquency IS
  'Spec 0014: fatos de inadimplência por cliente. Substitui customers.delinquency_status, que permanecia current para sempre porque nada gravava status=overdue (ADR 0014 revertida).';

-- ---------------------------------------------------------------------------
-- Saldo de caução e de crédito
-- ---------------------------------------------------------------------------
-- Contas de passivo têm saldo credor, e crédito é negativo em amount_signed.
-- O sinal invertido devolve o saldo como número positivo.

CREATE VIEW deposit_balances WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.rental_id,
  -SUM(e.amount_signed) AS balance
FROM financial_entries e
WHERE e.account_code = 'caucoes_a_devolver'
  AND e.rental_id IS NOT NULL
GROUP BY e.tenant_id, e.rental_id;

COMMENT ON VIEW deposit_balances IS
  'Spec 0014: saldo da caução por locação, agregado do ledger. Substitui deposits.balance, que nunca era atualizado (F-08).';

CREATE VIEW customer_credit_balances WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.customer_id,
  -SUM(e.amount_signed) AS balance
FROM financial_entries e
WHERE e.account_code = 'creditos_de_clientes'
  AND e.customer_id IS NOT NULL
GROUP BY e.tenant_id, e.customer_id;

COMMENT ON VIEW customer_credit_balances IS
  'Spec 0014: saldo de crédito por cliente. Substitui customer_credits.available_balance, que fn_auto_apply_credit sobrescrevia em vez de acumular (F-06).';

-- ---------------------------------------------------------------------------
-- Posição financeira do veículo — substitui vehicle_cost_summary
-- ---------------------------------------------------------------------------
-- Uma tabela de fatos, um join com o catálogo, um GROUP BY. Sem tabelas irmãs
-- para cruzar, o fan-out não tem como acontecer.
--
-- net_result soma revenue e reimbursement e subtrai expense: por construção,
-- NÃO depende da política contábil do tenant. O indicador que o operador usa
-- para decidir sobre o veículo é imune à discussão de classificação.

CREATE VIEW vehicle_financial_position WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.vehicle_id,
  -SUM(e.amount_signed) FILTER (WHERE a.kind = 'revenue')       AS operating_revenue,
   SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense')       AS gross_costs,
  -SUM(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement') AS reimbursed,
  (
    -SUM(e.amount_signed) FILTER (WHERE a.kind IN ('revenue','reimbursement'))
    - SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense')
  )                                                             AS net_result,
   SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_manutencao')   AS maintenance_cost,
   SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_documentacao') AS documentation_cost,
   SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_seguro')       AS insurance_cost,
   SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_multa')        AS fines_cost,
   SUM(e.amount_signed) FILTER (WHERE a.code = 'frota_veiculos')       AS acquisition_cost,
  -SUM(e.amount_signed) FILTER (WHERE a.code = 'depreciacao_acumulada') AS accumulated_depreciation
FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.vehicle_id IS NOT NULL
GROUP BY e.tenant_id, e.vehicle_id;

COMMENT ON VIEW vehicle_financial_position IS
  'Spec 0014: posição do veículo. Substitui vehicle_cost_summary, que inflava toda soma por fan-out de 4 LEFT JOIN irmãos (F-01, erro medido de 5×).';

-- ---------------------------------------------------------------------------
-- DRE — aqui a política do tenant entra
-- ---------------------------------------------------------------------------
-- fn_resolve_report_line aplica o override do tenant vigente na DATA DO FATO,
-- caindo no default global quando não houver. Mudar a política hoje não
-- reescreve o demonstrativo do ano passado.

CREATE VIEW income_statement WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  t.branch_id,
  date_trunc('month', t.occurred_at)::date AS period,
  r.report_line_code,
  r.in_tax_base,
  -SUM(e.amount_signed) AS amount
FROM financial_entries e
JOIN financial_transactions t ON t.id = e.transaction_id
JOIN financial_accounts a     ON a.code = e.account_code
CROSS JOIN LATERAL fn_resolve_report_line(e.tenant_id, e.account_code, t.occurred_at::date) r
WHERE a.kind IN ('revenue', 'expense', 'reimbursement')
GROUP BY e.tenant_id, t.branch_id, date_trunc('month', t.occurred_at), r.report_line_code, r.in_tax_base;

COMMENT ON VIEW income_statement IS
  'Spec 0014: DRE por período e linha, resolvido pela política do tenant vigente na data do fato (ADR 0024, Princípio 6).';

-- ---------------------------------------------------------------------------
-- Resultado da locação
-- ---------------------------------------------------------------------------

CREATE VIEW rental_financial_result WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.rental_id,
  -SUM(e.amount_signed) FILTER (WHERE a.kind = 'revenue')       AS revenue,
   SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense')       AS costs,
  -SUM(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement') AS reimbursed,
  (
    -SUM(e.amount_signed) FILTER (WHERE a.kind IN ('revenue','reimbursement'))
    - SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense')
  )                                                             AS net_result
FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.rental_id IS NOT NULL
GROUP BY e.tenant_id, e.rental_id;

COMMENT ON VIEW rental_financial_result IS
  'Spec 0014: resultado da locação, agregado do ledger.';

GRANT SELECT ON charge_balances            TO authenticated;
GRANT SELECT ON customer_delinquency       TO authenticated;
GRANT SELECT ON deposit_balances           TO authenticated;
GRANT SELECT ON customer_credit_balances   TO authenticated;
GRANT SELECT ON vehicle_financial_position TO authenticated;
GRANT SELECT ON income_statement           TO authenticated;
GRANT SELECT ON rental_financial_result    TO authenticated;
