-- ---------------------------------------------------------------------------
-- Receita × Despesa por mês, agregada no banco e sem contar o que foi desfeito
-- ---------------------------------------------------------------------------
-- O gráfico de 6 meses do dashboard trazia todas as linhas de `payments` e
-- `payables` do período e as agrupava por mês em JavaScript. Três problemas no
-- mesmo lugar:
--
-- 1. **Truncagem.** PostgREST devolve no máximo 1.000 linhas, sem erro. Meia
--    dúzia de meses de operação real e o gráfico passa a desenhar parte do
--    movimento — com a forma de um gráfico correto (ADR 0025).
--
-- 2. **Pagamento estornado contava como receita.** A consulta não filtrava
--    `reversed_at`. Neste banco são 57 pagamentos estornados, R$ 17.970 — a
--    linha de receita subia por dinheiro que foi devolvido. O estorno ficou
--    alcançável pela tela nesta mesma sessão, então o erro deixou de ser
--    teórico.
--
-- 3. **Despesa cancelada contava como custo.** Mesma ausência de filtro:
--    12 contas canceladas, R$ 4.200.
--
-- A parte do cliente sai do custo (R-03): somar `amount` cheio contaria como
-- despesa da empresa o que ela recupera por cobrança de repasse.

CREATE OR REPLACE VIEW cash_flow_by_month AS
SELECT
  tenant_id,
  month,
  COALESCE(sum(revenue), 0) AS revenue,
  COALESCE(sum(expense), 0) AS expense
FROM (
  -- Dinheiro que entrou. Estornado não entrou.
  SELECT
    tenant_id,
    date_trunc('month', paid_at)::date AS month,
    amount                             AS revenue,
    0::numeric                         AS expense
  FROM payments
  WHERE reversed_at IS NULL

  UNION ALL

  -- Custo da empresa: o total menos a parte repassada ao cliente.
  SELECT
    tenant_id,
    date_trunc('month', competence_date)::date,
    0::numeric,
    amount - COALESCE(customer_amount, 0)
  FROM payables
  WHERE status <> 'cancelled'
) t
GROUP BY tenant_id, month;

COMMENT ON VIEW cash_flow_by_month IS
  'Receita recebida e custo da empresa por mês. Ignora pagamento estornado e conta a pagar cancelada; a parte do cliente já sai do custo.';

GRANT SELECT ON cash_flow_by_month TO authenticated;
