-- ============================================================
-- PRD 0002 — F1: views consolidadas de TCO e eventos financeiros
-- ============================================================
-- Decisão D1: gastos NÃO são duplicados em expenses. Cada categoria vive
-- na sua tabela própria; estas views são o ponto único de consolidação
-- para listagem, filtros e relatórios.
--
-- Roda DEPOIS das migrations que adicionam:
--   - vehicle_obligations              (motorcycle_documentation.sql)
--   - fines.motorcycle_id NOT NULL     (fines_extend.sql)
--   - expenses.payment_status/paid_at  (expenses_payment_status.sql)
-- ============================================================

-- ============================================================
-- View 1: agregados por moto (TCO).
-- Usada na listagem de Motos e na aba "Custo total" do detalhe.
-- ============================================================
CREATE OR REPLACE VIEW motorcycle_cost_summary AS
SELECT
    m.id                                                                                              AS motorcycle_id,
    m.tenant_id,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0)                                       AS obligations_paid,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('pending', 'overdue')), 0)                      AS obligations_due,
    COALESCE(SUM(mt.cost)  FILTER (WHERE mt.completed = true), 0)                                     AS maintenance_cost,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'company' AND f.status = 'paid'), 0)         AS fines_company_paid,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'customer' AND f.status = 'paid'), 0)        AS fines_customer_paid,
    COALESCE(SUM(e.amount) FILTER (WHERE e.payment_status = 'paid'), 0)                               AS expenses_paid
FROM motorcycles m
LEFT JOIN vehicle_obligations o ON o.motorcycle_id = m.id
LEFT JOIN maintenances        mt ON mt.motorcycle_id = m.id
LEFT JOIN fines               f  ON f.motorcycle_id = m.id
LEFT JOIN expenses            e  ON e.motorcycle_id = m.id
GROUP BY m.id, m.tenant_id;

COMMENT ON VIEW motorcycle_cost_summary IS
    'PRD 0002: agregado de custo por moto. Não duplica lançamentos — cada parcela vem da sua tabela própria.';

-- ============================================================
-- View 2: linha por evento financeiro (cross-tipo).
-- Schema uniforme habilita a aba "Custo total" (lista filtrável) e
-- relatórios cross-frota.
--
-- Coluna `source` distingue origem:
--   - 'obligation'   → vehicle_obligations
--   - 'maintenance'  → maintenances (somente com cost informado)
--   - 'fine'         → fines
--   - 'expense'      → expenses (apenas as ligadas a uma moto)
--
-- Coluna `subtype` carrega a categoria dentro da fonte (ex: 'ipva',
-- 'preventive', 'customer', 'Combustível').
-- ============================================================
CREATE OR REPLACE VIEW motorcycle_financial_events AS
SELECT
    o.id                                                          AS event_id,
    o.tenant_id,
    o.motorcycle_id,
    'obligation'::TEXT                                            AS source,
    o.type::TEXT                                                  AS subtype,
    COALESCE(o.description, o.type || ' ' || o.reference_year)    AS description,
    o.amount,
    o.due_date                                                    AS event_date,
    o.paid_at,
    o.status::TEXT                                                AS status,
    o.receipt_url                                                 AS attachment_url
FROM vehicle_obligations o

UNION ALL

SELECT
    mt.id,
    mt.tenant_id,
    mt.motorcycle_id,
    'maintenance'::TEXT,
    mt.type::TEXT,
    mt.description,
    mt.cost,
    COALESCE(mt.completed_date, mt.scheduled_date),
    mt.completed_date,
    CASE WHEN mt.completed THEN 'paid' ELSE 'pending' END,
    mt.invoice_photo_url
FROM maintenances mt
WHERE mt.cost IS NOT NULL

UNION ALL

SELECT
    f.id,
    f.tenant_id,
    f.motorcycle_id,
    'fine'::TEXT,
    f.responsible::TEXT,
    f.description,
    f.amount,
    f.infraction_date,
    f.payment_date,
    f.status::TEXT,
    f.ticket_url
FROM fines f

UNION ALL

SELECT
    e.id,
    e.tenant_id,
    e.motorcycle_id,
    'expense'::TEXT,
    e.category::TEXT,
    e.description,
    e.amount,
    e.date,
    e.paid_at,
    e.payment_status::TEXT,
    NULL::TEXT          AS attachment_url -- expenses ainda não tem coluna de anexo no schema
FROM expenses e
WHERE e.motorcycle_id IS NOT NULL;

COMMENT ON VIEW motorcycle_financial_events IS
    'PRD 0002: linha por evento financeiro do veículo (cross-tipo). Schema uniforme para listagens e relatórios.';
