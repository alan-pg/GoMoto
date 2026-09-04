-- ---------------------------------------------------------------------------
-- Introspecção mínima para o guarda de isolamento entre tenants
-- ---------------------------------------------------------------------------
-- O teste que verifica vazamento entre tenants listava as views À MÃO. Foi
-- exatamente por isso que o furo passou: seis views novas nasceram sem
-- `security_invoker`, ninguém lembrou de acrescentá-las à lista, e o teste
-- seguiu verde enquanto a carteira inteira ficava legível por qualquer tenant.
--
-- Para o guarda descobrir as views sozinho ele precisa de introspecção. A
-- alternativa óbvia — uma RPC que executa SQL arbitrário — seria um buraco
-- maior que o fechado aqui: SQL livre exposto via PostgREST, ainda que só para
-- `service_role`. Esta view expõe SÓ o que a verificação precisa, e nada mais.
--
-- Não devolve dado de negócio: apenas nome de view, se ela declara
-- `security_invoker` e se tem coluna `tenant_id`.

-- Declara `security_invoker` como qualquer outra: a regra vale sem exceção,
-- inclusive para a view que a verifica. Abrir exceção no teste seria criar o
-- precedente que deixou as outras seis passarem.
CREATE OR REPLACE VIEW schema_view_security
WITH (security_invoker = true) AS
SELECT
  c.relname AS view_name,
  COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
  EXISTS (
    SELECT 1 FROM information_schema.columns col
     WHERE col.table_schema = 'public'
       AND col.table_name   = c.relname
       AND col.column_name  = 'tenant_id'
  ) AS has_tenant_id
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v';

COMMENT ON VIEW schema_view_security IS
  'Introspecção para o guarda de RLS: nome da view, se declara security_invoker e se tem tenant_id. Sem dado de negócio.';

-- Só o papel de serviço (usado pelos testes) enxerga. Não há motivo para o
-- cliente autenticado conhecer a topologia do schema.
REVOKE ALL ON schema_view_security FROM PUBLIC, anon, authenticated;
GRANT SELECT ON schema_view_security TO service_role;
