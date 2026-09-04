-- ============================================================
-- PRD 0013 — Responsável pelo pagamento vira obrigatório
-- ============================================================
-- Campo determina se a multa gera cobrança pro cliente (RF novo) — sem
-- responsável explícito, o sistema não tem como decidir isso. Remove o
-- default 'customer' (o operador tem que escolher, não pode ficar implícito).
--
-- Pré-checagem necessária antes de aplicar em produção:
--   SELECT count(*) FROM fines WHERE responsible IS NULL;
-- No ambiente local, a contagem é 0 (default anterior sempre preenchia).
ALTER TABLE fines ALTER COLUMN responsible DROP DEFAULT;
ALTER TABLE fines ALTER COLUMN responsible SET NOT NULL;
