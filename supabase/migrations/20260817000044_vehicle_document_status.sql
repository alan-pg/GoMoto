-- ---------------------------------------------------------------------------
-- "Este veículo está com a documentação em dia?"
-- ---------------------------------------------------------------------------
-- `vehicle_obligations` já guardava o que precisa: tipo, ano de referência,
-- vencimento e o vínculo com a conta a pagar — com unicidade por (veículo,
-- tipo, ano) nos tributos anuais. O que não existia era como PERGUNTAR: para
-- saber se o IPVA está pago era preciso juntar obrigação com payable na mão, em
-- cada tela, e cada uma juntava de um jeito.
--
-- A situação é derivada, nunca coluna (Princípios 2 e 4): depende de
-- `payables.status` e da comparação de `due_date` com HOJE. Gravar "em dia"
-- numa coluna significaria um veículo em dia na quinta e ainda "em dia" na
-- sexta seguinte ao vencimento, porque ninguém rodou o job.
--
-- Três estados de pendência, e eles não se confundem:
--
--   `unbilled` — obrigação cadastrada e custo NUNCA lançado. É o silencioso: o
--                DPVAT existe na ficha, não existe no contas a pagar, e some de
--                qualquer relatório que parta de despesa.
--   `overdue`  — custo lançado, não pago, vencimento no passado.
--   `open`     — custo lançado, não pago, ainda dentro do prazo.
--
-- Decisão do Alan (2026-08-17): rastrear documento em dia e alimentar relatório.

CREATE OR REPLACE VIEW vehicle_obligation_status AS
SELECT
  o.tenant_id,
  o.vehicle_id,
  o.id                AS obligation_id,
  o.type,
  o.reference_year,
  o.description,
  o.due_date,
  o.payable_id,
  p.amount,
  p.status            AS payable_status,
  p.paid_at,
  CASE
    WHEN p.id IS NULL              THEN 'unbilled'
    WHEN p.status = 'cancelled'    THEN 'cancelled'
    WHEN p.status = 'paid'         THEN 'paid'
    WHEN o.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'open'
  END                 AS status,
  -- Dias de atraso só fazem sentido enquanto há o que pagar.
  CASE
    WHEN p.id IS NOT NULL AND p.status IN ('paid', 'cancelled') THEN 0
    ELSE GREATEST(0, CURRENT_DATE - o.due_date)
  END                 AS days_overdue
FROM vehicle_obligations o
LEFT JOIN payables p ON p.id = o.payable_id;

COMMENT ON VIEW vehicle_obligation_status IS
  'Situação de cada obrigação do veículo (IPVA, licenciamento, DPVAT, seguro…), derivada da conta a pagar e do relógio. Nunca persistida.';

-- ---------------------------------------------------------------------------
-- Rolagem por veículo — a resposta curta para a tela de frota
-- ---------------------------------------------------------------------------
-- Só veículos que TÊM obrigação cadastrada aparecem aqui. Ausência de cadastro
-- é outra pergunta ("o IPVA 2026 desta moto foi lançado?"), e ela depende de
-- quais tributos o tenant considera obrigatórios — política dele, não do
-- produto (Princípio 6). `latest_reference_year` existe para o relatório
-- conseguir apontar a lacuna sem que o banco precise adivinhar a regra.
CREATE OR REPLACE VIEW vehicle_document_status AS
SELECT
  s.tenant_id,
  s.vehicle_id,
  count(*) FILTER (WHERE s.status = 'overdue')  AS overdue_count,
  count(*) FILTER (WHERE s.status = 'open')     AS open_count,
  count(*) FILTER (WHERE s.status = 'unbilled') AS unbilled_count,
  count(*) FILTER (WHERE s.status = 'paid')     AS paid_count,
  max(s.days_overdue)                           AS worst_days_overdue,
  min(s.due_date) FILTER (WHERE s.status IN ('open', 'overdue', 'unbilled')) AS next_due_date,
  max(s.reference_year)                         AS latest_reference_year,
  -- Em dia = nada vencido E nada sem custo lançado. Uma obrigação a vencer não
  -- desqualifica o veículo; uma esquecida no contas a pagar, sim.
  (count(*) FILTER (WHERE s.status IN ('overdue', 'unbilled')) = 0) AS is_compliant
FROM vehicle_obligation_status s
WHERE s.status <> 'cancelled'
GROUP BY s.tenant_id, s.vehicle_id;

COMMENT ON VIEW vehicle_document_status IS
  'Um veículo por linha: quantas obrigações vencidas, a vencer e sem custo lançado. `is_compliant` responde "documentação em dia?".';

GRANT SELECT ON vehicle_obligation_status TO authenticated;
GRANT SELECT ON vehicle_document_status  TO authenticated;
