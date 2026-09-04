-- ---------------------------------------------------------------------------
-- O DRE passa a carregar o rótulo e a ordem da linha (P-10)
-- ---------------------------------------------------------------------------
-- `income_statement` devolvia só `report_line_code`. Qualquer consumidor que
-- quisesse exibir o demonstrativo teria de manter a sua própria tradução de
-- código para nome e a sua própria ordem — e `report_lines` existe justamente
-- para isso ser único.
--
-- Ordem importa num demonstrativo: receita bruta em cima, perdas embaixo. Se
-- ela ficar no cliente, cada tela ordena de um jeito e o mesmo relatório sai
-- diferente na web e no mobile.
--
-- A view continua sendo pura soma dos lançamentos: nada aqui muda o número,
-- só o que acompanha o número. `security_invoker` é preservado — sem ele a
-- view leria com os privilégios do dono e furaria a RLS.

DROP VIEW IF EXISTS income_statement;

CREATE VIEW income_statement
WITH (security_invoker = true)
AS
SELECT
  e.tenant_id,
  date_trunc('month', t.occurred_at)::date          AS period,
  r.report_line_code,
  COALESCE(rl.name, r.report_line_code)             AS report_line_name,
  COALESCE(rl.sort_order, 999)                      AS sort_order,
  r.in_tax_base,
  -SUM(e.amount_signed)                             AS amount
FROM financial_entries e
JOIN financial_transactions t ON t.id = e.transaction_id
JOIN financial_accounts a     ON a.code = e.account_code
CROSS JOIN LATERAL fn_resolve_report_line(e.tenant_id, e.account_code, t.occurred_at::date)
  AS r(report_line_code, in_tax_base)
LEFT JOIN report_lines rl ON rl.code = r.report_line_code
WHERE a.kind = ANY (ARRAY['revenue'::account_kind, 'expense'::account_kind, 'reimbursement'::account_kind])
GROUP BY e.tenant_id, date_trunc('month', t.occurred_at), r.report_line_code, rl.name, rl.sort_order, r.in_tax_base;

COMMENT ON VIEW income_statement IS
  'DRE por competência. O agrupamento usa a linha que a política do tenant atribuía à conta NA DATA DO FATO: política nova não reclassifica o passado (ADR 0024, Princípio 6).';
