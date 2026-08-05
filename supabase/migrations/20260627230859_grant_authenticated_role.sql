-- ============================================================
-- Corrige GRANTs dos roles anon/authenticated/service_role.
--
-- As tabelas criadas via migration rodam sob o role `postgres`.
-- O DEFAULT PRIVILEGE do role `postgres` (setup local Supabase)
-- só concede TRUNCATE/REFERENCES/TRIGGER — não SELECT/INSERT/UPDATE/DELETE.
-- O role `supabase_admin` (usado no hosted Supabase) concede ALL, por isso
-- o projeto funcionava na cloud mas falha localmente após db:reset.
--
-- Esta migration:
-- 1. Concede ALL nas tabelas/sequences/funções já existentes.
-- 2. Corrige ALTER DEFAULT PRIVILEGES do role `postgres` para tabelas futuras.
-- ============================================================

-- Tabelas e views existentes
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Garantir USAGE no schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Corrigir para novas tabelas/sequences/funções criadas pelo role postgres
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
