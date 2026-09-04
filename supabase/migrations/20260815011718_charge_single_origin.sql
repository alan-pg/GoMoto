-- ---------------------------------------------------------------------------
-- Uma cobrança cobra uma coisa só
-- ---------------------------------------------------------------------------
-- Regra de negócio confirmada em 2026-08-14: cobrança de ciclo cobra locação;
-- multa gera uma cobrança por multa; manutenção idem — e cada uma é paga
-- individualmente. Nada de misturar origens num mesmo documento.
--
-- Na prática o sistema já se comportava assim (34 cobranças, nenhuma com mais
-- de uma origem), porque todo chamador de `createCharge` passa um
-- `sourceModule` único. O que faltava era a estrutura IMPEDIR o contrário —
-- até aqui era acordo verbal, e acordo verbal é o que este redesenho vem
-- substituindo por invariante.
--
-- Três mudanças:
--   a) a origem sobe do item para a COBRANÇA, que passa a declará-la;
--   b) trigger garante que nenhum item foge da origem do documento;
--   c) índice único impede a mesma origem gerar duas cobranças vivas.
--
-- (c) resolve de brinde um buraco que ninguém tinha notado: nada impedia
-- registrar a mesma multa duas vezes e cobrar o cliente em dobro.

-- ---------------------------------------------------------------------------
-- a) Origem na cobrança
-- ---------------------------------------------------------------------------

ALTER TABLE charges
  ADD COLUMN source_module TEXT,
  ADD COLUMN source_id     UUID;

-- Backfill: toda cobrança existente tem no máximo uma origem entre seus itens.
UPDATE charges c
   SET source_module = i.source_module,
       source_id     = i.source_id
  FROM (
    SELECT DISTINCT ON (charge_id) charge_id, source_module, source_id
      FROM charge_items
     ORDER BY charge_id, created_at
  ) i
 WHERE i.charge_id = c.id;

-- Cobrança sem item não tem origem declarada por ninguém.
UPDATE charges SET source_module = 'manual' WHERE source_module IS NULL;

ALTER TABLE charges ALTER COLUMN source_module SET NOT NULL;

COMMENT ON COLUMN charges.source_module IS
  'O que esta cobrança cobra. Uma cobrança tem uma origem só (ADR 0024).';
COMMENT ON COLUMN charges.source_id IS
  'Registro que originou a cobrança: a multa, a manutenção, a linha de cronograma.';

CREATE INDEX idx_charges_source ON charges (tenant_id, source_module, source_id);

-- ---------------------------------------------------------------------------
-- b) Item não foge da origem do documento
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_assert_charge_item_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_module TEXT;
  v_source UUID;
BEGIN
  -- Encargo por atraso é ACESSÓRIO da própria dívida, não outra coisa sendo
  -- cobrada: acompanha o principal no mesmo documento e no mesmo pagamento.
  IF NEW.source_module = 'late_charge' THEN
    RETURN NEW;
  END IF;

  SELECT source_module, source_id INTO v_module, v_source
    FROM charges WHERE id = NEW.charge_id;

  IF NEW.source_module IS DISTINCT FROM v_module
     OR NEW.source_id IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION
      'Item de origem (%, %) não cabe nesta cobrança, cuja origem é (%, %). Uma cobrança cobra uma coisa só (ADR 0024).',
      NEW.source_module, NEW.source_id, v_module, v_source
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_charge_item_origin
  BEFORE INSERT OR UPDATE ON charge_items
  FOR EACH ROW EXECUTE FUNCTION fn_assert_charge_item_origin();

-- ---------------------------------------------------------------------------
-- b.2) Cobranças de ciclo já emitidas apontam para a locação; migrar para a linha
-- ---------------------------------------------------------------------------
-- A versão anterior de `issue_due_charges` gravava `source_id = rental_id`, o
-- que faz TODAS as cobranças de uma locação compartilharem a mesma origem — e o
-- índice único de (c) barraria a segunda. O mapa correto é
-- `rental_billing_schedules.charge_id`, que existe justamente até (e).

UPDATE charges c
   SET source_id = s.id
  FROM rental_billing_schedules s
 WHERE s.charge_id = c.id
   AND c.source_module = 'rental';

-- O item é imutável para a APLICAÇÃO (Princípio 3) e a trigger recusa o UPDATE.
-- Aqui não é a aplicação corrigindo um valor: é a migration reescrevendo a
-- REPRESENTAÇÃO da origem, sem tocar em valor, conta ou data. Desligar a trava
-- por dois comandos, com ela religada logo em seguida, é o escopo certo — o
-- alternativo seria deixar os itens antigos apontando para a locação enquanto
-- suas cobranças apontam para o período, tornando falso o invariante que esta
-- própria migration cria.
ALTER TABLE charge_items DISABLE TRIGGER trg_charge_items_immutable;

