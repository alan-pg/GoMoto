-- ---------------------------------------------------------------------------
-- Quem pagou a oficina vira um FATO, não uma dedução do modo de reembolso
-- ---------------------------------------------------------------------------
-- `fn_create_payable` decidia se o cliente havia desembolsado olhando para
-- `reimbursement = 'credit'`. Isso funciona enquanto sobra algo a devolver, e
-- some exatamente quando não sobra.
--
-- O caso que quebrava: manutenção 100% do cliente que ELE mesmo levou à oficina
-- e pagou. Nada muda de mão, então o modo é 'none' — e a função caía no ramo
-- "a empresa deve à oficina":
--
--   despesa_manutencao  débito  300   ← despesa que a empresa não teve
--   contas_a_pagar      crédito 300   ← dívida com uma oficina que já foi paga
--
-- A conta nascia `open` e ficava aberta para sempre. Pior: entrava no "Em
-- aberto — parte da empresa" da tela de Despesas com a coluna Empresa em
-- R$ 0,00 na mesma linha, um número se contradizendo ao lado do outro.
--
-- `paid_by` passa a ser explícito. Ausente, é 'company' — todo chamador antigo
-- se comporta como antes. Com 'customer', o razão fecha em duas ou três pernas
-- sem passar por contas a pagar:
--
--   despesa_manutencao    débito  300   (custo bruto, sempre visível)
--   repasse_manutencao    crédito 300   (o que o cliente bancou em definitivo)
--   creditos_de_clientes  crédito   0   (nada a devolver — perna omitida)
--
-- Custo bruto continua visível no resultado do veículo (Princípio 7) e o
-- resultado líquido da empresa é zero, que é a verdade.

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
  v_reimb_a    NUMERIC(14,2) := COALESCE(
                  (p_payable->>'reimbursement_amount')::NUMERIC,
                  COALESCE((p_payable->>'customer_amount')::NUMERIC, 0));
  v_expense    TEXT := p_payable->>'expense_account_code';
  v_customer   UUID := NULLIF(p_payable->>'customer_id', '')::UUID;
  v_vehicle    UUID := NULLIF(p_payable->>'vehicle_id', '')::UUID;
  v_rental     UUID := NULLIF(p_payable->>'rental_id', '')::UUID;
  v_source_id  UUID := NULLIF(p_payable->>'source_id', '')::UUID;
  v_reimb      TEXT := COALESCE(p_payable->>'reimbursement', 'charge');
  -- O fato: quem entregou o dinheiro ao fornecedor. `reimbursement = 'credit'`
  -- segue aceito para não quebrar chamador que ainda não informa `paid_by`.
  v_by_client  BOOLEAN := (
                  COALESCE(p_payable->>'paid_by', 'company') = 'customer'
                  OR (v_reimb = 'credit' AND v_reimb_a > 0)
                );
  v_repasse    TEXT;
  v_charge     JSONB;
  v_credit     UUID;
  v_dims       JSONB;
  v_legs       JSONB;
  v_result     JSONB;
