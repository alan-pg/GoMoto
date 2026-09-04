-- ---------------------------------------------------------------------------
-- Quanto do emitido e do recebido é caução
-- ---------------------------------------------------------------------------
-- Caução é dinheiro de terceiro: entra no caixa e um dia sai. Ela É recebível e
-- ELA entrou no caixa, então sair dos totais faria os cards deixarem de bater
-- com o extrato. Mas somada ao aluguel sem distinção, "Recebido no mês:
-- R$ 500,00" pode ser 100% depósito — e o DRE, que corretamente ignora passivo,
-- mostra outro número sem explicação.
--
-- A saída é declarar, não esconder: o total continua inteiro e a parcela de
-- caução vem ao lado.
--
-- Uma cobrança é de caução quando TODOS os seus itens creditam
-- `caucoes_a_devolver`. A regra de origem única (ADR 0024) garante que não há
-- meio-termo; o `bool_and` é o que torna isso explícito em vez de suposto.

CREATE OR REPLACE VIEW receivables_by_month
WITH (security_invoker = true) AS
  WITH deposit_flag AS (
    SELECT ci.charge_id,
           bool_and(ci.credit_account_code = 'caucoes_a_devolver') AS is_deposit
      FROM charge_items ci
     GROUP BY ci.charge_id
  )
  SELECT b.tenant_id,
     date_trunc('month'::text, b.due_date::timestamp with time zone)::date AS month,
     count(*) AS charge_count,
     COALESCE(sum(b.total_amount), 0::numeric) AS issued_total,
     COALESCE(sum(b.paid_amount), 0::numeric) AS paid_total,
     COALESCE(sum(b.open_amount) FILTER (WHERE b.status = 'open'::charge_status AND NOT b.is_overdue), 0::numeric) AS pending_total,
     COALESCE(sum(b.open_amount) FILTER (WHERE b.is_overdue), 0::numeric) AS overdue_total,
     count(*) FILTER (WHERE b.status = 'paid'::charge_status) AS paid_count,
     count(*) FILTER (WHERE b.status = 'open'::charge_status AND NOT b.is_overdue) AS pending_count,
     count(*) FILTER (WHERE b.is_overdue) AS overdue_count,
     COALESCE(sum(b.total_amount) FILTER (WHERE d.is_deposit), 0::numeric) AS deposit_issued,
     COALESCE(sum(b.paid_amount)  FILTER (WHERE d.is_deposit), 0::numeric) AS deposit_paid
    FROM charge_balances b
    LEFT JOIN deposit_flag d ON d.charge_id = b.charge_id
   WHERE b.status <> 'cancelled'::charge_status
   GROUP BY b.tenant_id, (date_trunc('month'::text, b.due_date::timestamp with time zone));

COMMENT ON VIEW receivables_by_month IS
  'Recebíveis por mês de vencimento. `deposit_*` isola a parcela de caução — passivo, não receita — para os KPIs poderem declarar quanto do total é dinheiro de terceiro.';
