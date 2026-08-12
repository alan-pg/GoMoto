-- ============================================================
-- PRD 0013 — remove infraction_code (artigo do CTB, ex.: "218-II")
-- ============================================================
-- Campo nunca foi extraível pela IA (nenhum dos documentos oficiais reais
-- analisados — NA/NP — traz o artigo do CTB, só o código numérico SENATRAN,
-- já coberto por `senatran_infraction_code`) e ficou órfão depois que o
-- preenchimento rápido "Infrações comuns" (única fonte que o preenchia) foi
-- removido. Substituído por `senatran_infraction_code`, que É o código
-- impresso no documento e É extraído automaticamente.
--
-- Pré-checagem necessária antes de aplicar em produção:
--   SELECT count(*) FROM fines WHERE infraction_code IS NOT NULL;
-- No ambiente local (limpo, sem seed de fines), a contagem é 0.
-- ============================================================

ALTER TABLE fines DROP COLUMN IF EXISTS infraction_code;
