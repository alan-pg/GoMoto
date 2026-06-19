-- ============================================================
-- Unicidade de motorcycles passa a ser por tenant (não global)
-- ============================================================
-- Antes: motorcycles.license_plate era UNIQUE globalmente — duas locadoras
-- (tenants) diferentes não podiam cadastrar a mesma placa, o que é absurdo
-- na prática: cada empresa enxerga só sua frota. RENAVAM e chassi não tinham
-- constraint nenhuma, permitindo duplicatas dentro da mesma frota.
--
-- Depois: UNIQUE(tenant_id, ·) em license_plate, renavam e chassis. Cada
-- identidade do veículo continua única dentro da empresa, mas pode coexistir
-- entre empresas distintas (ex.: revenda entre locadoras).
--
-- NULLs em renavam/chassis (motos em processo de regularização) são ignorados
-- pela UNIQUE do Postgres por padrão — não há risco de bloquear cadastros
-- parciais.
-- ============================================================

ALTER TABLE motorcycles
    DROP CONSTRAINT IF EXISTS motorcycles_license_plate_key;

ALTER TABLE motorcycles
    ADD CONSTRAINT motorcycles_tenant_license_plate_key
    UNIQUE (tenant_id, license_plate);

ALTER TABLE motorcycles
    ADD CONSTRAINT motorcycles_tenant_renavam_key
    UNIQUE (tenant_id, renavam);

ALTER TABLE motorcycles
    ADD CONSTRAINT motorcycles_tenant_chassis_key
    UNIQUE (tenant_id, chassis);
