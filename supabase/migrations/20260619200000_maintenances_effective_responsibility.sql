-- ============================================================
-- F3a — snapshot de responsabilidade em maintenances (PRD 0003 D4)
--
-- Persiste a decisão do operador no momento da conclusão:
--   - executor binário: quem leva à oficina ('company' | 'customer')
--   - pagador percentual: quanto % do custo o cliente arca (0–100)
--     empresa = 100 − cliente; permite 100/0, 50/50, 70/30, etc.
--
-- Snapshot = imutável retroativamente. Mudanças futuras de regra
-- contratual (PRD futuro de "regras de responsabilidade") não
-- reescrevem maintenances já concluídas.
--
-- Nullable nas duas colunas porque:
--   - manutenções históricas (antes desta migration) ficam NULL;
--   - operador pode salvar conclusão sem preencher (default UI = "Empresa 100%").
--     UI vai sempre enviar valores, mas o CHECK permite NULL pra preservar
--     histórico e qualquer linha legada sem default forçado.
-- ============================================================

ALTER TABLE maintenances
    ADD COLUMN effective_executor VARCHAR(20)
        CHECK (effective_executor IS NULL OR effective_executor IN ('company', 'customer')),
    ADD COLUMN effective_customer_payer_pct INTEGER
        CHECK (effective_customer_payer_pct IS NULL
               OR (effective_customer_payer_pct BETWEEN 0 AND 100));
