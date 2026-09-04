-- ---------------------------------------------------------------------------
-- Credenciais do gateway saem da tabela (P-1, Spec 0014 §6)
-- ---------------------------------------------------------------------------
-- `payment_provider_accounts.credentials` guardava o access_token do Mercado
-- Pago em JSONB, em texto puro. É uma credencial de pagamento viva: quem a tem
-- movimenta dinheiro da empresa.
--
-- Momento certo para corrigir: a tabela está VAZIA. Depois de existirem contas
-- conectadas, a mesma mudança exigiria migrar segredo e rotacionar token.
--
-- O que esta mudança protege, para não vender mais do que entrega:
--   ✓ dump/backup do banco — o segredo não está na tabela nem no dump dela
--   ✓ leitura direta da tabela, log acidental de uma linha, print de tela
--   ✓ um SELECT amplo feito por engano por alguém com acesso ao banco
--   ✗ NÃO protege contra comprometimento da aplicação: ela precisa decifrar
--     para chamar o gateway, então quem executa código no app alcança o token
--
-- O acesso passa por uma função com checagem de tenant, em vez de coluna: o
-- segredo nunca é selecionável junto com o resto da linha, e o ponto de leitura
-- fica único e auditável.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Metadados que NÃO são segredo continuam na tabela; o token vira referência.
ALTER TABLE payment_provider_accounts
  ADD COLUMN secret_id UUID,
  ADD COLUMN account_email TEXT;

COMMENT ON COLUMN payment_provider_accounts.secret_id IS
  'Referência ao segredo no Vault. O token nunca fica na tabela (P-1).';

-- ---------------------------------------------------------------------------
-- Gravar a credencial
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_store_provider_credentials(
  p_account_id    UUID,
  p_access_token  TEXT,
  p_refresh_token TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
DECLARE
  v_tenant UUID;
  v_old    UUID;
  v_secret UUID;
BEGIN
  SELECT tenant_id, secret_id INTO v_tenant, v_old
    FROM payment_provider_accounts WHERE id = p_account_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Conta de provedor não encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER ignora RLS, então a checagem de tenant é feita aqui: sem
  -- ela, qualquer autenticado gravaria credencial na conta de outra empresa.
  -- `service_role` é backend confiável e não tem tenant de usuário.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND v_tenant NOT IN (SELECT get_user_tenants()) THEN
    RAISE EXCEPTION 'Conta de provedor de outro tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_secret := vault.create_secret(
    jsonb_build_object('access_token', p_access_token, 'refresh_token', p_refresh_token)::text,
    'provider_account_' || p_account_id::text || '_' || extract(epoch from now())::bigint,
    'Credenciais do gateway — conta ' || p_account_id::text
  );

  UPDATE payment_provider_accounts SET secret_id = v_secret WHERE id = p_account_id;

  -- Reconectar a mesma conta troca o token; o anterior não deve sobreviver.
  IF v_old IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old;
  END IF;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION fn_store_provider_credentials(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_store_provider_credentials(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ler a credencial
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_provider_credentials(p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
DECLARE
  v_tenant UUID;
  v_secret UUID;
  v_plain  TEXT;
BEGIN
  SELECT tenant_id, secret_id INTO v_tenant, v_secret
    FROM payment_provider_accounts WHERE id = p_account_id;

  IF v_tenant IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  -- service_role (Edge Function do webhook) não tem tenant de usuário e precisa
  -- passar; usuário autenticado só alcança a própria empresa.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND v_tenant NOT IN (SELECT get_user_tenants()) THEN
    RAISE EXCEPTION 'Credenciais de outro tenant' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT decrypted_secret INTO v_plain
    FROM vault.decrypted_secrets WHERE id = v_secret;

  RETURN v_plain::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION fn_provider_credentials(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_provider_credentials(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION fn_provider_credentials IS
  'Único ponto de leitura da credencial do gateway. Checa tenant porque SECURITY DEFINER ignora RLS.';

-- ---------------------------------------------------------------------------
-- A coluna em texto puro sai
-- ---------------------------------------------------------------------------
-- Sem dados a migrar: a tabela está vazia. Se houvesse contas conectadas, esta
-- migration precisaria mover cada token para o Vault antes do DROP.

ALTER TABLE payment_provider_accounts DROP COLUMN credentials;
