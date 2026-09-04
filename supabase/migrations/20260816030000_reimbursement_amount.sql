-- ---------------------------------------------------------------------------
-- O valor REEMBOLSADO deixa de ser sempre a parte do cliente
-- ---------------------------------------------------------------------------
-- `fn_create_payable` usava `customer_amount` para duas coisas diferentes:
--
--   1. a RESPONSABILIDADE — quanto do custo cabe ao cliente, que é o que o
--      rateio grava e o DRE usa;
--   2. o valor da cobrança de repasse ou do crédito.
--
-- Elas coincidem quando a EMPRESA executou o serviço: ela pagou tudo e cobra do
-- cliente a parte dele. Quando o CLIENTE executou, não coincidem — ele pagou o
-- total e a empresa lhe deve a parte DELA.
--
-- O caso mais comum quebrava em silêncio: cliente leva a moto à oficina, paga
-- R$ 300 de um custo 100% da empresa. `customer_amount` é zero, então nenhum
-- reembolso nascia. A empresa registrava a despesa e o cliente ficava no
-- prejuízo — exatamente a única situação em que o produto concede crédito.
--
-- `reimbursement_amount` passa a ser explícito. Ausente, cai em
-- `customer_amount` e o comportamento antigo é preservado para todo chamador
-- que ainda não distingue os dois.

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
  -- Quanto muda de mão entre empresa e cliente. Sem valor explícito, é a parte
  -- do cliente — o caso "empresa executou e cobra o rateio".
  v_reimb_a    NUMERIC(14,2) := COALESCE(
                  (p_payable->>'reimbursement_amount')::NUMERIC,
                  COALESCE((p_payable->>'customer_amount')::NUMERIC, 0));
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
  IF v_reimb_a < 0 OR v_reimb_a > v_amount THEN
    RAISE EXCEPTION 'Valor a reembolsar (%) fora do intervalo do total (%)', v_reimb_a, v_amount;
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
    (CASE WHEN v_reimb_a = 0 THEN 'none' ELSE v_reimb END)::reimbursement_mode,
    v_vehicle, v_rental, NULLIF(p_payable->>'vendor_name', ''),
    p_payable->>'source_module', v_source_id,
    NULLIF(p_payable->>'attachment_url', ''),
    NULLIF(p_payable->>'created_by', '')::UUID
  )
  RETURNING id INTO v_payable;

  -- Custo integral como despesa da empresa. A recuperação vive em documento
  -- separado, nunca abatida aqui dentro.
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

  IF v_reimb_a > 0 THEN
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

    ELSIF v_reimb = 'credit' THEN
      -- Cliente executou e desembolsou: a empresa lhe deve a parte dela.
      INSERT INTO customer_credits (tenant_id, customer_id, amount, origin, reason, payable_id, created_by)
      VALUES (p_tenant_id, v_customer, v_reimb_a, p_payable->>'source_module',
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
          -- Debita a despesa de novo? Não: o custo já entrou integral acima. O
          -- que nasce aqui é o PASSIVO com o cliente, contra a conta a pagar
          -- que ele quitou no lugar da empresa.
          jsonb_build_object('account_code', 'contas_a_pagar', 'direction', 'debit', 'amount', v_reimb_a,
                             'customer_id', v_customer, 'vehicle_id', v_vehicle,
                             'rental_id', v_rental, 'payable_id', v_payable),
          jsonb_build_object('account_code', 'creditos_de_clientes', 'direction', 'credit', 'amount', v_reimb_a,
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
  'Cria a conta a pagar, o lançamento do custo e a recuperação do cliente numa transação só. `reimbursement_amount` separa o valor que muda de mão da parte do cliente na responsabilidade.';
