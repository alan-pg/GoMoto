-- Spec 0014 / ADR 0024 — correção nas views de resultado.
--
-- `SUM(...) FILTER (WHERE ...)` devolve NULL quando nenhuma linha satisfaz o
-- filtro, e NULL contamina toda a expressão: um veículo com receita e sem
-- despesa produzia `net_result = NULL` em vez do lucro real.
--
-- Detectado na verificação ponta a ponta: veículo com R$ 500 de receita e
-- R$ 200 de repasse mostrava resultado vazio, não R$ 700.
--
-- Correção: COALESCE em cada agregado. Zero é a resposta certa para "não houve
-- movimento nesta natureza" — diferente de "desconhecido".

DROP VIEW IF EXISTS vehicle_financial_position;
DROP VIEW IF EXISTS rental_financial_result;

CREATE VIEW vehicle_financial_position WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.vehicle_id,
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'revenue'), 0)       AS operating_revenue,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)       AS gross_costs,
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement'), 0) AS reimbursed,
  (
    COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind IN ('revenue','reimbursement')), 0)
    - COALESCE(SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)
  )                                                                          AS net_result,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_manutencao'), 0)    AS maintenance_cost,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_documentacao'), 0)  AS documentation_cost,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_seguro'), 0)        AS insurance_cost,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_multa'), 0)         AS fines_cost,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.code = 'frota_veiculos'), 0)        AS acquisition_cost,
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.code = 'depreciacao_acumulada'), 0) AS accumulated_depreciation
FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.vehicle_id IS NOT NULL
GROUP BY e.tenant_id, e.vehicle_id;

COMMENT ON VIEW vehicle_financial_position IS
  'Spec 0014: posição do veículo. Substitui vehicle_cost_summary, que inflava toda soma por fan-out de 4 LEFT JOIN irmãos (F-01). net_result soma receita e reembolso e subtrai despesa: por construção, não depende da política contábil do tenant.';

CREATE VIEW rental_financial_result WITH (security_invoker = true) AS
SELECT
  e.tenant_id,
  e.rental_id,
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'revenue'), 0)       AS revenue,
  COALESCE( SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)       AS costs,
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement'), 0) AS reimbursed,
  (
    COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind IN ('revenue','reimbursement')), 0)
    - COALESCE(SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)
  )                                                                          AS net_result
FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.rental_id IS NOT NULL
GROUP BY e.tenant_id, e.rental_id;

COMMENT ON VIEW rental_financial_result IS
  'Spec 0014: resultado da locação, agregado do ledger.';

GRANT SELECT ON vehicle_financial_position TO authenticated;
GRANT SELECT ON rental_financial_result    TO authenticated;
