-- ---------------------------------------------------------------------------
-- Isenção é fato do veículo, não estado derivável
-- ---------------------------------------------------------------------------
-- A tela de veículo oferece três situações por obrigação: Pendente, Pago e
-- Isento. Duas delas são DERIVÁVEIS da conta a pagar — pago é pago, pendente é
-- não pago — e por isso não devem virar coluna (Princípio 2). A terceira não é:
-- "esta moto é isenta de DPVAT" não se descobre olhando lançamento nenhum.
--
-- Sem lugar para guardá-la, a escolha "Isento" era silenciosamente descartada.
-- A obrigação nascia sem valor e sem conta a pagar, e `vehicle_document_status`
-- a classificava como `unbilled` — "custo nunca lançado" —, reprovando a
-- documentação do veículo por algo de que ele está dispensado. Indicador que
-- acusa o que não é problema deixa de ser consultado.

ALTER TABLE vehicle_obligations
  ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN vehicle_obligations.is_exempt IS
  'Veículo dispensado desta obrigação. Único estado não derivável das três da tela — pago e pendente saem da conta a pagar.';

-- `CREATE OR REPLACE VIEW` não acrescenta coluna no meio da lista — ele tenta
-- renomear as existentes e falha. Recriar é o caminho; a de rolagem depende
-- desta, então cai junto e volta logo abaixo.
DROP VIEW IF EXISTS vehicle_document_status;
DROP VIEW IF EXISTS vehicle_obligation_status;

CREATE VIEW vehicle_obligation_status AS
SELECT
  o.tenant_id,
  o.vehicle_id,
  o.id                AS obligation_id,
  o.type,
  o.reference_year,
  o.description,
  o.due_date,
  o.is_exempt,
  o.payable_id,
  p.amount,
  p.status            AS payable_status,
  p.paid_at,
  CASE
    WHEN o.is_exempt               THEN 'exempt'
    WHEN p.id IS NULL              THEN 'unbilled'
    WHEN p.status = 'cancelled'    THEN 'cancelled'
    WHEN p.status = 'paid'         THEN 'paid'
    WHEN o.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'open'
  END                 AS status,
  CASE
    WHEN o.is_exempt THEN 0
    WHEN p.id IS NOT NULL AND p.status IN ('paid', 'cancelled') THEN 0
    ELSE GREATEST(0, CURRENT_DATE - o.due_date)
  END                 AS days_overdue
FROM vehicle_obligations o
LEFT JOIN payables p ON p.id = o.payable_id;

COMMENT ON VIEW vehicle_obligation_status IS
  'Situação de cada obrigação do veículo, derivada da conta a pagar e do relógio. Só a isenção é persistida.';

CREATE VIEW vehicle_document_status AS
SELECT
  s.tenant_id,
  s.vehicle_id,
  count(*) FILTER (WHERE s.status = 'overdue')  AS overdue_count,
  count(*) FILTER (WHERE s.status = 'open')     AS open_count,
  count(*) FILTER (WHERE s.status = 'unbilled') AS unbilled_count,
  count(*) FILTER (WHERE s.status = 'paid')     AS paid_count,
  count(*) FILTER (WHERE s.status = 'exempt')   AS exempt_count,
  max(s.days_overdue)                           AS worst_days_overdue,
  min(s.due_date) FILTER (WHERE s.status IN ('open', 'overdue', 'unbilled')) AS next_due_date,
  max(s.reference_year)                         AS latest_reference_year,
  -- Isento não é pendência: o veículo está em dia justamente por não dever.
  (count(*) FILTER (WHERE s.status IN ('overdue', 'unbilled')) = 0) AS is_compliant
FROM vehicle_obligation_status s
WHERE s.status <> 'cancelled'
GROUP BY s.tenant_id, s.vehicle_id;

COMMENT ON VIEW vehicle_document_status IS
  'Um veículo por linha: vencidas, a vencer, sem custo lançado e isentas. `is_compliant` responde "documentação em dia?".';

GRANT SELECT ON vehicle_obligation_status TO authenticated;
GRANT SELECT ON vehicle_document_status  TO authenticated;
