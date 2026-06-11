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
-- TENANT MEMBER: vincula admin@gomoto.dev ao tenant default como owner
-- ============================================================
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
('00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'owner')
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
-- ============================================================
INSERT INTO motorcycles (id, tenant_id, license_plate, model, make, year, color, renavam, chassis, fuel, engine_capacity, status, km_current) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'ABC-1234', 'CG 160 Start', 'Honda',  '2021',      'Vermelha', '12345678901', '9C2KC2220MR123456', 'Gasolina', '160cc', 'rented',    45000),
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'ABC1D23',  'CG 160 Fan',   'Honda',  '2022/2023', 'Preta',    '10987654321', '9C2KC2220NR654321', 'Flex',     '160cc', 'rented',    25000),
('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'DEF-5678', 'Factor 150',   'Yamaha', '2023',      'Branca',   '11223344556', '9C6KE2020PR112233', 'Flex',     '150cc', 'available', 15000),
('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'GHI-9012', 'Biz 125',      'Honda',  '2021/2022', 'Vermelha', '66554433221', '9C2JC1110MR998877', 'Flex',     '125cc', 'available', 32000),
('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000001', 'JKL3M45',  'Pop 110i',     'Honda',  '2022',      'Preta',    '99887766554', '9C2HA1010NR554433', 'Gasolina', '110cc', 'available',  8000);

-- ============================================================
-- SEED: customers (3 clientes fictícios)
-- ============================================================
INSERT INTO customers (id, tenant_id, name, cpf, rg, state, phone, email, in_queue, active) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000001', 'Joao da Silva',  '123.456.789-09', '12345678', 'SP', '(11) 98765-4321', 'joao.silva@email.com',     false, true),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000001', 'Maria Santos',   '987.654.321-00', '87654321', 'SP', '(11) 91234-5678', 'maria.santos@email.com',   false, true),
('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000001', 'Pedro Oliveira', '111.222.333-44', '11223344', 'SP', '(11) 99988-7766', 'pedro.oliveira@email.com', true,  true);

-- ============================================================
-- SEED: contracts (2 contratos ativos)
-- ============================================================
INSERT INTO contracts (id, tenant_id, customer_id, motorcycle_id, start_date, end_date, monthly_amount, status) VALUES
('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', CURRENT_DATE - INTERVAL '2 months', CURRENT_DATE + INTERVAL '4 months', 800.00, 'active'),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', CURRENT_DATE - INTERVAL '1 month',  CURRENT_DATE + INTERVAL '5 months', 900.00, 'active');

-- ============================================================
-- SEED: billings (1 paga, 1 pendente)
-- ============================================================
INSERT INTO billings (tenant_id, contract_id, customer_id, description, amount, due_date, status, payment_date) VALUES
('00000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mensalidade - Parcela 2', 800.00, CURRENT_DATE - INTERVAL '5 days', 'paid',    CURRENT_DATE - INTERVAL '6 days'),
('00000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mensalidade - Parcela 1', 900.00, CURRENT_DATE + INTERVAL '2 days', 'pending', NULL);

-- ============================================================
-- SEED: queue_entries (Pedro Oliveira na fila, posição 1)
-- ============================================================
INSERT INTO queue_entries (tenant_id, customer_id, position, notes) VALUES
('00000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1, 'Aguardando disponibilidade de moto CG 160');
