-- ============================================================
-- PRD 0002 — F1: multa pertence ao veículo, cliente é opcional (D3, D6)
-- ============================================================
-- Antes: fines.customer_id NOT NULL + ON DELETE CASCADE (multa some quando
--        cliente é excluído).
-- Depois: customer_id NULLable + ON DELETE SET NULL (multa permanece no
--         histórico do veículo). motorcycle_id passa a ser NOT NULL.
--
-- Pré-checagem necessária antes de aplicar em produção:
--   SELECT count(*) FROM fines WHERE motorcycle_id IS NULL;
-- Hoje, o schema inicial e o seed sempre preenchem motorcycle_id, então
-- a migration sobe limpa em ambiente local.
-- ============================================================

ALTER TABLE fines
    ALTER COLUMN customer_id    DROP NOT NULL,
    ALTER COLUMN motorcycle_id  SET NOT NULL;

-- Reescreve a FK trocando CASCADE por SET NULL.
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_customer_id_fkey;
ALTER TABLE fines
    ADD CONSTRAINT fines_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- Campos do AIT (Auto de Infração de Trânsito) e anexo.
ALTER TABLE fines
    ADD COLUMN ait_number          VARCHAR(50),
    ADD COLUMN infraction_code     VARCHAR(20),
    ADD COLUMN infraction_location TEXT,
    ADD COLUMN points              INTEGER CHECK (points >= 0 AND points <= 7),
    ADD COLUMN source              VARCHAR(30)
        CHECK (source IN ('detran', 'cetran', 'municipal', 'private_area', 'other')),
    ADD COLUMN ticket_url          TEXT;
