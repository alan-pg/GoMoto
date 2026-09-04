-- ---------------------------------------------------------------------------
-- "Encargo por atraso (1 dias)"
-- ---------------------------------------------------------------------------
-- O plural estava cravado nos DOIS caminhos que realizam encargo: nesta função
-- e em `realizeLateCharge` (`lib/financial/charges.ts`). Com um dia de atraso,
-- o item saía "1 dias".
--
-- Não é cosmético: a descrição vai para `charge_items`, que é documento emitido
-- e imutável (ADR 0024, Princípio 5). O que já foi gravado assim continua
-- assim — e o cliente vê isso na cobrança dele.

CREATE OR REPLACE FUNCTION public.fn_realize_late_charge(p_tenant_id uuid, p_charge_id uuid, p_amount numeric, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_customer UUID;
  v_rental   UUID;
  v_vehicle  UUID;
  v_number   BIGINT;
  v_dias     INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  SELECT customer_id, rental_id, charge_number,
         GREATEST(0, fn_business_today(p_tenant_id) - due_date)
    INTO v_customer, v_rental, v_number, v_dias
    FROM charges
   WHERE id = p_charge_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  -- Mesma resolução do TS: veículo do item, senão o da locação. Sem a dimensão
  -- o encargo some do resultado da moto, que agrega por `vehicle_id`.
  SELECT vehicle_id INTO v_vehicle
    FROM charge_items
   WHERE charge_id = p_charge_id AND vehicle_id IS NOT NULL
   LIMIT 1;

  IF v_vehicle IS NULL AND v_rental IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle
      FROM rentals WHERE id = v_rental AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO charge_items (
    tenant_id, charge_id, description, credit_account_code,
    quantity, unit_amount, amount, vehicle_id, source_module, source_id
  ) VALUES (
    p_tenant_id, p_charge_id,
    'Encargo por atraso (' || v_dias || CASE WHEN v_dias = 1 THEN ' dia)' ELSE ' dias)' END,
    'receita_encargos_atraso',
    1, p_amount, p_amount, v_vehicle, 'late_charge', p_charge_id
  );

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'late_charge_realized',
      'description',   'Encargo realizado — cobrança #' || v_number,
      'source_module', 'late_charge',
      'source_id',     p_charge_id,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code','contas_a_receber','direction','debit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id),
      jsonb_build_object('account_code','receita_encargos_atraso','direction','credit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id)
    )
  );
END;
$function$

;
