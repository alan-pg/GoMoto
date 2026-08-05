-- ============================================================
-- PRD 0003 — Refactor R1: simplificação do plano de manutenção
-- ============================================================
-- Drop das colunas `category` e `type` em maintenance_plan_items.
--
-- Motivação (decisão revisada do ADR 0006):
--   - Toda manutenção do plano é preventiva por contrato — o `type`
--     era ruído de UI sem usar valor diferente de 'preventive'.
--   - `category` existia para alimentar regras contratuais por categoria
--     (D3 do ADR 0006). Essa estratégia foi adiada para um PRD futuro
--     dedicado a "regras de responsabilidade". No V1, quem paga cada
--     manutenção é decidido pelo operador no momento (criar / executar /
--     dar baixa) — sem regra automática, sem dependência de categoria.
--
-- O CHECK constraint cai junto com as colunas. `is_critical` é mantida
-- (reservada para PRD futuro de bloqueio por crítica vencida).
-- ============================================================

ALTER TABLE maintenance_plan_items
    DROP COLUMN category,
    DROP COLUMN type;
