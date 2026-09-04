-- ---------------------------------------------------------------------------
-- Emissão de cobrança e de conta a pagar viram atômicas
-- ---------------------------------------------------------------------------
-- `createCharge` e `createPayable` faziam de 3 a 6 chamadas separadas ao
-- PostgREST: INSERT do documento, INSERT dos itens, lançamento no razão, e no
-- rateio ainda a cobrança de repasse. Cada uma é a sua própria transação — o
-- cliente JS não abre transação multi-statement.
--
-- Queda de processo entre duas delas deixa documento sem lançamento: a cobrança
-- aparece na tela, some do DRE e de `contas_a_receber`, e nada acusa. É o único
-- estado que o modelo da ADR 0024 não consegue proibir por trigger, porque o
-- documento é legítimo no instante anterior ao lançamento existir.
--
-- Aqui as duas viram função: uma chamada, uma transação, tudo ou nada. Mesmo
-- caminho que `fn_issue_charges_for_tenant` já usava para o job.
--
-- SECURITY INVOKER de propósito: a RLS continua valendo e o tenant do chamador
-- é o que manda. Nada aqui precisa de privilégio elevado.

-- ---------------------------------------------------------------------------
-- Cobrança
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_create_charge(
  p_tenant_id UUID,
  p_charge    JSONB,
  p_items     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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

  SELECT id INTO v_policy
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id
     AND effective_from <= (p_charge->>'due_date')::DATE
   ORDER BY effective_from DESC, version DESC
   LIMIT 1;

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
$$;

COMMENT ON FUNCTION fn_create_charge IS
  'Emite cobrança, itens e lançamento numa transação só. Documento sem lançamento é o único estado que nenhum trigger consegue proibir.';

REVOKE ALL ON FUNCTION fn_create_charge(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_create_charge(UUID, JSONB, JSONB) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conta a pagar
-- ---------------------------------------------------------------------------
-- O rateio entra aqui inteiro: custo integral como despesa da empresa e, quando
-- há parte do cliente, a recuperação em documento separado. Nunca abatido por
-- dentro — custo bruto e repasse têm de continuar visíveis lado a lado.

CREATE OR REPLACE FUNCTION fn_create_payable(
  p_tenant_id UUID,
  p_payable   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_payable    UUID;
  v_amount     NUMERIC(14,2) := (p_payable->>'amount')::NUMERIC;
  v_customer_a NUMERIC(14,2) := COALESCE((p_payable->>'customer_amount')::NUMERIC, 0);
  v_expense    TEXT := p_payable->>'expense_account_code';
  v_customer   UUID := NULLIF(p_payable->>'customer_id', '')::UUID;
  v_vehicle    UUID := NULLIF(p_payable->>'vehicle_id', '')::UUID;
  v_rental     UUID := NULLIF(p_payable->>'rental_id', '')::UUID;
  v_source_id  UUID := NULLIF(p_payable->>'source_id', '')::UUID;
  v_reimb      TEXT := COALESCE(p_payable->>'reimbursement', 'charge');
  v_repasse    TEXT;
  v_charge     JSONB;
  v_credit     UUID;
  v_result     JSONB;
BEGIN
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Conta a pagar precisa ter valor maior que zero';
  END IF;
  IF v_customer_a < 0 OR v_customer_a > v_amount THEN
    RAISE EXCEPTION 'Parte do cliente (%) fora do intervalo do total (%)', v_customer_a, v_amount;
  END IF;

  INSERT INTO payables (
    tenant_id, description, expense_account_code, competence_date, due_date,
    amount, responsibility, customer_id, customer_amount, reimbursement,
    vehicle_id, rental_id, vendor_name, source_module, source_id,
    attachment_url, created_by
  )
  VALUES (
    p_tenant_id, p_payable->>'description', v_expense,
    (p_payable->>'competence_date')::DATE, (p_payable->>'due_date')::DATE,
    v_amount, (p_payable->>'responsibility')::responsibility_type,
    v_customer, v_customer_a,
    (CASE WHEN v_customer_a = 0 THEN 'none' ELSE v_reimb END)::reimbursement_mode,
    v_vehicle, v_rental, NULLIF(p_payable->>'vendor_name', ''),
    p_payable->>'source_module', v_source_id,
    NULLIF(p_payable->>'attachment_url', ''),
    NULLIF(p_payable->>'created_by', '')::UUID
  )
  RETURNING id INTO v_payable;

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'payable_created',
      'description',   p_payable->>'description',
      'source_module', p_payable->>'source_module',
      'source_id',     COALESCE(v_source_id, v_payable),
      'created_by',    NULLIF(p_payable->>'created_by', '')::UUID
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', v_expense, 'direction', 'debit',  'amount', v_amount,
                         'customer_id', v_customer, 'vehicle_id', v_vehicle,
                         'rental_id', v_rental, 'payable_id', v_payable),
      jsonb_build_object('account_code', 'contas_a_pagar', 'direction', 'credit', 'amount', v_amount,
                         'customer_id', v_customer, 'vehicle_id', v_vehicle,
                         'rental_id', v_rental, 'payable_id', v_payable)
    )
  );

  v_result := jsonb_build_object('payable_id', v_payable);

  IF v_customer_a > 0 THEN
    v_repasse := CASE v_expense
      WHEN 'despesa_manutencao' THEN 'repasse_manutencao'
      WHEN 'despesa_multa'      THEN 'repasse_multa'
      ELSE 'repasse_operacional'
    END;

    IF v_reimb = 'charge' THEN
      v_charge := fn_create_charge(
        p_tenant_id,
        jsonb_build_object(
          'customer_id',   v_customer,
          'rental_id',     v_rental,
          'due_date',      p_payable->>'due_date',
          -- Aponta para o registro que ORIGINOU a despesa (a manutenção, a
          -- multa), não para o payable: é o que torna a origem uniforme.
          'source_module', p_payable->>'source_module',
          'source_id',     COALESCE(v_source_id, v_payable),
          'created_by',    p_payable->>'created_by'
        ),
        jsonb_build_array(jsonb_build_object(
          'description',         p_payable->>'description',
          'credit_account_code', v_repasse,
          'quantity',            1,
          'unit_amount',         v_customer_a,
          'amount',              v_customer_a,
          'vehicle_id',          v_vehicle
        ))
      );
      v_result := v_result || jsonb_build_object('charge_id', v_charge->>'charge_id');

    ELSIF v_reimb = 'credit' THEN
      -- Cliente adiantou serviço que cabia à empresa: vira dívida com ele.
      INSERT INTO customer_credits (tenant_id, customer_id, amount, origin, reason, payable_id, created_by)
      VALUES (p_tenant_id, v_customer, v_customer_a, p_payable->>'source_module',
              p_payable->>'description', v_payable, NULLIF(p_payable->>'created_by', '')::UUID)
      RETURNING id INTO v_credit;

      PERFORM post_financial_transaction(
        p_tenant_id,
        jsonb_build_object(
          'event_type',    'credit_granted',
          'description',   'Crédito ao cliente — ' || (p_payable->>'description'),
          'source_module', 'customer_credit',
          'source_id',     v_credit,
          'created_by',    NULLIF(p_payable->>'created_by', '')::UUID
        ),
        jsonb_build_array(
          jsonb_build_object('account_code', v_expense, 'direction', 'debit', 'amount', v_customer_a,
                             'customer_id', v_customer, 'vehicle_id', v_vehicle,
                             'rental_id', v_rental, 'payable_id', v_payable),
          jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'credit', 'amount', v_customer_a,
                             'customer_id', v_customer, 'vehicle_id', v_vehicle,
                             'rental_id', v_rental, 'payable_id', v_payable)
        )
      );
      v_result := v_result || jsonb_build_object('credit_id', v_credit);
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION fn_create_payable IS
  'Cria a conta a pagar, o lançamento do custo e a recuperação do cliente numa transação só.';

REVOKE ALL ON FUNCTION fn_create_payable(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_create_payable(UUID, JSONB) TO authenticated, service_role;
