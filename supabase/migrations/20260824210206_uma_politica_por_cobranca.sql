-- ---------------------------------------------------------------------------
-- Uma resposta só para "qual política de encargo vale nesta cobrança"
-- ---------------------------------------------------------------------------
-- Existiam três, e elas discordavam na tela:
--
--   fn_create_charge     → effective_from <= due_date
--   issue_due_charges    → effective_from <= CURRENT_DATE, resolvida UMA vez
--                          antes do laço, valendo para o lote inteiro
--   lista do cockpit     → política vigente HOJE, aplicada a todas as linhas,
--                          ignorando a que cada cobrança congelou
--
-- Com uma política só na base ninguém percebia. Bastou existir uma segunda
-- versão para a mesma cobrança mostrar R$ 35 de multa fixa na lista e 2% na
-- tela de detalhe.
--
-- A regra passa a ser a DATA DE EMISSÃO. É a que corresponde ao documento:
-- encargo é cláusula, e vale a que estava em vigor quando a cobrança saiu.
-- `due_date` tinha um efeito colateral difícil de defender — cobrança emitida
-- hoje com vencimento em 60 dias podia pegar uma versão AGENDADA, ainda não
-- vigente, e nascer sob uma regra que ninguém tinha começado a aplicar.
--
-- A resolução do lote também sai de dentro do laço para dentro da linha: um
-- lote com vencimentos diferentes é um lote de documentos diferentes.

CREATE OR REPLACE FUNCTION fn_late_charge_policy_at(
  p_tenant_id UUID,
  p_on_date   DATE
) RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT id
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id
     AND effective_from <= p_on_date
   ORDER BY effective_from DESC, version DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION fn_late_charge_policy_at IS
  'Política de encargo em vigor numa data. Fonte única — emissão avulsa, cron e telas resolvem por aqui.';

-- `charge_balances` passa a carregar a política congelada. Sem isso a lista não
-- TEM como acertar: ela recebe as linhas da view e não sabe qual regra cada
-- cobrança carrega, então usava a de hoje para todas.
CREATE OR REPLACE VIEW charge_balances
WITH (security_invoker = true) AS
  SELECT c.id AS charge_id,
     c.tenant_id,
     c.customer_id,
     c.rental_id,
     c.charge_number,
         CASE
             WHEN c.status = ANY (ARRAY['cancelled'::charge_status, 'written_off'::charge_status]) THEN c.status
             WHEN (COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric)) <= 0::numeric THEN 'paid'::charge_status
             ELSE 'open'::charge_status
         END AS status,
     c.issue_date,
     c.due_date,
     c.currency,
     COALESCE(i.total, 0::numeric) AS total_amount,
     COALESCE(a.allocated, 0::numeric) AS paid_amount,
     COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric) AS open_amount,
     (c.status <> ALL (ARRAY['cancelled'::charge_status, 'written_off'::charge_status])) AND COALESCE(i.total, 0::numeric) > COALESCE(a.allocated, 0::numeric) AND c.due_date < CURRENT_DATE AS is_overdue,
     GREATEST(0, CURRENT_DATE - c.due_date) AS days_overdue,
     -- No fim da lista porque `CREATE OR REPLACE VIEW` só aceita coluna nova
     -- no fim; derrubar a view arrastaria junto tudo que depende dela.
     c.late_charge_policy_id
    FROM charges c
      LEFT JOIN LATERAL ( SELECT sum(ci.amount) AS total
            FROM charge_items ci
           WHERE ci.charge_id = c.id) i ON true
      LEFT JOIN LATERAL ( SELECT sum(pa.amount) AS allocated
            FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
           WHERE pa.charge_id = c.id AND p.reversed_at IS NULL) a ON true;

