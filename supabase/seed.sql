-- ============================================================
-- GoMoto — Seed de desenvolvimento (multi-tenant)
--
-- Reproduz o estado atual de desenvolvimento:
--   - 1 usuário de teste para login local (admin do tenant default)
--   - vínculo tenant_members ligando o admin ao tenant default
--   - 13 itens padrão de manutenção preventiva
--   - 5 motos fictícias na frota
--   - 3 clientes fictícios
--   - 2 contratos ativos
--   - 2 cobranças (1 paga, 1 pendente)
--   - 1 cliente na fila de espera
--
-- O tenant default ('GoMoto Bonze', id 00000000-...-0001) é criado pela
-- migration 20260611232437_tenant_isolation.sql. Aqui apenas usamos esse ID.
-- ============================================================

-- ID do tenant default — espelha o INSERT da migration tenant_isolation.
-- Mantenha em sincronia caso o ID mude.
-- 00000000-0000-0000-0000-000000000001 → GoMoto Bonze
-- ============================================================

-- ============================================================
-- USUÁRIO DE TESTE PARA LOGIN LOCAL
-- Email: admin@gomoto.dev / Senha: gomoto123
-- ============================================================
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'admin@gomoto.dev',
    crypt('gomoto123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Admin GoMoto"}'::jsonb,
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'f0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    format('{"sub":"%s","email":"%s"}', 'f0000000-0000-0000-0000-000000000001', 'admin@gomoto.dev')::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- ============================================================
-- (admin@gomoto.dev NÃO é tenant_member em momento algum.)
--
-- O usuário acima é "dono do sistema" (platform_admin owner). Por
-- decisão de produto, esse papel é EXCLUSIVO — quem opera a plataforma
-- não acessa cockpit de tenant. O vínculo com tenants vem dos usuários
-- de empresa cliente (bonze@gomoto.dev / norte@gomoto.dev, abaixo).
-- ============================================================

-- ============================================================
-- PLATFORM ADMIN: promove admin@gomoto.dev a owner do control plane.
--
-- O bootstrap fica no SEED (e NÃO na migration) para que migrations
-- de produção não falhem quando o usuário admin ainda não existe.
-- Em produção, o primeiro platform_admin é criado via Studio/SQL
-- direto após o primeiro signup do operador da plataforma.
-- ============================================================
INSERT INTO platform_admins (user_id, role) VALUES
('f0000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- USUÁRIO DE TESTE PARA O MOBILE (cliente)
-- Login: CPF 123.456.789-09 / Senha: gomoto123
--
-- O email no Supabase Auth é um "shell email" sintético gerado a
-- partir do CPF (ADR 0004 §4): `{cpf-digits}@cliente.gomoto.app`.
-- Esse email não recebe mensagens — é apenas o pivô técnico que o
-- Supabase exige. O login no mobile usa CPF + senha, e por baixo o
-- app traduz para o shell email antes de chamar signInWithPassword.
--
-- `password_set: true` em raw_user_meta_data pula a tela de definir
-- senha no primeiro login — vai direto pra home das tabs.
-- O vínculo com customers.user_id é feito mais abaixo (Joao da Silva).
-- ============================================================
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    '12345678909@cliente.gomoto.app',
    crypt('gomoto123', gen_salt('bf')),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Joao da Silva","password_set":true}'::jsonb,
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'f0000000-0000-0000-0000-000000000002',
    'f0000000-0000-0000-0000-000000000002',
    format('{"sub":"%s","email":"%s"}', 'f0000000-0000-0000-0000-000000000002', '12345678909@cliente.gomoto.app')::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- ============================================================
-- SEGUNDO TENANT — "GoMoto Norte", para testar isolamento e multi-tenant.
-- ============================================================
INSERT INTO tenants (id, name, slug) VALUES
('00000000-0000-0000-0000-000000000002', 'GoMoto Norte', 'gomoto-norte')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- USUÁRIOS DE EMPRESA CLIENTE (tenant owners).
-- Esses são os "donos da locadora" — operam o cockpit do tenant,
-- nada do control plane. Mantemos uma conta por tenant para deixar
-- o isolamento óbvio no smoke manual.
--
-- bonze@gomoto.dev → GoMoto Bonze   (senha: gomoto123)
-- norte@gomoto.dev → GoMoto Norte   (senha: gomoto123)
-- ============================================================
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated',
    'bonze@gomoto.dev',
    crypt('gomoto123', gen_salt('bf')),
    NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Owner Bonze"}'::jsonb,
    NOW(), NOW(),
    '', '', '', ''
),
(
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000004',
    'authenticated', 'authenticated',
    'norte@gomoto.dev',
    crypt('gomoto123', gen_salt('bf')),
    NOW(), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Owner Norte"}'::jsonb,
    NOW(), NOW(),
    '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) VALUES
(
    gen_random_uuid(),
    'f0000000-0000-0000-0000-000000000003',
    'f0000000-0000-0000-0000-000000000003',
    format('{"sub":"%s","email":"%s"}', 'f0000000-0000-0000-0000-000000000003', 'bonze@gomoto.dev')::jsonb,
    'email', NOW(), NOW(), NOW()
),
(
    gen_random_uuid(),
    'f0000000-0000-0000-0000-000000000004',
    'f0000000-0000-0000-0000-000000000004',
    format('{"sub":"%s","email":"%s"}', 'f0000000-0000-0000-0000-000000000004', 'norte@gomoto.dev')::jsonb,
    'email', NOW(), NOW(), NOW()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
('00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'owner'),
('00000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000004', 'owner')
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- ============================================================
-- SEED: maintenance_items (13 itens padrão)
-- ============================================================
INSERT INTO maintenance_items (tenant_id, name, km_interval, day_interval, type, tip) VALUES
('00000000-0000-0000-0000-000000000001', 'Troca de oleo',                            1000,  NULL, 'preventive', 'Use oleo 20W50 ou 10W30; troque o filtro a cada 2 trocas.'),
('00000000-0000-0000-0000-000000000001', 'Filtro de oleo',                           4000,  NULL, 'preventive', 'Trocar a cada duas trocas de oleo.'),
('00000000-0000-0000-0000-000000000001', 'Lubrificacao da corrente',                  500,  NULL, 'preventive', 'Use spray para corrente com o-ring; lubrificar apos chuva.'),
('00000000-0000-0000-0000-000000000001', 'Ajuste da corrente',                       1000,  NULL, 'preventive', 'Peso extra afrouxa mais rapido em motos de locacao.'),
('00000000-0000-0000-0000-000000000001', 'Troca da relacao (corrente/coroa/pinhao)', 12000, NULL, 'preventive', 'Prefira relacao original para maior durabilidade.'),
('00000000-0000-0000-0000-000000000001', 'Lona de freio traseira',                  12000,  NULL, 'preventive', 'Evite manter o pe no freio.'),
('00000000-0000-0000-0000-000000000001', 'Pastilha de freio dianteira',              8000,  NULL, 'preventive', 'Use o freio dianteiro de forma equilibrada.'),
('00000000-0000-0000-0000-000000000001', 'Pneu dianteiro',                          12000,  NULL, 'preventive', 'Calibre semanalmente (32 psi dianteiro).'),
('00000000-0000-0000-0000-000000000001', 'Pneu traseiro',                            8000,  NULL, 'preventive', 'Calibre semanalmente (36 psi traseiro).'),
('00000000-0000-0000-0000-000000000001', 'Filtro de ar',                             7000,  NULL, 'preventive', 'Limpar ou trocar; poeira urbana reduz durabilidade.'),
('00000000-0000-0000-0000-000000000001', 'Velas de ignicao',                        10000,  NULL, 'preventive', 'Verificar e ajustar folga antes de trocar.'),
('00000000-0000-0000-0000-000000000001', 'Amortecedores',                           25000,  NULL, 'preventive', 'Peso extra acelera desgaste do oleo interno.'),
('00000000-0000-0000-0000-000000000001', 'Vistoria mensal',                          NULL,    30, 'inspection', 'Vistoria obrigatoria mensal de todas as motos.');

-- ============================================================
-- SEED: maintenance_plans + maintenance_plan_items (PRD 0003 §10.1)
-- 1 plano default por tenant com 5 itens espelhando SUGGESTED_PLAN_ITEMS.
-- IDs fixos para facilitar smoke manual e E2E:
--   Bonze: 10000000-0000-0000-0000-000000000001
--   Norte: 10000000-0000-0000-0000-000000000002
-- ============================================================
INSERT INTO maintenance_plans (id, tenant_id, name, description, is_default) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Plano Padrão',
    'Plano default do tenant Bonze. Cobre óleo, filtro, freio, pneu e vistoria mensal.', true),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Plano Padrão',
    'Plano default do tenant Norte. Mesma estrutura do Bonze para facilitar smoke entre tenants.', true);

INSERT INTO maintenance_plan_items
    (tenant_id, plan_id, name, interval_km, interval_days, is_critical, sort_order) VALUES
-- Plano Bonze
('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    'Troca de óleo',               1000,  NULL, false, 0),
('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    'Filtro de óleo',              4000,  NULL, false, 1),
('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    'Pastilha de freio dianteira', 8000,  NULL, true,  2),
('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    'Pneu dianteiro',              16000, NULL, true,  3),
('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    'Vistoria mensal',             NULL,  30,   true,  4),
-- Plano Norte
('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
    'Troca de óleo',               1000,  NULL, false, 0),
('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
    'Filtro de óleo',              4000,  NULL, false, 1),
('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
    'Pastilha de freio dianteira', 8000,  NULL, true,  2),
('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
    'Pneu dianteiro',              16000, NULL, true,  3),
('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
    'Vistoria mensal',             NULL,  30,   true,  4);

-- ============================================================
-- SEED: settings
-- ============================================================
INSERT INTO settings (tenant_id, key, value) VALUES
('00000000-0000-0000-0000-000000000001', 'company_name',          'GoMoto Locadora'),
('00000000-0000-0000-0000-000000000001', 'company_cnpj',          ''),
('00000000-0000-0000-0000-000000000001', 'company_phone',         ''),
('00000000-0000-0000-0000-000000000001', 'company_email',         ''),
('00000000-0000-0000-0000-000000000001', 'company_address',       ''),
('00000000-0000-0000-0000-000000000001', 'email_notifications',   'true'),
('00000000-0000-0000-0000-000000000001', 'due_date_warning_days', '3');

-- ============================================================
-- SEED: motorcycles (5 motos da frota)
--
-- PRD 0002: além dos campos básicos, populamos identidade documental
-- atual (registered_owner_*) e dados de aquisição (acquisition_*).
-- Todas as motos estão registradas em nome da locadora (CNPJ fictício).
-- ============================================================
INSERT INTO motorcycles (
    id, tenant_id, license_plate, model, make, year_manufacture, year_model, color, renavam, chassis, fuel, engine_capacity, status, km_current,
    registered_owner_name, registered_owner_document, registered_owner_type, registration_state,
    ownership_transferred, acquisition_type, acquisition_amount
) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'ABC-1234', 'CG 160 Start', 'Honda',  '2021', '2021', 'Vermelha', '12345678901', '9C2KC2220MR123456', 'Gasolina', '160cc', 'rented',    45000, 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', 'SP', true,  'purchase',     11500.00),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'ABC1D23',  'CG 160 Fan',   'Honda',  '2022', '2023', 'Preta',    '10987654321', '9C2KC2220NR654321', 'Flex',     '160cc', 'rented',    25000, 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', 'SP', true,  'zero_km',      13900.00),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'DEF-5678', 'Factor 150',   'Yamaha', '2023', '2023', 'Branca',   '11223344556', '9C6KE2020PR112233', 'Flex',     '150cc', 'available', 15000, 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', 'SP', true,  'zero_km',      14250.00),
('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'GHI-9012', 'Biz 125',      'Honda',  '2021', '2022', 'Vermelha', '66554433221', '9C2JC1110MR998877', 'Flex',     '125cc', 'available', 32000, 'José Vendedor Antigo',       '11122233344', 'cpf',  'SP', false, 'purchase',      9800.00),
('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000001', 'JKL3M45',  'Pop 110i',     'Honda',  '2022', '2022', 'Preta',    '99887766554', '9C2HA1010NR554433', 'Gasolina', '110cc', 'available',  8000, 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', 'SP', true,  'consignment',   7600.00);

-- Previous owner para a Biz 125 (transferência ainda pendente — registered_owner ainda é o vendedor).
UPDATE motorcycles
   SET previous_owner     = 'José Vendedor Antigo',
       previous_owner_cpf = '11122233344'
 WHERE id = '44444444-4444-4444-4444-444444444444';

-- PRD 0003 — amarra 4 das 5 motos do Bonze ao Plano Padrão. A Biz 125
-- (44444444…) propositadamente fica sem plano para que o smoke da F2
-- exiba o banner "Atribua um plano de manutenção" do PRD §10.3.
UPDATE motorcycles
   SET maintenance_plan_id = '10000000-0000-0000-0000-000000000001'
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
   AND id <> '44444444-4444-4444-4444-444444444444';

-- ============================================================
-- SEED: vehicle_documents (PRD 0002 — CRLV vigente por moto)
--
-- Cada moto tem um CRLV de exercício atual marcado is_current=true.
-- O CRV físico não é seedado porque na prática a locadora guarda
-- esse documento e raramente reemite. Para a moto 44 (não transferida),
-- omitimos CRLV vigente em nome da empresa.
-- ============================================================
INSERT INTO vehicle_documents (id, tenant_id, motorcycle_id, type, exercise_year, document_number, issued_at, registered_owner_name, registered_owner_document, registered_owner_type, is_current, observations) VALUES
('d0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'crlv', 2026, 'SP202611111111', '2026-02-10', 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', true, 'CRLV-e baixado no app DETRAN-SP.'),
('d0000002-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'crlv', 2026, 'SP202622222222', '2026-03-05', 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', true, NULL),
('d0000003-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'crlv', 2026, 'SP202633333333', '2026-01-22', 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', true, NULL),
('d0000005-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'crlv', 2026, 'SP202655555555', '2026-04-18', 'GoMoto Bonze Locadora LTDA', '12345678000190', 'cnpj', true, NULL);

-- ============================================================
-- SEED: vehicle_obligations (PRD 0002)
--
-- Cobertura: IPVA + licenciamento 2026 para todas as motos.
-- Mix de status para o smoke da listagem:
--   - moto 11: tudo pago.
--   - moto 22: IPVA pago, licenciamento ainda pending no prazo.
--   - moto 33: IPVA pago, licenciamento vencido (effectiveStatus calcula 'overdue').
--   - moto 44: IPVA pending vencido (overdue derivado) + licenciamento pending.
--   - moto 55: IPVA paid, licenciamento exempt (isenta por DETRAN nesse caso fictício).
-- Inclui também 1 DPVAT 2026 paga para a moto 11 (exemplo extra-tipo).
-- ============================================================
INSERT INTO vehicle_obligations (id, tenant_id, motorcycle_id, type, reference_year, description, amount, due_date, status, paid_at, payment_method, payment_reference) VALUES
-- Moto 11
('b0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ipva',         2026, 'IPVA 2026 — cota única',         115.00, '2026-04-10', 'paid',    '2026-04-08', 'pix', 'TXN-IPVA-11'),
('b0000002-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'licensing',    2026, 'Licenciamento 2026',              98.91, '2026-09-30', 'pending', NULL,         NULL, NULL),
('b0000003-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'dpvat',        2026, 'DPVAT 2026',                      57.00, '2026-01-31', 'paid',    '2026-01-29', 'boleto', 'TXN-DPVAT-11'),
-- Moto 22
('b0000004-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'ipva',         2026, 'IPVA 2026 — cota única',         139.00, '2026-04-10', 'paid',    '2026-04-09', 'pix', 'TXN-IPVA-22'),
('b0000005-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'licensing',    2026, 'Licenciamento 2026',              98.91, '2026-09-30', 'pending', NULL,         NULL, NULL),
-- Moto 33
('b0000006-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'ipva',         2026, 'IPVA 2026 — cota única',         142.50, '2026-04-10', 'paid',    '2026-04-05', 'pix', 'TXN-IPVA-33'),
('b0000007-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'licensing',    2026, 'Licenciamento 2026',              98.91, '2026-05-31', 'pending', NULL,         NULL, NULL),
-- Moto 44 (não transferida — locadora paga, mas registro segue no antigo dono)
('b0000008-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'ipva',         2026, 'IPVA 2026 — cota única',          98.00, '2026-04-10', 'pending', NULL,         NULL, NULL),
('b0000009-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'licensing',    2026, 'Licenciamento 2026',              98.91, '2026-09-30', 'pending', NULL,         NULL, NULL),
-- Moto 55
('b000000a-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'ipva',         2026, 'IPVA 2026 — cota única',          76.00, '2026-04-10', 'paid',    '2026-04-07', 'pix', 'TXN-IPVA-55'),
('b000000b-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'licensing',    2026, 'Licenciamento 2026 — isenta',     0.00,  '2026-09-30', 'exempt',  NULL,         NULL, NULL);

-- ============================================================
-- SEED: customers (3 clientes fictícios)
-- ============================================================
-- Joao da Silva é o cliente vinculado ao login mobile (cliente@gomoto.dev).
INSERT INTO customers (id, tenant_id, user_id, name, cpf, rg, state, phone, email, in_queue, active) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'Joao da Silva',  '12345678909', '12345678', 'SP', '(11) 98765-4321', 'cliente@gomoto.dev',       false, true),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000001', NULL,                                  'Maria Santos',   '98765432100', '87654321', 'SP', '(11) 91234-5678', 'maria.santos@email.com',   false, true),
('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000001', NULL,                                  'Pedro Oliveira', '11122233344', '11223344', 'SP', '(11) 99988-7766', 'pedro.oliveira@email.com', true,  true);

-- ============================================================
-- SEED: rentals (2 locações ativas — Spec 0004)
-- ============================================================
INSERT INTO rentals (id, tenant_id, customer_id, motorcycle_id, contract_type, cycle, due_day, cycle_amount, use_pro_rata, start_date, end_date, status) VALUES
('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'rental',      'monthly', 10, 800.00, true, CURRENT_DATE - INTERVAL '2 months', CURRENT_DATE + INTERVAL '4 months', 'active'),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'rent_to_own', 'monthly', 10, 900.00, true, CURRENT_DATE - INTERVAL '1 month',  CURRENT_DATE + INTERVAL '5 months', 'active');

-- ============================================================
-- SEED: billings (1 paga, 1 pendente — Spec 0004)
-- ============================================================
INSERT INTO billings (tenant_id, lease_id, customer_id, description, original_amount, due_date, status, payment_date, billing_type) VALUES
('00000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mensalidade - Parcela 2', 800.00, CURRENT_DATE - INTERVAL '5 days', 'paid',    CURRENT_DATE - INTERVAL '6 days', 'cycle'),
('00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mensalidade - Parcela 1', 900.00, CURRENT_DATE + INTERVAL '2 days', 'pending', NULL,                               'cycle');

-- ============================================================
-- SEED: queue_entries (Pedro Oliveira na fila, posição 1)
-- ============================================================
INSERT INTO queue_entries (tenant_id, customer_id, position, notes) VALUES
('00000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1, 'Aguardando disponibilidade de moto CG 160');

-- ============================================================
-- SEED: maintenances da moto do cliente mobile (ABC-1234, 45.000 km)
--
-- Cobre os 4 status do front (overdue / upcoming / scheduled / completed)
-- pra dar um smoke completo da tela de manutenções no mobile (F4) e do
-- modal de conclusão no web (F3b). predicted_km é casado com o km_current
-- da moto pra status ser determinístico:
--   - overdue (km):  predicted_km <= 45000
--   - upcoming (km): 45000 está dentro da janela `predicted_km - 10% do interval_km`
--   - scheduled:    predicted_km bem acima de 45000
--   - overdue (data): scheduled_date no passado
-- A concluída traz cost + effective_executor + effective_customer_payer_pct
-- pra exercitar o snapshot de responsabilidade (PRD 0003 D4).
-- ============================================================
INSERT INTO maintenances (
    tenant_id, motorcycle_id, type, description,
    predicted_km, scheduled_date,
    actual_km, completed_date, completed, cost,
    workshop, effective_executor, effective_customer_payer_pct
) VALUES
-- 1) Vencida por km — Troca de óleo prevista a 44.000 km, moto está em 45.000.
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'preventive', 'Troca de óleo',
    44000, NULL,
    NULL, NULL, false, NULL,
    NULL, NULL, NULL),
-- 2) Próxima por km — Filtro de óleo prevista a 45.200, intervalo 4000 (threshold 400).
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'preventive', 'Filtro de óleo',
    45200, NULL,
    NULL, NULL, false, NULL,
    NULL, NULL, NULL),
-- 3) Agendada — Pastilha de freio dianteira a 52.000 km, longe do current.
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'preventive', 'Pastilha de freio dianteira',
    52000, NULL,
    NULL, NULL, false, NULL,
    NULL, NULL, NULL),
-- 4) Vencida por data — Vistoria mensal com scheduled_date no passado.
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'inspection', 'Vistoria mensal',
    NULL, CURRENT_DATE - INTERVAL '3 days',
    NULL, NULL, false, NULL,
    NULL, NULL, NULL),
-- 5) Concluída — Troca de óleo de 30 dias atrás. Empresa executou e pagou 100%.
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'preventive', 'Troca de óleo',
    44000, NULL,
    44050, CURRENT_DATE - INTERVAL '30 days', true, 80.00,
    'Oficina do Careca', 'company', 0);
