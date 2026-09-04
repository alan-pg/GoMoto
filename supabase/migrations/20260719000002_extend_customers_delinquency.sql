-- Módulo Financeiro (Spec 0008) — Passo 2: status de inadimplência em customers
-- RF-033: coluna materializada atualizada por trigger (ADR 0014).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS delinquency_status delinquency_level NOT NULL DEFAULT 'current';

CREATE INDEX IF NOT EXISTS idx_customers_tenant_delinquency
  ON customers(tenant_id, delinquency_status);
