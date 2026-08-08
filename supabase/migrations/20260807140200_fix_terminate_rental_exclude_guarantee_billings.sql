-- Spec 0010 RN-003 — terminate_rental cancelava qualquer cobrança pendente
-- com vencimento futuro sem filtrar por tipo. Isso incluía Entrada e Caução
-- pendentes, que deveriam sobreviver ao encerramento antecipado (garantias
-- não são "cobranças de ciclo" que perdem sentido quando a locação acaba).
CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_lease_id         UUID,
  p_termination_date DATE,
  p_new_status       TEXT DEFAULT 'closed'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id UUID;
BEGIN
  SELECT vehicle_id INTO v_vehicle_id
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active';

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Cancelar cobranças futuras pendentes — exceto garantias (RN-003 do PRD 0010:
  -- Entrada pendente sobrevive ao encerramento antecipado; Caução tinha o mesmo
  -- risco latente e foi corrigida junto).
  UPDATE billings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE lease_id     = p_lease_id
    AND tenant_id    = p_tenant_id
    AND due_date     > p_termination_date
    AND status       = 'pending'
    AND billing_type NOT IN ('deposit', 'down_payment');

  UPDATE rentals
  SET status     = p_new_status,
      end_date   = p_termination_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  UPDATE vehicles
  SET status     = 'available',
      updated_at = now()
  WHERE id = v_vehicle_id AND tenant_id = p_tenant_id;
END;
$$;
