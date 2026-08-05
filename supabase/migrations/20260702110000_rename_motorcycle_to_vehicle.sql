-- Spec 0007 — Generalização da Entidade Veículo (motorcycle → vehicle)
-- Migration transacional: rename em cascata de todas as camadas do banco.
-- Sem perda de dados — apenas renomeia tabela, colunas FK, constraints, índices,
-- triggers, policies e views. Inclui tabelas criadas na Spec 0006.

BEGIN;

-- ─── 1. Dropar views dependentes antes de renomear colunas ───────────────────

DROP VIEW IF EXISTS motorcycle_financial_events;
DROP VIEW IF EXISTS motorcycle_cost_summary;

-- ─── 2. Renomear tabela central ──────────────────────────────────────────────

ALTER TABLE motorcycles RENAME TO vehicles;

-- ─── 3. Renomear trigger de updated_at ──────────────────────────────────────

ALTER TRIGGER trg_motorcycles_updated_at ON vehicles
  RENAME TO trg_vehicles_updated_at;

-- ─── 4. Renomear colunas FK em todas as tabelas dependentes ─────────────────

ALTER TABLE rentals               RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE vehicle_documents     RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE vehicle_obligations   RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE maintenances          RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE fines                 RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE expenses              RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE checklists            RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE maintenance_records   RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE vehicle_status_history RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE vehicle_photos        RENAME COLUMN motorcycle_id TO vehicle_id;

-- ─── 5. Renomear constraints em vehicles ────────────────────────────────────

ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_tenant_license_plate_key TO vehicles_tenant_license_plate_key;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_tenant_renavam_key        TO vehicles_tenant_renavam_key;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_tenant_chassis_key        TO vehicles_tenant_chassis_key;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_acquisition_type_check    TO vehicles_acquisition_type_check;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_tracker_imei_format       TO vehicles_tracker_imei_format;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_tracker_fields_coherence  TO vehicles_tracker_fields_coherence;
ALTER TABLE vehicles RENAME CONSTRAINT motorcycles_insurance_fields_coherence TO vehicles_insurance_fields_coherence;

-- ─── 6. Renomear índices ─────────────────────────────────────────────────────

ALTER INDEX idx_motorcycles_tenant_id       RENAME TO idx_vehicles_tenant_id;
ALTER INDEX idx_motorcycles_tenant_status   RENAME TO idx_vehicles_tenant_status;
ALTER INDEX idx_motorcycles_tenant_created  RENAME TO idx_vehicles_tenant_created;
ALTER INDEX idx_vehicle_documents_motorcycle   RENAME TO idx_vehicle_documents_vehicle;
ALTER INDEX idx_vehicle_obligations_motorcycle RENAME TO idx_vehicle_obligations_vehicle;
ALTER INDEX idx_vsh_motorcycle              RENAME TO idx_vsh_vehicle;
ALTER INDEX idx_vehicle_photos_motorcycle   RENAME TO idx_vehicle_photos_vehicle;
ALTER INDEX idx_rentals_motorcycle          RENAME TO idx_rentals_vehicle;

-- ─── 7. Renomear RLS policies em vehicles ───────────────────────────────────

ALTER POLICY "tenant_isolation_motorcycles" ON vehicles
  RENAME TO "tenant_isolation_vehicles";

-- ─── 8. Recriar policies que referenciam colunas renomeadas ─────────────────

-- 8a. vehicles: cliente lê os veículos com os quais teve/tem locação
-- (era "customer_self_select_motorcycles" referenciando contracts.motorcycle_id;
--  agora referencia rentals.vehicle_id após os renames acima)
DROP POLICY IF EXISTS "customer_self_select_motorcycles" ON vehicles;

CREATE POLICY "customer_self_select_vehicles" ON vehicles
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT vehicle_id FROM rentals
      WHERE customer_id IN (SELECT current_customer_ids())
    )
  );

