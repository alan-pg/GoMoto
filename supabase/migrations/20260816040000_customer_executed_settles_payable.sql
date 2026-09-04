-- ---------------------------------------------------------------------------
-- Serviço executado pelo CLIENTE não passa por contas a pagar
-- ---------------------------------------------------------------------------
-- O modelo assumia que a EMPRESA sempre paga a oficina: todo payable creditava
-- `contas_a_pagar`. Quando quem leva a moto e paga é o cliente, esse passivo
-- nunca existiu — a empresa não deve nada a fornecedor nenhum.
--
-- O sintoma, num rateio de R$ 300 com R$ 100 do cliente executado por ele:
--
--   despesa_manutencao    débito  300
--   creditos_de_clientes  crédito 200
--   contas_a_pagar        +300 −200 = **+100 fantasma**
--
-- Faltava também reconhecer que os R$ 100 da parte dele reduzem o custo
-- líquido da empresa. O correto fecha em três pernas, sem contas a pagar:
--
--   despesa_manutencao    débito  300   (custo bruto, sempre visível)
--   repasse_manutencao    crédito 100   (parte do cliente, que ele bancou)
--   creditos_de_clientes  crédito 200   (o que a empresa deve a ele)
--
-- Custo bruto e recuperação continuam lado a lado (Princípio 7), e o resultado
-- líquido é a parte da empresa.
--
-- O documento nasce `paid`: ele registra o custo com veículo, origem e
-- responsabilidade, e a tela de Despesas o mostra quitado em vez de pendente
-- para sempre. Decisão do Alan, 2026-08-16.

-- A CHECK impedia parte do cliente sem reembolso. Passou a existir um caso
-- legítimo: o cliente executou e pagou exatamente o que devia, então nada muda
-- de mão. O que a regra precisa garantir é outra coisa — que reembolso só
-- exista quando há valor a reembolsar —, e isso a função já assegura.
ALTER TABLE payables DROP CONSTRAINT IF EXISTS payables_share_needs_reimbursement;

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
  v_due        DATE := (p_payable->>'due_date')::DATE;
  -- Reembolso por CRÉDITO só nasce quando o cliente executou e desembolsou.
  v_by_client  BOOLEAN := (v_reimb = 'credit' AND v_reimb_a > 0);
  v_repasse    TEXT;
  v_charge     JSONB;
  v_credit     UUID;
  v_dims       JSONB;
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
    (p_payable->>'competence_date')::DATE, v_due,
    v_amount, (p_payable->>'responsibility')::responsibility_type,
    v_customer, v_customer_a,
    (CASE WHEN v_reimb_a = 0 THEN 'none' ELSE v_reimb END)::reimbursement_mode,
    v_vehicle, v_rental, NULLIF(p_payable->>'vendor_name', ''),
    p_payable->>'source_module', v_source_id,
    NULLIF(p_payable->>'attachment_url', ''),
    NULLIF(p_payable->>'created_by', '')::UUID,
    -- Executado pelo cliente: a empresa nunca teve o que pagar.
    (CASE WHEN v_by_client THEN 'paid' ELSE 'open' END)::payable_status,
    (CASE WHEN v_by_client THEN v_due ELSE NULL END)
  )
  RETURNING id INTO v_payable;

  v_dims := jsonb_build_object(
    'customer_id', v_customer, 'vehicle_id', v_vehicle,
    'rental_id', v_rental, 'payable_id', v_payable
  );

  IF v_by_client THEN
    -- Três pernas, sem contas a pagar: custo bruto, a parte que o cliente
    -- bancou, e o que a empresa passa a dever a ele.
    INSERT INTO customer_credits (tenant_id, customer_id, amount, origin, reason, payable_id, created_by)
    VALUES (p_tenant_id, v_customer, v_reimb_a, p_payable->>'source_module',
            p_payable->>'description', v_payable, NULLIF(p_payable->>'created_by', '')::UUID)
    RETURNING id INTO v_credit;

    PERFORM post_financial_transaction(
      p_tenant_id,
      jsonb_build_object(
        'event_type',    'credit_granted',
        'description',   p_payable->>'description',
        'source_module', 'customer_credit',
        'source_id',     v_credit,
        'created_by',    NULLIF(p_payable->>'created_by', '')::UUID
      ),
      jsonb_build_array(
        v_dims || jsonb_build_object('account_code', v_expense, 'direction', 'debit', 'amount', v_amount)
      )
      -- A parte que coube ao cliente e que ele bancou: recuperação de despesa.
      || (CASE WHEN v_amount - v_reimb_a > 0
            THEN jsonb_build_array(v_dims || jsonb_build_object(
                   'account_code', v_repasse, 'direction', 'credit', 'amount', v_amount - v_reimb_a))
            ELSE '[]'::jsonb END)
      || jsonb_build_array(
        v_dims || jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'credit', 'amount', v_reimb_a)
      )
    );

    RETURN jsonb_build_object('payable_id', v_payable, 'credit_id', v_credit);
  END IF;

  -- Executado pela empresa: ela deve à oficina e recupera do cliente por
  -- cobrança, quando há parte dele.
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
  'Conta a pagar, custo e recuperação numa transação. Executado pelo cliente: nasce quitada e o razão não passa por contas_a_pagar — a empresa nunca deveu à oficina.';