UPDATE charge_items ci
   SET source_id = c.source_id
  FROM charges c
 WHERE ci.charge_id = c.id
   AND ci.source_module = 'rental';

ALTER TABLE charge_items ENABLE TRIGGER trg_charge_items_immutable;

-- Sobra o que foi criado fora do fluxo (fixtures antigas, inserção direta):
-- sem linha de cronograma, não há origem em nível de período a declarar. Fica
-- NULL, e o índice parcial de (c) as ignora em vez de recusar a migration.
UPDATE charges c
   SET source_id = NULL
 WHERE c.source_module = 'rental'
   AND NOT EXISTS (SELECT 1 FROM rental_billing_schedules s WHERE s.charge_id = c.id);

-- ---------------------------------------------------------------------------
-- c) Uma origem, no máximo uma cobrança viva
-- ---------------------------------------------------------------------------
-- Cancelada fica de fora: revisar a multa cancela a cobrança anterior e emite
-- outra, e isso precisa continuar possível.

CREATE UNIQUE INDEX idx_charges_one_per_source
  ON charges (tenant_id, source_module, source_id)
  WHERE source_id IS NOT NULL AND status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- d) Emissão: a origem do ciclo é a LINHA DE CRONOGRAMA
-- ---------------------------------------------------------------------------
-- Apontar para a locação faria todas as cobranças dela compartilharem a mesma
-- origem, e o índice de (c) barraria a segunda. Apontar para o período também
-- é mais fiel ao fato: a cobrança nasce daquele período, não do contrato.

CREATE OR REPLACE FUNCTION issue_due_charges(
  p_tenant_id  UUID,
  p_lead_days  INT DEFAULT 0
)
RETURNS TABLE (schedule_id UUID, charge_id UUID, charge_number BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      RECORD;
  v_charge   UUID;
  v_number   BIGINT;
  v_policy   UUID;
BEGIN
  SELECT id INTO v_policy
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id AND effective_from <= CURRENT_DATE
   ORDER BY effective_from DESC, version DESC
   LIMIT 1;

  FOR v_row IN
    SELECT s.*, r.customer_id, r.vehicle_id
      FROM rental_billing_schedules s
      JOIN rentals r ON r.id = s.rental_id
     WHERE s.tenant_id = p_tenant_id
       AND s.status    = 'scheduled'
       AND s.period_start <= CURRENT_DATE + p_lead_days
       AND r.status    = 'active'
     ORDER BY s.due_date
     FOR UPDATE OF s
  LOOP
    v_number := fn_next_charge_number(p_tenant_id);

    INSERT INTO charges (
      tenant_id, customer_id, rental_id, charge_number,
      due_date, late_charge_policy_id, source_module, source_id
    )
    VALUES (
      p_tenant_id, v_row.customer_id, v_row.rental_id, v_number,
      v_row.due_date, v_policy, 'rental', v_row.id
    )
    RETURNING id INTO v_charge;

    INSERT INTO charge_items (
      tenant_id, charge_id, description, credit_account_code,
      unit_amount, amount, source_module, source_id, vehicle_id
    )
    VALUES (
      p_tenant_id, v_charge,
      'Locação ' || to_char(v_row.period_start, 'DD/MM/YYYY') ||
        ' a ' || to_char(v_row.period_end, 'DD/MM/YYYY'),
      'receita_locacao',
      v_row.amount, v_row.amount,
      'rental', v_row.id, v_row.vehicle_id
    );

    UPDATE rental_billing_schedules
       SET status = 'issued', updated_at = now()
     WHERE id = v_row.id;

    schedule_id   := v_row.id;
    charge_id     := v_charge;
    charge_number := v_number;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- e) Fim do vínculo bidirecional
-- ---------------------------------------------------------------------------
-- Com `charges.source_id` apontando para a linha, `schedules.charge_id`
-- apontava de volta: dois lados que podem divergir, sem nada garantindo.
-- Navegar do cronograma para a cobrança é um filtro pela origem, e o índice
-- criado em (c) o torna direto. A coluna não tinha nenhum consumidor no código.

-- A trava de imutabilidade da linha cita a coluna; recriada sem ela.
CREATE OR REPLACE FUNCTION fn_protect_issued_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'issued' AND (
       NEW.amount          IS DISTINCT FROM OLD.amount       OR
       NEW.due_date        IS DISTINCT FROM OLD.due_date     OR
       NEW.period_start    IS DISTINCT FROM OLD.period_start OR
       NEW.period_end      IS DISTINCT FROM OLD.period_end   OR
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

ALTER TABLE rental_billing_schedules DROP COLUMN IF EXISTS charge_id;
