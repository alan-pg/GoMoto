-- ============================================================
-- RLS read-only para o cliente mobile (ADR 0003 §5)
--
-- O cliente autenticado precisa enxergar APENAS os próprios dados:
--   - contracts dos quais ele é o customer
--   - billings vinculadas a esses contratos
--   - motorcycles que ele tem/teve em contrato
--   - maintenances dessas motorcycles
--
-- As policies admin existentes (tenant_isolation_*) seguem intactas:
--   - PERMISSIVE FOR ALL, filtra por get_user_tenants()
--   - cliente não está em tenant_members, então não recebe nada por essa via
--
-- Como ambas são PERMISSIVE, o efeito é OR: admin OU cliente vê o que é dele.
-- INSERT/UPDATE/DELETE continuam exclusivos do admin (cliente é read-only).
-- ============================================================

-- ============================================================
-- HELPER: current_customer_ids()
-- Retorna os IDs de customers vinculados ao auth.uid() atual.
-- Pode retornar N linhas (cliente em N tenants — ADR 0003 §3).
-- SECURITY DEFINER pra atravessar RLS de customers sem loop.
-- ============================================================
CREATE OR REPLACE FUNCTION current_customer_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT id FROM customers WHERE user_id = auth.uid();
$$;

-- ============================================================
-- contracts: cliente lê os contratos onde ele é o customer
-- ============================================================
CREATE POLICY "customer_self_select_contracts" ON contracts
    FOR SELECT
    TO authenticated
    USING (customer_id IN (SELECT current_customer_ids()));

-- ============================================================
-- billings: cliente lê as cobranças vinculadas a ele
-- ============================================================
CREATE POLICY "customer_self_select_billings" ON billings
    FOR SELECT
    TO authenticated
    USING (customer_id IN (SELECT current_customer_ids()));

-- ============================================================
-- motorcycles: cliente lê as motos com as quais teve/tem contrato
--
-- Não restringimos a contratos ativos — cliente pode rever histórico
-- de motos já devolvidas. App-side decide se filtra por contrato vigente.
-- Se isso virar problema de privacidade (cliente vendo o que está
-- acontecendo com a moto depois da devolução), trocar por:
--   WHERE customer_id IN (...) AND status = 'active'
-- ============================================================
CREATE POLICY "customer_self_select_motorcycles" ON motorcycles
    FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT motorcycle_id FROM contracts
            WHERE customer_id IN (SELECT current_customer_ids())
        )
    );

-- ============================================================
-- maintenances: cliente lê manutenções das motos que tem/teve em contrato
-- Mesmo critério de motorcycles acima.
-- ============================================================
CREATE POLICY "customer_self_select_maintenances" ON maintenances
    FOR SELECT
    TO authenticated
    USING (
        motorcycle_id IN (
            SELECT motorcycle_id FROM contracts
            WHERE customer_id IN (SELECT current_customer_ids())
        )
    );
