-- ============================================================
-- Permite ao cliente ler os tenants nos quais ele é customer
--
-- O mobile lê o nome do tenant durante o login para popular o seletor
-- de tenant (quando o cliente pertence a >1 locadora) e validar o
-- vínculo (quando pertence a 1). A policy existente "Members can read
-- their tenants" só cobre tenant_members — clientes não entram lá.
-- Sem essa policy, o join `customers → tenants` no fetchCustomerTenants
-- retorna NULL, fetchCustomerTenants devolve [] e o app interpreta
-- como "não é cliente" → derruba a sessão logo após o signIn,
-- produzindo o redirect loop home → login.
--
-- SECURITY DEFINER pra atravessar a RLS de customers sem laço, no
-- mesmo padrão de current_customer_ids() / get_user_tenant_memberships().
-- ============================================================

CREATE OR REPLACE FUNCTION get_customer_tenants()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT tenant_id FROM customers WHERE user_id = auth.uid();
$$;

CREATE POLICY "customer_self_select_tenants" ON tenants
    FOR SELECT
    TO authenticated
    USING (id IN (SELECT get_customer_tenants()));
