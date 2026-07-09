-- A constraint UNIQUE em (tenant_id, position) abrange todas as linhas,
-- o que impede re-adicionar um cliente que já foi convertido (pois a linha
-- antiga com status='converted' ainda ocupa a posição).
-- Posições só precisam ser únicas entre entradas em espera (status='waiting').

ALTER TABLE queue_entries
  DROP CONSTRAINT IF EXISTS uq_queue_entries_tenant_position;

CREATE UNIQUE INDEX uq_queue_entries_tenant_position_waiting
  ON queue_entries (tenant_id, position)
  WHERE status = 'waiting';
