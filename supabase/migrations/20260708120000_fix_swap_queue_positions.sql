-- O índice único parcial não é deferível (diferente de uma CONSTRAINT deferível),
-- então a violação é checada após cada UPDATE — o swap de dois valores causa
-- conflito temporário no passo 1.
-- Solução: 3 passos usando posição -1 como estacionamento temporário.
-- Posições válidas sempre começam em 1, portanto -1 nunca conflita.

CREATE OR REPLACE FUNCTION swap_queue_positions(
  p_tenant_id   UUID,
  p_entry_id    UUID,
  p_direction   TEXT,
  p_note_up     TEXT DEFAULT 'Subiu na fila: Reordenação da fila',
  p_note_down   TEXT DEFAULT 'Desceu na fila: Reordenação da fila'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pos_a    INTEGER;
  v_other_id UUID;
  v_pos_b    INTEGER;
BEGIN
  SELECT position INTO v_pos_a
  FROM queue_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND status = 'waiting';

  IF v_pos_a IS NULL THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  IF p_direction = 'up' THEN
    SELECT id, position INTO v_other_id, v_pos_b
    FROM queue_entries
    WHERE tenant_id = p_tenant_id AND status = 'waiting' AND position < v_pos_a
    ORDER BY position DESC
    LIMIT 1;
  ELSE
    SELECT id, position INTO v_other_id, v_pos_b
    FROM queue_entries
    WHERE tenant_id = p_tenant_id AND status = 'waiting' AND position > v_pos_a
    ORDER BY position ASC
    LIMIT 1;
  END IF;

  IF v_other_id IS NULL THEN
    RETURN;
  END IF;

  -- Passo 1: estaciona p_entry_id em -1 (libera v_pos_a sem conflito)
  UPDATE queue_entries SET position = -1
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;

  -- Passo 2: move o vizinho para v_pos_a (agora livre)
  UPDATE queue_entries SET position = v_pos_a, notes = p_note_down
  WHERE id = v_other_id AND tenant_id = p_tenant_id;

  -- Passo 3: move p_entry_id do estacionamento para v_pos_b
  UPDATE queue_entries SET position = v_pos_b, notes = p_note_up
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION swap_queue_positions(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;
