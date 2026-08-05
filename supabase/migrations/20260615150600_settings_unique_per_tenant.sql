-- ============================================================
-- fix(settings): unique de `key` deve ser por tenant
-- ============================================================
-- A criação inicial da tabela (initial_schema) definiu `key UNIQUE` global,
-- antes da migração de tenant_isolation que adicionou `tenant_id`. O
-- resultado: dois tenants não conseguem ter a mesma chave (ex.: ambos
-- com `company_name`), o que quebra `create_tenant_with_owner` na hora
-- de injetar settings default para o segundo tenant em diante.
--
-- Bug ficou latente porque só o tenant seed (GoMoto Locadora) tinha
-- settings populadas. Descoberto na primeira chamada do RPC de cadastro.
--
-- Correção: troca o UNIQUE global por UNIQUE composto (tenant_id, key).
-- ============================================================

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
ALTER TABLE settings ADD CONSTRAINT settings_tenant_id_key_key UNIQUE (tenant_id, key);
