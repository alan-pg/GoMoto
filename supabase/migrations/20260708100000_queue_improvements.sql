-- ============================================================
-- Melhorias na fila de espera
-- 1. Normaliza posições (remove gaps e duplicatas)
-- 2. Adiciona constraint UNIQUE (tenant_id, position) deferível
-- 3. RPC add_to_queue       — insert atômico sem race condition
-- 4. RPC swap_queue_positions — swap atômico de posições
-- ============================================================

-- 1. Normaliza posições existentes por tenant (remove gaps/duplicatas)
DO $$
DECLARE
  t UUID;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM queue_entries WHERE status = 'waiting' LOOP
    WITH numbered AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY position, created_at) AS new_pos
      FROM queue_entries
      WHERE tenant_id = t AND status = 'waiting'
    )
    UPDATE queue_entries q
    SET position = n.new_pos
    FROM numbered n
    WHERE q.id = n.id;
  END LOOP;
END;
$$;

-- 2. UNIQUE deferível: permite swap de posições dentro de uma transação
ALTER TABLE queue_entries
  ADD CONSTRAINT uq_queue_entries_tenant_position
  UNIQUE (tenant_id, position) DEFERRABLE INITIALLY DEFERRED;

-- 3. Insere atomicamente na fila com MAX(position)+1 por tenant
CREATE OR REPLACE FUNCTION add_to_queue(
  p_tenant_id   UUID,
  p_customer_id UUID
)
RETURNS queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry queue_entries;
BEGIN
  INSERT INTO queue_entries (tenant_id, customer_id, position, status)
  SELECT
    p_tenant_id,
    p_customer_id,
    COALESCE(MAX(position), 0) + 1,
    'waiting'
  FROM queue_entries
  WHERE tenant_id = p_tenant_id AND status = 'waiting'
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

-- 4. Troca posições de dois elementos adjacentes na fila
--    p_direction: 'up' (entry_id sobe, vizinho desce) ou 'down'
--    p_note_up / p_note_down: anotações de auditoria registradas nos registros
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
    RETURN; -- já está na borda, não faz nada
  END IF;

  -- Troca posições (constraint deferível permite violar temporariamente)
  UPDATE queue_entries SET position = v_pos_b, notes = p_note_up
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;

  UPDATE queue_entries SET position = v_pos_a, notes = p_note_down
  WHERE id = v_other_id AND tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_to_queue(UUID, UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION swap_queue_positions(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;
