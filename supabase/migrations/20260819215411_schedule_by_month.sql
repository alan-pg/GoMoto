-- ---------------------------------------------------------------------------
-- Previsão do cronograma por mês
-- ---------------------------------------------------------------------------
-- O card "Receita/ciclo esperada" da tela de Locações somava
-- `rentals.cycle_amount` dos contratos ativos. Isso soma valores de PERÍODOS
-- DIFERENTES como se fossem a mesma unidade: um contrato mensal de R$ 1.500
-- mais um semanal de R$ 350 davam R$ 1.850, número que não significa nada. A
-- variável chamava-se `monthlyRevenue` enquanto somava valor semanal.
--
-- Somar o cronograma resolve sem convenção nenhuma: cada linha já tem seu
-- vencimento e seu valor, com o pro rata de início e fim de contrato embutido.
-- Um mês com cinco vencimentos semanais mostra cinco, que é a verdade.
--
-- A soma vive no BANCO, não na tela: um tenant com 100 contratos semanais tem
-- mais de 5.000 linhas de cronograma, e o PostgREST corta em 1.000 sem avisar
-- (ADR 0025). Somar no cliente daria um número menor com cara de número certo.
--
-- Isto NÃO é receita nem contas a receber — é previsão. Receita existe quando a
-- cobrança é emitida; a receber existe quando o cliente deve. Linha já emitida
-- continua contando, porque a pergunta é "quanto este mês prevê", não "quanto
-- ainda falta emitir" — senão o número encolheria ao longo do mês sem nada ter
-- mudado no contrato.

CREATE OR REPLACE VIEW schedule_by_month
WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  date_trunc('month', s.due_date)::date AS month,
  sum(s.amount)                          AS scheduled_amount,
  count(*)                               AS scheduled_lines
FROM rental_billing_schedules s
JOIN rentals r ON r.id = s.rental_id AND r.tenant_id = s.tenant_id
WHERE s.status NOT IN ('cancelled', 'superseded')
  AND r.status = 'active'
GROUP BY s.tenant_id, date_trunc('month', s.due_date);

COMMENT ON VIEW schedule_by_month IS
  'Previsão do cronograma por mês de vencimento, contratos ativos. Não é receita nem contas a receber: é o que o contrato prevê, incluindo o que já virou documento.';

GRANT SELECT ON schedule_by_month TO authenticated;
