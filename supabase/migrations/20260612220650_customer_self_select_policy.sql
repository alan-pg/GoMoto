-- ============================================================
-- Permite ao cliente ler a própria linha em customers
--
-- A policy existente "tenant_isolation_customers" usa get_user_tenants(),
-- que filtra por tenant_members — clientes não estão lá. Sem essa policy
-- adicional, o mobile não consegue nem validar o vínculo no login.
--
-- Permissive + FOR SELECT: combina com a policy existente via OR. Writes
-- continuam exclusivos do universo administrativo (sem policy de INSERT/UPDATE/DELETE
-- para o cliente).
-- ============================================================

CREATE POLICY "customers_self_select" ON customers
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
