-- ---------------------------------------------------------------------------
-- A baixa de despesa caía um dia antes no DRE
-- ---------------------------------------------------------------------------
-- `fn_pay_payable` recebe `p_paid_at` como DATE e gravava
-- `occurred_at = p_paid_at::timestamptz`. Esse cast produz meia-noite no
-- TimeZone da SESSÃO, que é UTC — e meia-noite UTC de 01/09 é 31/08 às 21h em
-- São Paulo.
--
-- Enquanto o DRE também agrupava em UTC, os dois erros se cancelavam. Desde que
-- ele passou a competir no fuso do tenant (migration `fuso_horario_por_tenant`),
-- a assimetria apareceu: baixa registrada em 01/09 com `paid_at = 2026-09-01`
-- lançava no razão como **31/08**. Na virada do mês, a saída de caixa muda de
-- exercício.
--
-- Reproduzido ao vivo: despesa paga pela tela em 01/09 gravou
-- `occurred_at = 2026-09-01 00:00+00`, e `fn_business_date` devolveu 2026-08-31.
--
-- A correção converte a data NO FUSO DO NEGÓCIO. `fn_business_instant` é a
-- irmã de `fn_business_date`: uma leva instante para data, a outra leva data
-- para instante, e as duas sabem que o fuso é do tenant.
--
-- Meio-dia, não meia-noite: é a convenção que o resto do produto já usa
-- (`RegistrarPagamentoModal` monta `T12:00:00`, as telas fazem
-- `new Date(dia + 'T12:00:00')`) e sobrevive a transições de horário de verão,
-- em que a meia-noite local pode não existir.

CREATE OR REPLACE FUNCTION fn_business_instant(p_date DATE, p_tenant_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT (p_date::timestamp + interval '12 hours')
           AT TIME ZONE fn_tenant_timezone(p_tenant_id);
$$;

COMMENT ON FUNCTION fn_business_instant IS
  'Leva uma DATA do negócio para um instante inequívoco naquele dia, no fuso do tenant. Inversa de fn_business_date: date::timestamptz cru vira meia-noite UTC e cai no dia anterior.';

GRANT EXECUTE ON FUNCTION fn_business_instant TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pay_payable(p_tenant_id uuid, p_payable_id uuid, p_paid_at date, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
      'occurred_at',   fn_business_instant(p_paid_at, p_tenant_id),
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
$function$

;
