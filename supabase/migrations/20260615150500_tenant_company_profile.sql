-- ============================================================
-- F-empresa-completa — perfil corporativo do tenant + criação atômica
-- ============================================================
-- ALTER TABLE tenants para abrigar identidade fiscal, contato e endereço
-- diretamente como colunas (em vez de chaves dispersas em `settings`).
--
-- - Todos os campos novos são NULL para não quebrar tenants existentes
--   (Bonze/Norte) que foram criados antes da expansão.
-- - CNPJ é UNIQUE quando preenchido (UNIQUE em coluna NULLable permite
--   múltiplos NULLs no Postgres por padrão).
-- - CHECK constraints garantem 14 dígitos no CNPJ e UF em 2 letras.
--
-- Também cria a RPC `create_tenant_with_owner`, que atomicamente:
--   1) cria o auth.users do owner principal
--   2) insere o tenant
--   3) cria o vínculo em tenant_members (role='owner')
--   4) injeta as settings default (mirror do que o seed faz)
--   5) registra entrada em platform_audit_logs
--
-- A função é SECURITY DEFINER e o caller é checado com get_platform_role().
-- Se qualquer passo falhar, a transação inteira rola back e o owner não
-- fica órfão em auth.users.
-- ============================================================

ALTER TABLE tenants
    ADD COLUMN legal_name         VARCHAR(200) NULL,
    ADD COLUMN cnpj               VARCHAR(14)  NULL,
    ADD COLUMN contact_email      VARCHAR(200) NULL,
    ADD COLUMN contact_phone      VARCHAR(30)  NULL,
    ADD COLUMN address_zip        VARCHAR(8)   NULL,
    ADD COLUMN address_street     VARCHAR(200) NULL,
    ADD COLUMN address_number     VARCHAR(20)  NULL,
    ADD COLUMN address_complement VARCHAR(100) NULL,
    ADD COLUMN address_district   VARCHAR(100) NULL,
    ADD COLUMN address_city       VARCHAR(100) NULL,
    ADD COLUMN address_state      CHAR(2)      NULL;

-- Único quando preenchido. Permite múltiplos tenants sem CNPJ no MVP.
CREATE UNIQUE INDEX idx_tenants_cnpj_unique ON tenants(cnpj) WHERE cnpj IS NOT NULL;

ALTER TABLE tenants
    ADD CONSTRAINT chk_tenants_cnpj_digits
        CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
    ADD CONSTRAINT chk_tenants_state_uf
        CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT chk_tenants_zip_digits
        CHECK (address_zip IS NULL OR address_zip ~ '^[0-9]{8}$');

-- ============================================================
-- RPC: create_tenant_with_owner
-- ============================================================
CREATE OR REPLACE FUNCTION create_tenant_with_owner(
    p_tenant         JSONB,
    p_owner_email    TEXT,
    p_owner_password TEXT,
    p_owner_name     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor      UUID := auth.uid();
    v_owner_id   UUID := uuid_generate_v4();
    v_tenant_id  UUID;
    v_address    TEXT;
    v_normalized_email TEXT;
BEGIN
    -- Gate: apenas platform_admin (qualquer role) cria tenant.
    IF get_platform_role() IS NULL THEN
        RAISE EXCEPTION 'apenas platform_admin cria tenant' USING ERRCODE='42501';
    END IF;

    v_normalized_email := LOWER(TRIM(p_owner_email));

    IF v_normalized_email = '' OR position('@' in v_normalized_email) = 0 THEN
        RAISE EXCEPTION 'email do owner inválido' USING ERRCODE='22023';
    END IF;
    IF length(p_owner_password) < 8 THEN
        RAISE EXCEPTION 'senha precisa de no mínimo 8 caracteres' USING ERRCODE='22023';
    END IF;
    IF coalesce(trim(p_owner_name), '') = '' THEN
        RAISE EXCEPTION 'nome do owner é obrigatório' USING ERRCODE='22023';
    END IF;

    -- 1) cria o usuário no auth (mesmo formato que o seed.sql usa)
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_owner_id,
        'authenticated', 'authenticated',
        v_normalized_email,
        crypt(p_owner_password, gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', trim(p_owner_name)),
        NOW(), NOW(),
        '', '', '', ''
    );
    -- UNIQUE em auth.users.email → conflito vira 23505 e app traduz.

    INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
    ) VALUES (
        uuid_generate_v4(),
        v_owner_id,
        v_owner_id::text,
        jsonb_build_object('sub', v_owner_id::text, 'email', v_normalized_email),
        'email',
        NOW(), NOW(), NOW()
    );

    -- 2) cria o tenant
    INSERT INTO tenants (
        name, slug, legal_name, cnpj,
        contact_email, contact_phone,
        address_zip, address_street, address_number, address_complement,
        address_district, address_city, address_state,
        created_by
    ) VALUES (
        p_tenant->>'name',
        p_tenant->>'slug',
        NULLIF(p_tenant->>'legal_name', ''),
        NULLIF(p_tenant->>'cnpj', ''),
        NULLIF(p_tenant->>'contact_email', ''),
        NULLIF(p_tenant->>'contact_phone', ''),
        NULLIF(p_tenant->>'address_zip', ''),
        NULLIF(p_tenant->>'address_street', ''),
        NULLIF(p_tenant->>'address_number', ''),
        NULLIF(p_tenant->>'address_complement', ''),
        NULLIF(p_tenant->>'address_district', ''),
        NULLIF(p_tenant->>'address_city', ''),
        NULLIF(p_tenant->>'address_state', ''),
        v_actor
    )
    RETURNING id INTO v_tenant_id;

    -- 3) vincula o owner ao tenant
    INSERT INTO tenant_members (tenant_id, user_id, role)
    VALUES (v_tenant_id, v_owner_id, 'owner');

    -- 4) settings default. Mirror da estrutura usada pelo cockpit do
    --    tenant; populamos a partir do payload pra evitar "tenant novo
    --    com /configuracoes vazia".
    v_address := concat_ws(', ',
        NULLIF(concat_ws(' ', p_tenant->>'address_street', p_tenant->>'address_number'), ' '),
        NULLIF(p_tenant->>'address_district', ''),
        NULLIF(concat_ws('/', p_tenant->>'address_city', p_tenant->>'address_state'), '/')
    );

    INSERT INTO settings (tenant_id, key, value) VALUES
        (v_tenant_id, 'company_name',          COALESCE(NULLIF(p_tenant->>'legal_name', ''), p_tenant->>'name')),
        (v_tenant_id, 'company_cnpj',          COALESCE(p_tenant->>'cnpj', '')),
        (v_tenant_id, 'company_phone',         COALESCE(p_tenant->>'contact_phone', '')),
        (v_tenant_id, 'company_email',         COALESCE(p_tenant->>'contact_email', '')),
        (v_tenant_id, 'company_address',       COALESCE(v_address, '')),
        (v_tenant_id, 'email_notifications',   'true'),
        (v_tenant_id, 'due_date_warning_days', '3');

    -- 5) trilha
    INSERT INTO platform_audit_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (
        v_actor, 'tenant.create_with_owner', 'tenant', v_tenant_id,
        jsonb_build_object(
            'name', p_tenant->>'name',
            'slug', p_tenant->>'slug',
            'owner_email', v_normalized_email
        )
    );

    RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_tenant_with_owner(JSONB, TEXT, TEXT, TEXT) TO authenticated;
