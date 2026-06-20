-- ============================================================
-- F5.4 — Realtime para `maintenance_records`
--
-- Inclui a tabela na publication `supabase_realtime` pra que tanto o
-- web (dashboard do operador) quanto o mobile (cliente) recebam eventos
-- de INSERT/UPDATE e invalidem o cache do React Query.
--
-- Cenários cobertos:
--   - Cliente envia registro no mobile → badge "Aprovações" no web é
--     incrementado em outras sessões do operador.
--   - Operador aprova/rejeita no web → mobile do cliente troca o pill
--     "Aguardando aprovação" pelo estado final sem precisar pull-to-refresh.
--   - Múltiplas abas do dashboard sincronizam o badge entre si.
--
-- A própria RLS da tabela continua filtrando o que cada cliente recebe
-- (operador vê tudo do tenant; cliente vê só os próprios) — realtime
-- respeita a policy via supabase-realtime.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE maintenance_records;
