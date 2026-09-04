-- ---------------------------------------------------------------------------
-- Baixa de despesa: dois cliques tiravam o dinheiro duas vezes
-- ---------------------------------------------------------------------------
-- `payPayable` seguia o padrão ler-decidir-escrever em passos soltos:
--
--     if (p.status === 'paid') throw ...              -- lê e decide
--     await supabase.from('payables').update(...)     -- escreve o status
--     await postTransaction(...)                      -- escreve o razão
--
-- Nada trava a linha entre a leitura e a escrita. Duas execuções simultâneas
-- leem `open` antes de qualquer uma gravar, as duas passam pelo guarda e as
-- duas lançam: o caixa sai duas vezes pela mesma conta. Reproduzido — duas
-- chamadas concorrentes para uma despesa de R$ 300 tiraram R$ 600 do caixa e
-- baixaram o passivo em dobro.
--
-- Não é hipótese de laboratório: dois cliques no botão, duas abas abertas, ou o
-- navegador reenviando a mesma requisição bastam.
--
-- E o mesmo trecho tinha o problema irmão: se o lançamento falhasse depois do
-- UPDATE, a despesa constava paga sem o razão ter visto o caixa sair.
--
-- Aqui os dois passos viram um, e o guarda passa a ser verificado sob `FOR
-- UPDATE`: a segunda chamada espera a primeira terminar, relê o status já
-- gravado e é recusada. É a mesma correção de `fn_confirm_gateway_payment` e
-- `fn_reverse_payment` — quando dinheiro se move, quem decide é o banco.

CREATE OR REPLACE FUNCTION fn_pay_payable(
  p_tenant_id  UUID,
  p_payable_id UUID,
  p_paid_at    DATE,
  p_created_by UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_desc     TEXT;
  v_amount   NUMERIC;
  v_status   payable_status;
  v_customer UUID;
  v_vehicle  UUID;
  v_rental   UUID;
BEGIN
  -- A trava é o ponto inteiro desta função: sem ela o status lido aqui pode
  -- estar obsoleto no instante seguinte.
  SELECT description, amount, status, customer_id, vehicle_id, rental_id
    INTO v_desc, v_amount, v_status, v_customer, v_vehicle, v_rental
    FROM payables
   WHERE id = p_payable_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYABLE_NOT_FOUND';
  END IF;
  IF v_status = 'paid' THEN
    RAISE EXCEPTION 'PAYABLE_ALREADY_PAID';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYABLE_CANCELLED';
  END IF;

  UPDATE payables
     SET status = 'paid', paid_at = p_paid_at
   WHERE id = p_payable_id AND tenant_id = p_tenant_id;

  -- Dimensões preservadas: sem elas o custo continua no total e some do
  -- resultado do veículo e do cliente.
  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'payable_paid',
      'description',   'Pagamento — ' || v_desc,
      'occurred_at',   p_paid_at::timestamptz,
      'source_module', 'payable',
      'source_id',     p_payable_id,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code', 'contas_a_pagar', 'direction', 'debit',
                         'amount', v_amount, 'customer_id', v_customer,
                         'vehicle_id', v_vehicle, 'rental_id', v_rental,
                         'payable_id', p_payable_id),
      jsonb_build_object('account_code', 'caixa_e_bancos', 'direction', 'credit',
                         'amount', v_amount, 'customer_id', v_customer,
                         'vehicle_id', v_vehicle, 'rental_id', v_rental,
                         'payable_id', p_payable_id)
    )
  );
END;
$$;

COMMENT ON FUNCTION fn_pay_payable IS
  'Baixa a conta a pagar e lança caixa/passivo numa transação, com o status verificado sob FOR UPDATE. Duas baixas simultâneas não tiram o dinheiro duas vezes.';

GRANT EXECUTE ON FUNCTION fn_pay_payable TO authenticated, service_role;
