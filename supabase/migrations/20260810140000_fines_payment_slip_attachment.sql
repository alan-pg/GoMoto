-- ============================================================
-- PRD 0013 — troca o campo solto `ticket_url` (link de boleto/notificação)
-- por anexo de verdade: tipo `payment_slip` (boleto) no sistema já existente
-- de fine_attachments, com persistência real no Storage em vez de um link
-- externo digitado à mão.
-- ============================================================

-- `vehicle_financial_events` (20260729005152) usa f.ticket_url como attachment_url
-- da linha de multa — redefine antes de dropar a coluna. Não há mais "a" URL do
-- anexo de uma multa (múltiplos anexos em fine_attachments), então vira NULL;
-- view não é consumida em nenhuma tela hoje (só via packages/data/vehicleCosts.ts,
-- sem uso na UI), então não há regressão visível.
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
    f.amount, f.infraction_date, f.payment_date, f.status::TEXT, NULL::TEXT
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
  'Spec 0007/PRD 0013: linha por evento financeiro do veículo. attachment_url de multa é NULL desde que ticket_url saiu — anexos reais vivem em fine_attachments (múltiplos por multa). security_invoker=true garante isolamento de tenant via RLS das tabelas base.';

-- Pré-checagem necessária antes de aplicar em produção:
--   SELECT count(*) FROM fines WHERE ticket_url IS NOT NULL;
-- No ambiente local (limpo, sem seed de fines), a contagem é 0.
ALTER TABLE fines DROP COLUMN IF EXISTS ticket_url;

ALTER TABLE fine_attachments DROP CONSTRAINT IF EXISTS fine_attachments_type_check;
ALTER TABLE fine_attachments ADD CONSTRAINT fine_attachments_type_check
    CHECK (type IN (
        'ait',
        'nip',
        'payment_slip',
        'payment_receipt',
        'appeal',
        'appeal_decision',
        'driver_indication',
        'other'
    ));
