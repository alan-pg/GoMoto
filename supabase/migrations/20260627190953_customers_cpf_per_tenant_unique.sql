-- Spec 0001 §4.2 — Migration 1: CPF único por tenant (não global)
--
-- RN-008: cliente pode ter perfil em múltiplos tenants com o mesmo CPF.
-- A constraint global UNIQUE(cpf) criada na migration inicial impede isso.
-- Aqui trocamos por um índice único composto (tenant_id, cpf).
--
-- Pré-check antes de rodar em produção:
--   SELECT cpf, COUNT(*) FROM customers WHERE cpf IS NOT NULL GROUP BY cpf HAVING COUNT(*) > 1;
-- Se retornar linhas: não há CPFs duplicados entre tenants (constraint global impedia).
-- A migration é segura quando esse SELECT retorna vazio.

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_cpf_key;

CREATE UNIQUE INDEX customers_tenant_cpf_unique
  ON customers(tenant_id, cpf)
  WHERE cpf IS NOT NULL;
