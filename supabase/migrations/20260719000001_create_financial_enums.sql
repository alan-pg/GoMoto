-- Módulo Financeiro (Spec 0008) — Passo 1: ENUMs
-- Cria os 8 tipos enumerados usados pelas tabelas financeiras.

CREATE TYPE payment_method_type  AS ENUM ('pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other');
CREATE TYPE late_fee_type         AS ENUM ('fixed', 'percentage');
CREATE TYPE billing_source        AS ENUM ('rental_cycle', 'maintenance', 'fine', 'expense', 'manual');
CREATE TYPE deposit_status        AS ENUM ('received', 'fully_returned', 'partially_returned', 'fully_retained');
CREATE TYPE deposit_movement_type AS ENUM ('return', 'retention');
CREATE TYPE credit_origin         AS ENUM ('maintenance_refund', 'reversal', 'manual_adjustment');
CREATE TYPE delinquency_level     AS ENUM ('current', 'late', 'delinquent', 'blocked');
CREATE TYPE block_action          AS ENUM ('block', 'unblock');