-- ---------------------------------------------------------------------------
-- Emissão avulsa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_create_charge(p_tenant_id uuid, p_charge jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total     NUMERIC(14,2);
  v_vehicle   UUID;
  v_number    BIGINT;
  v_policy    UUID;
  v_charge    UUID;
  v_rental    UUID := NULLIF(p_charge->>'rental_id', '')::UUID;
  v_customer  UUID := (p_charge->>'customer_id')::UUID;
  v_source_id UUID := NULLIF(p_charge->>'source_id', '')::UUID;
  v_entries   JSONB;
  v_tx        UUID;
BEGIN
  SELECT SUM((i->>'amount')::NUMERIC) INTO v_total
    FROM jsonb_array_elements(p_items) i;

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Cobrança precisa ter valor maior que zero';
  END IF;

  -- Sem veículo no lançamento a cobrança some do resultado por veículo. Item
  -- que traz o seu manda; a locação é o piso.
  SELECT (i->>'vehicle_id')::UUID INTO v_vehicle
    FROM jsonb_array_elements(p_items) i
   WHERE NULLIF(i->>'vehicle_id', '') IS NOT NULL
   LIMIT 1;

  IF v_vehicle IS NULL AND v_rental IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle
      FROM rentals WHERE id = v_rental AND tenant_id = p_tenant_id;
  END IF;

  v_number := fn_next_charge_number(p_tenant_id);

  -- Data de EMISSÃO, não de vencimento: encargo é cláusula do documento, e
  -- vale a que estava em vigor quando ele saiu.
  v_policy := fn_late_charge_policy_at(
    p_tenant_id,
    COALESCE(NULLIF(p_charge->>'issue_date', '')::DATE, CURRENT_DATE)
  );

  INSERT INTO charges (
    tenant_id, customer_id, rental_id, charge_number,
    source_module, source_id, due_date, issue_date,
    late_charge_policy_id, created_by
  )
  VALUES (
    p_tenant_id, v_customer, v_rental, v_number,
    p_charge->>'source_module', v_source_id,
    (p_charge->>'due_date')::DATE,
    COALESCE(NULLIF(p_charge->>'issue_date', '')::DATE, CURRENT_DATE),
    v_policy, NULLIF(p_charge->>'created_by', '')::UUID
  )
  RETURNING id INTO v_charge;

  -- Origem vem do DOCUMENTO: uma cobrança cobra uma coisa só, e deixar o item
  -- declarar a sua permitiria divergir do documento que o contém.
  INSERT INTO charge_items (
    tenant_id, charge_id, description, credit_account_code,
    quantity, unit_amount, amount, source_module, source_id, vehicle_id
  )
  SELECT
    p_tenant_id, v_charge, i->>'description', i->>'credit_account_code',
    COALESCE((i->>'quantity')::NUMERIC, 1),
    (i->>'unit_amount')::NUMERIC,
    (i->>'amount')::NUMERIC,
    p_charge->>'source_module', v_source_id,
    COALESCE(NULLIF(i->>'vehicle_id', '')::UUID, v_vehicle)
  FROM jsonb_array_elements(p_items) i;

  -- Um documento emitido é UM fato: uma transação, com o débito do total em
  -- contas a receber e um crédito por natureza econômica. A versão anterior
  -- abria uma transação por conta creditada, fragmentando o mesmo fato.
  v_entries := jsonb_build_array(
    jsonb_build_object(
      'account_code', 'contas_a_receber',
      'direction',    'debit',
      'amount',       v_total,
      'customer_id',  v_customer,
      'rental_id',    v_rental,
      'charge_id',    v_charge,
      'vehicle_id',   v_vehicle
    )
  );

  SELECT v_entries || COALESCE(jsonb_agg(
    jsonb_build_object(
      'account_code', conta,
      'direction',    'credit',
      'amount',       valor,
      'customer_id',  v_customer,
      'rental_id',    v_rental,
      'charge_id',    v_charge,
      'vehicle_id',   v_vehicle
    )
  ), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT i->>'credit_account_code' AS conta,
           ROUND(SUM((i->>'amount')::NUMERIC), 2) AS valor
      FROM jsonb_array_elements(p_items) i
     GROUP BY 1
  ) agrupado;

  v_tx := post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'charge_issued',
      'description',   'Cobrança #' || v_number,
      'source_module', p_charge->>'source_module',
      'source_id',     v_source_id,
      'created_by',    NULLIF(p_charge->>'created_by', '')::UUID
    ),
    v_entries
  );

  RETURN jsonb_build_object(
    'charge_id',      v_charge,
    'charge_number',  v_number,
    'total_amount',   v_total,
    'transaction_id', v_tx
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Emissão do ciclo (cron)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_due_charges(p_tenant_id uuid, p_lead_days integer DEFAULT 0)
 RETURNS TABLE(schedule_id uuid, charge_id uuid, charge_number bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      RECORD;
  v_charge   UUID;
  v_number   BIGINT;
BEGIN
  -- A resolução saiu daqui para dentro do laço (ver o INSERT abaixo): emitir em
  -- lote não torna as cobranças o mesmo documento, e uma virada de política no
  -- meio da execução deixaria metade do lote com a regra errada.

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
      v_row.due_date, fn_late_charge_policy_at(p_tenant_id, CURRENT_DATE),
      'rental', v_row.id
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
$function$;

-- ---------------------------------------------------------------------------
-- O cliente precisa enxergar a política das cobranças dele
-- ---------------------------------------------------------------------------
-- `charges` tem `customer_read_own_charges`; `late_charge_policies` não tinha
-- nada equivalente. O app lia a cobrança e recebia ZERO política, então exibia
-- o principal limpo — sem multa, sem juros.
--
-- O Pix não passa por aí: o Route Handler usa service role, que ignora RLS e
-- resolve a política de verdade. O cliente via R$ 350,00 na tela, tocava em
-- pagar, e recebia um QR de R$ 360,47.
--
-- A exposição é a mínima: só as políticas efetivamente presas a cobranças que
-- aquele cliente já pode ler.
CREATE POLICY customer_read_own_late_charge_policies
  ON late_charge_policies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM charges c
       WHERE c.late_charge_policy_id = late_charge_policies.id
         AND c.customer_id IN (SELECT current_customer_ids())
    )
  );
