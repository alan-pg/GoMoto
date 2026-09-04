-- ---------------------------------------------------------------------------
-- View sem `security_invoker` ignora RLS — e vaza entre tenants
-- ---------------------------------------------------------------------------
-- Uma view no Postgres executa com os direitos do DONO, não de quem consulta.
-- Como as views deste schema pertencem ao superusuário, isso significa RLS
-- desligada: qualquer usuário autenticado enxergaria as linhas de todos os
-- tenants. As views antigas do financeiro já traziam `security_invoker=true`
-- justamente por isso; as criadas nas últimas migrations saíram sem — inclusive
-- as que agregam a carteira inteira.
--
-- O buraco é de isolamento, não de exibição: mesmo com a tela filtrando por
-- `tenant_id`, a consulta chega ao banco autorizada a ver o resto. Basta
-- omitir o filtro em um lugar.
--
-- Deixar `WITH (security_invoker = true)` explícito em toda view nova é
-- inegociável neste schema — é o que faz a política de `financial_entries`,
-- `charges` e `vehicles` valer também para quem lê pela view.

ALTER VIEW receivables_summary      SET (security_invoker = true);
ALTER VIEW receivables_by_month     SET (security_invoker = true);
ALTER VIEW cash_flow_by_month       SET (security_invoker = true);
ALTER VIEW vehicle_asset_position   SET (security_invoker = true);
ALTER VIEW vehicle_obligation_status SET (security_invoker = true);
ALTER VIEW vehicle_document_status  SET (security_invoker = true);
