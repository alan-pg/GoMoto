-- ---------------------------------------------------------------------------
-- Totais de recebível vêm agregados do banco, não somados no navegador
-- ---------------------------------------------------------------------------
-- Dashboard e Painel financeiro liam `charge_balances` SEM limite e somavam as
-- linhas em JavaScript. PostgREST devolve no máximo **1000 linhas**, sem erro e
-- sem aviso: passando disso, "Total a Receber", "Em Atraso" e "Recebido no Mês"
-- passam a mostrar a soma de um pedaço da carteira. O número continua
-- plausível — é essa a parte ruim.
--
-- Não é escala distante. Este banco de desenvolvimento já tem 313 cobranças e
-- 1.636 lançamentos; a operação real de alguns meses passa de 1.000 sem
-- esforço. E o modo de falha é o mesmo que acabou de acontecer duas vezes nesta
-- sessão: `.in()` estourando URI (414) e varredura truncada em 1.000 linhas.
--
-- Agregar aqui resolve as duas coisas de uma vez: o número está sempre certo
-- por construção, e trafega uma linha em vez de milhares. Paginar para somar
-- seria correto e ainda assim desperdício.

CREATE OR REPLACE VIEW receivables_summary AS
SELECT
  tenant_id,
  count(*) FILTER (WHERE status = 'open' AND open_amount > 0)                AS open_count,
  COALESCE(sum(open_amount) FILTER (WHERE status = 'open' AND open_amount > 0), 0) AS open_total,
  count(*) FILTER (WHERE is_overdue)                                          AS overdue_count,
  COALESCE(sum(open_amount) FILTER (WHERE is_overdue), 0)                     AS overdue_total,
  count(DISTINCT customer_id) FILTER (WHERE is_overdue)                       AS overdue_customers
FROM charge_balances
GROUP BY tenant_id;

COMMENT ON VIEW receivables_summary IS
  'Carteira a receber em uma linha por tenant. Existe para o painel não somar milhares de linhas no cliente — e não errar quando elas passarem de 1.000.';

-- Recorte mensal: "Recebido no mês", "Emitido no mês" e a composição por
-- situação. O mês é dimensão, não parâmetro, então uma view resolve todos.
CREATE OR REPLACE VIEW receivables_by_month AS
SELECT
  tenant_id,
  date_trunc('month', due_date)::date                       AS month,
  count(*)                                                   AS charge_count,
  COALESCE(sum(total_amount), 0)                             AS issued_total,
  COALESCE(sum(paid_amount), 0)                              AS paid_total,
  COALESCE(sum(open_amount) FILTER (WHERE status = 'open' AND NOT is_overdue), 0) AS pending_total,
  COALESCE(sum(open_amount) FILTER (WHERE is_overdue), 0)    AS overdue_total,
  count(*) FILTER (WHERE status = 'paid')                    AS paid_count,
  count(*) FILTER (WHERE status = 'open' AND NOT is_overdue) AS pending_count,
  count(*) FILTER (WHERE is_overdue)                         AS overdue_count
FROM charge_balances
WHERE status <> 'cancelled'
GROUP BY tenant_id, date_trunc('month', due_date);

COMMENT ON VIEW receivables_by_month IS
  'Recebível por mês de vencimento: emitido, recebido, a vencer e vencido. Base dos cartões e do gráfico mensal.';

GRANT SELECT ON receivables_summary  TO authenticated;
GRANT SELECT ON receivables_by_month TO authenticated;
