-- Módulo Financeiro (Spec 0008) — Passo 11: campos financeiros em vehicles
-- RF-041: valor de aquisição para cálculo de ROI.
-- RF-043: alienação do veículo (valor e data de venda).
-- purchase_date já existe desde o schema inicial.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS acquisition_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sold_at           DATE,
  ADD COLUMN IF NOT EXISTS sale_value        NUMERIC(10,2);
