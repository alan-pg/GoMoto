-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 07/17: cronograma de cobrança da locação.
--
-- Reversão da ADR 0009. Antes: 104 documentos de cobrança emitidos na
-- assinatura, o que fazia "Total a receber" somar o contrato inteiro e obrigava
-- o reajuste a reescrever documento financeiro.
--
-- Agora: o cronograma é o PLANO — mutável, é onde o reajuste atua. A cobrança
-- (migration 08) é o DOCUMENTO, emitido quando o período chega e imutável
-- depois disso (Princípio 5).
--
-- Preview (RF-036 do PRD 0004) continua funcionando: passa a ler o cronograma,
-- gerado pela mesma função pura generateSchedule() de @gomoto/core.

CREATE TABLE rental_billing_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id       UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,

  sequence_number INT  NOT NULL CHECK (sequence_number > 0),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  due_date        DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),

  status          schedule_status NOT NULL DEFAULT 'scheduled',

  -- FK adicionada na migration 08, quando charges existir.
  charge_id       UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (rental_id, sequence_number),
  CONSTRAINT rental_schedule_period_ordered CHECK (period_end >= period_start),
  -- emitida ⟺ tem cobrança. Impede linha "issued" órfã e cobrança sem vínculo.
  CONSTRAINT rental_schedule_issued_has_charge
    CHECK ((status = 'issued') = (charge_id IS NOT NULL))
);

COMMENT ON TABLE rental_billing_schedules IS
  'Spec 0014: plano de cobrança da locação. Reajuste altera linhas scheduled; linhas issued são intocáveis (ADR 0024 reverte a ADR 0009).';
COMMENT ON COLUMN rental_billing_schedules.status IS
  'scheduled: ainda não virou documento. issued: cobrança emitida. cancelled: encerramento antecipado. superseded: substituída por reajuste.';

-- Emissão: o job varre por (status, due_date). Índice parcial serve exatamente isso.
CREATE INDEX idx_rental_schedules_pending
  ON rental_billing_schedules (tenant_id, period_start)
  WHERE status = 'scheduled';

CREATE INDEX idx_rental_schedules_rental ON rental_billing_schedules (rental_id, sequence_number);

CREATE TRIGGER trg_rental_schedules_updated_at
  BEFORE UPDATE ON rental_billing_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Linha já emitida não volta atrás: só o cronograma futuro é editável.
-- Reajuste sobre período já emitido exige cobrança complementar ou renegociação
-- (charges.replaces_charge_id), nunca alteração retroativa.
CREATE OR REPLACE FUNCTION fn_protect_issued_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'issued' AND (
       NEW.amount          IS DISTINCT FROM OLD.amount       OR
       NEW.due_date        IS DISTINCT FROM OLD.due_date     OR
       NEW.period_start    IS DISTINCT FROM OLD.period_start OR
       NEW.period_end      IS DISTINCT FROM OLD.period_end   OR
       NEW.charge_id       IS DISTINCT FROM OLD.charge_id    OR
       NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
     ) THEN
    RAISE EXCEPTION
      'Linha de cronograma % já emitida: documento é imutável (ADR 0024, Princípio 5). Use cobrança complementar ou renegociação.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rental_schedules_protect_issued
  BEFORE UPDATE ON rental_billing_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_protect_issued_schedule();

ALTER TABLE rental_billing_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rental_billing_schedules ON rental_billing_schedules
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- Cliente vê o cronograma da própria locação (previsão de cobranças no app).
CREATE POLICY customer_read_own_rental_schedules ON rental_billing_schedules
  FOR SELECT TO authenticated
  USING (rental_id IN (
    SELECT r.id FROM rentals r
      JOIN customers c ON c.id = r.customer_id
     WHERE c.user_id = auth.uid() AND r.tenant_id = rental_billing_schedules.tenant_id
  ));

GRANT ALL ON TABLE rental_billing_schedules TO authenticated;
GRANT ALL ON TABLE rental_billing_schedules TO service_role;