BEGIN
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Conta a pagar precisa ter valor maior que zero';
  END IF;
  IF v_customer_a < 0 OR v_customer_a > v_amount THEN
    RAISE EXCEPTION 'Parte do cliente (%) fora do intervalo do total (%)', v_customer_a, v_amount;
  END IF;
  IF v_reimb_a < 0 OR v_reimb_a > v_amount THEN
    RAISE EXCEPTION 'Valor a reembolsar (%) fora do intervalo do total (%)', v_reimb_a, v_amount;
  END IF;
  IF v_by_client AND v_customer IS NULL THEN
    RAISE EXCEPTION 'Despesa paga pelo cliente exige o cliente identificado';
  END IF;

  v_repasse := CASE v_expense
    WHEN 'despesa_manutencao' THEN 'repasse_manutencao'
    WHEN 'despesa_multa'      THEN 'repasse_multa'
    ELSE 'repasse_operacional'
  END;

  INSERT INTO payables (
    tenant_id, description, expense_account_code, competence_date, due_date,
    amount, responsibility, customer_id, customer_amount, reimbursement,
    vehicle_id, rental_id, vendor_name, source_module, source_id,
    attachment_url, created_by, status, paid_at
  )
  VALUES (
    p_tenant_id, p_payable->>'description', v_expense,
    (p_payable->>'competence_date')::DATE, (p_payable->>'due_date')::DATE,
    v_amount, (p_payable->>'responsibility')::responsibility_type,
    v_customer, v_customer_a,
    (CASE WHEN v_reimb_a = 0 THEN 'none' ELSE v_reimb END)::reimbursement_mode,
    v_vehicle, v_rental, NULLIF(p_payable->>'vendor_name', ''),
    p_payable->>'source_module', v_source_id,
    NULLIF(p_payable->>'attachment_url', ''),
    NULLIF(p_payable->>'created_by', '')::UUID,
    -- Pago pelo cliente: a empresa nunca teve o que pagar.
    (CASE WHEN v_by_client THEN 'paid' ELSE 'open' END)::payable_status,
    (CASE WHEN v_by_client THEN (p_payable->>'due_date')::DATE ELSE NULL END)
  )
  RETURNING id INTO v_payable;

  v_dims := jsonb_build_object(
    'customer_id', v_customer, 'vehicle_id', v_vehicle,
    'rental_id', v_rental, 'payable_id', v_payable
  );

  IF v_by_client THEN
    -- Crédito só nasce quando há de fato o que devolver. Antes a perna e a
    -- linha em `customer_credits` saíam incondicionais, e com reembolso zero
    -- isso violava `financial_entries_amount_check` (amount > 0).
    IF v_reimb_a > 0 THEN
      INSERT INTO customer_credits (tenant_id, customer_id, amount, origin, reason, payable_id, created_by)
      VALUES (p_tenant_id, v_customer, v_reimb_a, p_payable->>'source_module',
              p_payable->>'description', v_payable, NULLIF(p_payable->>'created_by', '')::UUID)
      RETURNING id INTO v_credit;
    END IF;

    v_legs := jsonb_build_array(
      v_dims || jsonb_build_object('account_code', v_expense, 'direction', 'debit', 'amount', v_amount)
    );

    -- A parte que o cliente bancou em definitivo: recuperação de despesa.
    IF v_amount - v_reimb_a > 0 THEN
      v_legs := v_legs || jsonb_build_array(
        v_dims || jsonb_build_object('account_code', v_repasse, 'direction', 'credit',
                                     'amount', v_amount - v_reimb_a));
    END IF;

    -- O que a empresa passa a dever a ele.
    IF v_reimb_a > 0 THEN
      v_legs := v_legs || jsonb_build_array(
        v_dims || jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'credit',
                                     'amount', v_reimb_a));
    END IF;

    PERFORM post_financial_transaction(
      p_tenant_id,
      jsonb_build_object(
        'event_type',    (CASE WHEN v_credit IS NULL THEN 'payable_created' ELSE 'credit_granted' END),
        'description',   p_payable->>'description',
        'source_module', (CASE WHEN v_credit IS NULL
                            THEN p_payable->>'source_module' ELSE 'customer_credit' END),
        'source_id',     COALESCE(v_credit, v_source_id, v_payable),
        'created_by',    NULLIF(p_payable->>'created_by', '')::UUID
      ),
      v_legs
    );

    RETURN jsonb_build_object('payable_id', v_payable, 'credit_id', v_credit);
  END IF;

  -- Pago pela empresa: ela deve à oficina e recupera do cliente por cobrança,
  -- quando há parte dele.
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
      v_dims || jsonb_build_object('account_code', v_expense, 'direction', 'debit', 'amount', v_amount),
      v_dims || jsonb_build_object('account_code', 'contas_a_pagar', 'direction', 'credit', 'amount', v_amount)
    )
  );

  v_result := jsonb_build_object('payable_id', v_payable);

  IF v_reimb_a > 0 THEN
    v_charge := fn_create_charge(
      p_tenant_id,
      jsonb_build_object(
        'customer_id',   v_customer,
        'rental_id',     v_rental,
        'due_date',      p_payable->>'due_date',
        'source_module', p_payable->>'source_module',
        'source_id',     COALESCE(v_source_id, v_payable),
        'created_by',    p_payable->>'created_by'
      ),
      jsonb_build_array(jsonb_build_object(
        'description',         p_payable->>'description',
        'credit_account_code', v_repasse,
        'quantity',            1,
        'unit_amount',         v_reimb_a,
        'amount',              v_reimb_a,
        'vehicle_id',          v_vehicle
      ))
    );
    v_result := v_result || jsonb_build_object('charge_id', v_charge->>'charge_id');
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION fn_create_payable IS
  'Conta a pagar, custo e recuperação numa transação. `paid_by` diz quem pagou o fornecedor: com ''customer'' a conta nasce quitada e o razão não passa por contas_a_pagar — a empresa nunca deveu à oficina.';
