-- ============================================================
-- Split motorcycles.year em year_manufacture + year_model
-- ============================================================
-- A app sempre consumiu year_manufacture/year_model (types em
-- packages/core/src/types e schemas Zod em packages/core/src/schemas),
-- mas o banco tinha uma coluna única `year`. O desalinhamento causava
-- PGRST204 ao salvar a moto. Esta migration alinha o banco aos types
-- existentes:
--   - renomeia year → year_manufacture (mantém o histórico já gravado)
--   - adiciona year_model como NULLable (CRLV-e traz ambos; usuário
--     pode preencher só fabricação se não souber o ano modelo).
-- ============================================================

ALTER TABLE motorcycles RENAME COLUMN year TO year_manufacture;
ALTER TABLE motorcycles ADD COLUMN year_model VARCHAR(10);
