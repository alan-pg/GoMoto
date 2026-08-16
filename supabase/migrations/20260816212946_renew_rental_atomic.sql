-- ---------------------------------------------------------------------------
-- Renovação vira uma transação só
-- ---------------------------------------------------------------------------
-- `renewRental` fazia duas escritas soltas: INSERT das novas linhas de
-- cronograma e UPDATE de `rentals.end_date`. Entre as duas não havia nada.
--
-- A falha do INSERT é inofensiva — a action retorna antes do UPDATE e o
-- contrato fica como estava. A do UPDATE não: as linhas já entraram, e o plano
-- passa a se estender além do fim do contrato. Ninguém percebe na hora, porque
-- linha `scheduled` não aparece em lugar nenhum até o job de emissão chegar
-- nela — aí a locação encerrada em novembro emite cobrança em janeiro.
--
-- `create_rental_with_schedule` já resolvia isso na criação; a renovação ficou
-- de fora. Mesma garantia, mesma forma.
--
-- SECURITY INVOKER de propósito: as políticas RLS de `rentals` e
-- `rental_billing_schedules` continuam valendo para quem chama. O tenant vem
-- resolvido server-side pela action e é conferido aqui de novo.

CREATE OR REPLACE FUNCTION fn_renew_rental(
  p_tenant_id   UUID,
  p_rental_id   UUID,
  p_new_end     DATE,
  p_lines       JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted INT := 0;
  v_current  DATE;
BEGIN
  SELECT end_date INTO v_current
  FROM rentals
  WHERE id = p_rental_id AND tenant_id = p_tenant_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENTAL_NOT_FOUND';
  END IF;

  -- Renovar é ESTENDER. Encurtar por aqui apagaria período já planejado sem
  -- dizer o que fazer com o que estivesse emitido dentro dele — isso é
  -- encerramento, que tem tela própria.
  IF v_current IS NOT NULL AND p_new_end <= v_current THEN
    RAISE EXCEPTION 'RENEWAL_NOT_AN_EXTENSION';
  END IF;

  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) > 0 THEN
    INSERT INTO rental_billing_schedules (
      tenant_id, rental_id, sequence_number, period_start, period_end, due_date, amount
    )
    SELECT
      p_tenant_id,
      p_rental_id,
      (item->>'sequence_number')::int,
      (item->>'period_start')::date,
      (item->>'period_end')::date,
      (item->>'due_date')::date,
      (item->>'amount')::numeric
    FROM jsonb_array_elements(p_lines) AS item;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  UPDATE rentals SET end_date = p_new_end
  WHERE id = p_rental_id AND tenant_id = p_tenant_id;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION fn_renew_rental IS
  'Estende a locação e acrescenta as linhas de cronograma numa transação só. Recusa data que não estenda — encurtar contrato é encerramento, não renovação.';

REVOKE EXECUTE ON FUNCTION fn_renew_rental(UUID, UUID, DATE, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_renew_rental(UUID, UUID, DATE, JSONB) TO authenticated;