-- 8b. maintenances: cliente lê manutenções dos veículos que tem/teve em locação
-- (corpo da policy referenciava motorcycle_id; agora usa vehicle_id)
DROP POLICY IF EXISTS "customer_self_select_maintenances" ON maintenances;

CREATE POLICY "customer_self_select_maintenances" ON maintenances
  FOR SELECT TO authenticated
  USING (
    vehicle_id IN (
      SELECT vehicle_id FROM rentals
      WHERE customer_id IN (SELECT current_customer_ids())
    )
  );

-- ─── 9. Recriar view de TCO (vehicle_cost_summary) ──────────────────────────

CREATE OR REPLACE VIEW vehicle_cost_summary
WITH (security_invoker = true) AS
SELECT
    v.id                                                                                         AS vehicle_id,
    v.tenant_id,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0)                                  AS obligations_paid,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('pending', 'overdue')), 0)                 AS obligations_due,
    COALESCE(SUM(mt.cost)  FILTER (WHERE mt.completed = true), 0)                                AS maintenance_cost,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'company' AND f.status = 'paid'), 0)    AS fines_company_paid,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'customer' AND f.status = 'paid'), 0)   AS fines_customer_paid,
    COALESCE(SUM(e.amount) FILTER (WHERE e.payment_status = 'paid'), 0)                          AS expenses_paid
FROM vehicles v
LEFT JOIN vehicle_obligations o  ON o.vehicle_id = v.id
LEFT JOIN maintenances        mt ON mt.vehicle_id = v.id
LEFT JOIN fines               f  ON f.vehicle_id  = v.id
LEFT JOIN expenses            e  ON e.vehicle_id  = v.id
GROUP BY v.id, v.tenant_id;

COMMENT ON VIEW vehicle_cost_summary IS
  'Spec 0007: agregado de custo por veículo (renomeado de motorcycle_cost_summary). security_invoker=true garante isolamento de tenant via RLS das tabelas base.';

-- ─── 10. Recriar view de eventos financeiros (vehicle_financial_events) ──────

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
    NULL::TEXT AS attachment_url
FROM expenses e
WHERE e.vehicle_id IS NOT NULL;

COMMENT ON VIEW vehicle_financial_events IS
  'Spec 0007: linha por evento financeiro do veículo (renomeado de motorcycle_financial_events). security_invoker=true garante isolamento de tenant via RLS das tabelas base.';

-- ─── 11. Atualizar RPC create_rental_with_charges ────────────────────────────
-- DROP antes do CREATE OR REPLACE porque PostgreSQL não permite renomear parâmetros
-- (p_motorcycle_id → p_vehicle_id) via REPLACE. Os tipos são idênticos, então
-- não há risco de perder dependências — apenas o nome do parâmetro muda.
DROP FUNCTION IF EXISTS create_rental_with_charges(UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB);

CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id      UUID,
  p_vehicle_id     UUID,
  p_customer_id    UUID,
  p_cycle          TEXT,
  p_due_day        INTEGER,
  p_cycle_amount   NUMERIC,
  p_start_date     DATE,
  p_end_date       DATE,
  p_use_pro_rata   BOOLEAN,
  p_charges        JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id UUID;
BEGIN
  PERFORM id FROM rentals
  WHERE vehicle_id = p_vehicle_id
    AND status = 'active'
    AND tenant_id = p_tenant_id
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED';
  END IF;

  INSERT INTO rentals (
    tenant_id, vehicle_id, customer_id,
    cycle, due_day, cycle_amount, use_pro_rata,
    start_date, end_date, status
  ) VALUES (
    p_tenant_id, p_vehicle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active'
  ) RETURNING id INTO v_lease_id;

  INSERT INTO billings (tenant_id, lease_id, customer_id, original_amount, due_date, billing_type, status)
  SELECT
    p_tenant_id,
    v_lease_id,
    p_customer_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    COALESCE(c->>'billing_type', 'cycle'),
    'pending'
  FROM jsonb_array_elements(p_charges) AS c;

  RETURN v_lease_id;
END;
$$;

COMMIT;
