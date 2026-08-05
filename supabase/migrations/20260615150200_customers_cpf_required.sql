-- ============================================================
-- F2 — CPF como identidade global do cliente
-- ============================================================
-- ADR 0004 §2: existe UM cliente por CPF na plataforma; o CPF é o
-- pivô que permite ao mesmo `auth.users` aparecer em `customers` de
-- N tenants (cliente migra entre locadoras sem perder histórico).
--
-- Esta migration:
-- 1. Normaliza qualquer CPF já gravado (remove pontos/traços) para
--    o formato canônico de 11 dígitos. Sem isso, duplicatas como
--    "123.456.789-09" vs "12345678909" ficariam permitidas.
-- 2. Exige cpf NOT NULL. Pré-existia UNIQUE global desde a migration
--    inicial, mas o NOT NULL é a peça que faltava para CPF ser a
--    identidade — a UI já trata como obrigatório.
-- 3. CHECK ^[0-9]{11}$ garante que escritas futuras sigam o formato.
--
-- Em produção, se houver `customers` com cpf NULL, a migration FALHA
-- ao aplicar SET NOT NULL — é proposital. Limpe os registros antes
-- de promover o deploy.
-- ============================================================

-- 1. Backfill: normaliza CPFs já gravados (remove tudo que não for dígito).
UPDATE customers
   SET cpf = regexp_replace(cpf, '[^0-9]', '', 'g')
 WHERE cpf IS NOT NULL
   AND cpf !~ '^[0-9]+$';

-- 2. NOT NULL — a UI já valida como obrigatório; o banco passa a refletir isso.
ALTER TABLE customers
    ALTER COLUMN cpf SET NOT NULL;

-- 3. Formato canônico: exatamente 11 dígitos. Sem checar validade matemática
--    aqui — esse é trabalho da camada de aplicação (zod), que tem acesso a
--    mensagens de erro contextuais.
ALTER TABLE customers
    ADD CONSTRAINT customers_cpf_format CHECK (cpf ~ '^[0-9]{11}$');
