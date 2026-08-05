-- Adiciona colunas de documentos à tabela expenses.
-- invoice_url: URL da nota fiscal no Storage (bucket expense-files).
-- attachment_url: URL de arquivo adicional opcional (comprovante, recibo, etc.).

ALTER TABLE expenses
    ADD COLUMN invoice_url    TEXT,
    ADD COLUMN attachment_url TEXT;

-- Atualiza vehicle_financial_events para incluir attachment_url real de expenses
-- (antes era NULL::TEXT — a coluna não existia ainda).
CREATE OR REPLACE VIEW vehicle_financial_events
WITH (security_invoker = true) AS
SELECT
    o.id                                                         AS event_id,
    o.tenant_id,
    o.vehicle_id,
    'obligation'::TEXT                                           AS source,
    o.type::TEXT                                                 AS subtype,
    COALESCE(o.description, o.type || ' ' || o.reference_year)  AS description,
    o.amount,
    o.due_date                                                   AS event_date,
    o.paid_at,
    o.status::TEXT                                               AS status,
    o.receipt_url                                                AS attachment_url
FROM vehicle_obligations o
UNION ALL
SELECT
    mt.id, mt.tenant_id, mt.vehicle_id,
    'maintenance'::TEXT, mt.type::TEXT, mt.description,
    mt.cost,
    COALESCE(mt.completed_date, mt.scheduled_date),
    mt.completed_date,
    CASE WHEN mt.completed THEN 'paid' ELSE 'pending' END,
    mt.invoice_photo_url
FROM maintenances mt
WHERE mt.cost IS NOT NULL
UNION ALL
SELECT
    f.id, f.tenant_id, f.vehicle_id,
    'fine'::TEXT, f.responsible::TEXT, f.description,
    f.amount, f.infraction_date, f.payment_date, f.status::TEXT, f.ticket_url
FROM fines f
UNION ALL
SELECT
    e.id, e.tenant_id, e.vehicle_id,
    'expense'::TEXT, e.category::TEXT, e.description,
    e.amount, e.date, e.paid_at, e.payment_status::TEXT,
    e.attachment_url
FROM expenses e
WHERE e.vehicle_id IS NOT NULL;

COMMENT ON VIEW vehicle_financial_events IS
  'Spec 0007: linha por evento financeiro do veículo (renomeado de motorcycle_financial_events). security_invoker=true garante isolamento de tenant via RLS das tabelas base.';
