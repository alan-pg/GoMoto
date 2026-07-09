-- Após deletar qualquer entrada da fila, renumera sequencialmente as
-- entradas restantes (waiting) do mesmo tenant para fechar gaps.

CREATE OR REPLACE FUNCTION reorder_queue_positions_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.status = 'waiting' THEN
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY position) AS new_pos
      FROM queue_entries
      WHERE tenant_id = OLD.tenant_id AND status = 'waiting'
    )
    UPDATE queue_entries q
    SET position = r.new_pos
    FROM ranked r
    WHERE q.id = r.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_reorder_queue_after_delete
AFTER DELETE ON queue_entries
FOR EACH ROW
EXECUTE FUNCTION reorder_queue_positions_after_delete();
