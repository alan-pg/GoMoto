-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 15/17: remoção do domínio financeiro legado.
--
-- A PARTIR DAQUI o app não sobe até as telas serem migradas: 54 arquivos em
-- apps/ e packages/ referenciam estas tabelas. É a janela de app quebrado
-- aceita conscientemente na ADR 0024.
--
-- Sem dados em produção, nada a migrar — só remover.

-- ---------------------------------------------------------------------------
-- Funções que dependiam do modelo antigo
-- ---------------------------------------------------------------------------
-- As RPCs de locação são recriadas na migration 17 sobre o cronograma.

DROP FUNCTION IF EXISTS create_rental_with_charges(uuid, jsonb, jsonb)  CASCADE;
DROP FUNCTION IF EXISTS create_rental_with_charges                      CASCADE;
DROP FUNCTION IF EXISTS regenerate_rental_schedule                      CASCADE;
DROP FUNCTION IF EXISTS adjust_rental                                   CASCADE;
DROP FUNCTION IF EXISTS renew_rental                                    CASCADE;
DROP FUNCTION IF EXISTS terminate_rental                                CASCADE;

-- F-06: aplicava um único crédito, sobrescrevia o acumulado em vez de somar e
-- engolia qualquer falha com EXCEPTION WHEN OTHERS. Vira applyCredits() puro
-- em @gomoto/core, chamado pela Server Action.
DROP FUNCTION IF EXISTS fn_auto_apply_credit CASCADE;

-- F-04 / ADR 0014: contava WHERE status='overdue', valor que nada no sistema
-- gravava. Substituída pela view customer_delinquency + classifyDelinquency().
DROP FUNCTION IF EXISTS fn_recalculate_delinquency CASCADE;

-- ---------------------------------------------------------------------------
-- Views legadas
-- ---------------------------------------------------------------------------

-- F-01: cruzava 4 LEFT JOIN irmãos e somava, inflando toda agregação pela
-- cardinalidade das outras tabelas (erro medido de 5×).
DROP VIEW IF EXISTS vehicle_cost_summary     CASCADE;

-- Ledger simulado em SQL — o sintoma que motivou todo o redesenho.
DROP VIEW IF EXISTS vehicle_financial_events CASCADE;

-- ---------------------------------------------------------------------------
-- Tabelas legadas
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS late_charges CASCADE;   -- snapshot único que envelhecia (R-06)
DROP TABLE IF EXISTS expenses     CASCADE;   -- → payables, com responsabilidade (F-07)
DROP TABLE IF EXISTS billings     CASCADE;   -- → charges + charge_items

-- ---------------------------------------------------------------------------
-- Enums órfãos
-- ---------------------------------------------------------------------------
-- Só agora podem cair: até aqui as tabelas legadas os referenciavam.

DROP TYPE IF EXISTS billing_source;          -- concorria com billing_type (F-11)
DROP TYPE IF EXISTS billing_pix_status;
DROP TYPE IF EXISTS deposit_movement_type;
DROP TYPE IF EXISTS deposit_status;
DROP TYPE IF EXISTS credit_origin;

-- delinquency_level ainda é usado por customers.delinquency_status, que só cai
-- na migration 16.
