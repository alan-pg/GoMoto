-- ============================================================
-- Vincula customers ↔ auth.users (mobile cliente)
--
-- - user_id nullable: cliente é criado no CRM antes do convite
-- - UNIQUE parcial (tenant_id, user_id): mesmo auth.users pode ser
--   cliente de N tenants, mas no máximo 1 customer por tenant
-- - ON DELETE SET NULL: apagar a conta auth não apaga o cadastro CRM
--
-- Sem constraint cruzada com tenant_members — a separação admin/cliente
-- vive nos apps (web olha tenant_members, mobile olha customers.user_id).
-- Ver ADR 0003 (obsidian-notes/decisions/).
-- ============================================================

ALTER TABLE customers
    ADD COLUMN user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_user_id
    ON customers(user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX customers_tenant_user_unique
    ON customers(tenant_id, user_id)
    WHERE user_id IS NOT NULL;
