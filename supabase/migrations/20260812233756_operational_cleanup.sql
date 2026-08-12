-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 16/17: entidades operacionais perdem o controle financeiro.
--
-- fines, maintenances e vehicle_obligations PERMANECEM — são entidades de
-- domínio legítimas. O que sai delas é o dinheiro: cada uma passa a materializar
-- um payable, e o controle de pagamento vive lá.
--
-- Alta coesão: a regra "um IPVA por veículo por ano" continua onde pertence;
-- o status de pagamento sai de seis vocabulários diferentes para um só.

-- ---------------------------------------------------------------------------
-- Multas
-- ---------------------------------------------------------------------------
-- A multa continua com valor: é atributo do auto de infração, não controle
-- financeiro. O que sai é status/data de pagamento, que agora vivem no payable.

ALTER TABLE fines
  ADD COLUMN payable_id UUID REFERENCES payables(id) ON DELETE SET NULL,
  DROP COLUMN status,
  DROP COLUMN payment_date;

CREATE INDEX idx_fines_payable ON fines (payable_id) WHERE payable_id IS NOT NULL;

COMMENT ON COLUMN fines.payable_id IS
  'Spec 0014: conta a pagar gerada pela multa. Responsabilidade e rateio vivem no payable.';
COMMENT ON COLUMN fines.amount IS
  'Valor do auto de infração. Não é controle financeiro — quem controla pagamento é payables.';

-- ---------------------------------------------------------------------------
-- Manutenções
-- ---------------------------------------------------------------------------
-- effective_customer_payer_pct sai: rateio em percentual inteiro não representa
-- 1/3 e deixa centavo sem dono (F-17, Princípio 7). O rateio passa a ser
-- payables.customer_amount, em valor.

ALTER TABLE maintenances
  ADD COLUMN payable_id UUID REFERENCES payables(id) ON DELETE SET NULL,
  DROP COLUMN cost,
  DROP COLUMN effective_customer_payer_pct;

CREATE INDEX idx_maintenances_payable ON maintenances (payable_id) WHERE payable_id IS NOT NULL;

COMMENT ON COLUMN maintenances.payable_id IS
  'Spec 0014: conta a pagar da manutenção. Custo e rateio vivem no payable, em valores.';

-- effective_executor permanece: quem executou é fato operacional, não financeiro.

-- ---------------------------------------------------------------------------
-- Obrigações do veículo
-- ---------------------------------------------------------------------------
-- Vira o calendário fiscal do veículo: o que vence, quando, e a unicidade por
-- ano. O dinheiro sai inteiro para payables.

ALTER TABLE vehicle_obligations
  ADD COLUMN payable_id UUID REFERENCES payables(id) ON DELETE SET NULL,
  DROP COLUMN amount,
  DROP COLUMN status,
  DROP COLUMN paid_at,
  DROP COLUMN payment_method,
  DROP COLUMN payment_reference,
  DROP COLUMN receipt_url;

CREATE INDEX idx_vehicle_obligations_payable ON vehicle_obligations (payable_id) WHERE payable_id IS NOT NULL;

COMMENT ON TABLE vehicle_obligations IS
  'Spec 0014: calendário fiscal do veículo (IPVA, licenciamento). Sem colunas de dinheiro — o valor e o pagamento vivem no payable vinculado.';

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
-- delinquency_status era mantido por trigger que nunca disparava para o caso
-- que importa, contando um status que nada gravava (F-04). Substituído pela
-- view customer_delinquency.
--
-- payment_status é o antecessor da mesma ideia, também derivável das cobranças.

ALTER TABLE customers
  DROP COLUMN delinquency_status,
  DROP COLUMN payment_status;

DROP TYPE IF EXISTS delinquency_level;

-- ---------------------------------------------------------------------------
-- Locações
-- ---------------------------------------------------------------------------
-- late_charge_config era snapshot de política copiado por locação. Agora a
-- cobrança aponta para a versão vigente na emissão (R-08).
--
-- monthly_amount é resquício de quando só havia ciclo mensal; cycle_amount +
-- cycle o substituíram, e o cronograma carrega o valor de cada período.

ALTER TABLE rentals
  DROP COLUMN late_charge_config,
  DROP COLUMN monthly_amount;
