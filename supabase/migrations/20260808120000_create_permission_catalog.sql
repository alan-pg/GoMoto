-- ============================================================
-- ADR 0022 §2 — Catálogo global de permissões por módulo.
-- Seed apenas: nenhum caminho de autorização em V1 consulta
-- estas tabelas — RLS/guards continuam checando role fixo direto.
-- ============================================================

CREATE TABLE permission_modules (
    code        VARCHAR(40) PRIMARY KEY,
    label_pt    VARCHAR(80) NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_code VARCHAR(40) NOT NULL REFERENCES permission_modules(code) ON DELETE CASCADE,
    action      VARCHAR(20) NOT NULL CHECK (action IN ('view', 'create', 'edit', 'delete')),
    UNIQUE (module_code, action)
);

CREATE TABLE role_permissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_role   VARCHAR(20) NOT NULL CHECK (system_role IN ('owner', 'admin', 'operator', 'viewer')),
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE (system_role, permission_id)
);

CREATE INDEX idx_permissions_module_code ON permissions(module_code);
CREATE INDEX idx_role_permissions_role ON role_permissions(system_role);

-- Global, leitura livre (dado não sensível), escrita só via migration/service_role.
ALTER TABLE permission_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permission_modules_read" ON permission_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY "permissions_read" ON permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_read" ON role_permissions FOR SELECT TO authenticated USING (true);

-- ============================================================
-- SEED — vocabulário de módulos (PRD 0011 §2)
-- ============================================================
INSERT INTO permission_modules (code, label_pt, sort_order) VALUES
    ('fleet',       'Frota',          1),
    ('customers',   'Clientes',       2),
    ('contracts',   'Contratos',      3),
    ('financial',   'Financeiro',     4),
    ('maintenance', 'Manutenção',     5),
    ('inspection',  'Vistoria',       6),
    ('users',       'Usuários',       7),
    ('settings',    'Configurações',  8);

INSERT INTO permissions (module_code, action)
SELECT pm.code, a.action
FROM permission_modules pm
CROSS JOIN unnest(ARRAY['view', 'create', 'edit', 'delete']) AS a(action);

-- ============================================================
-- SEED — mapeamento papel fixo → permissão.
-- Primeira aproximação documental (V1 não aplica isso em runtime;
-- ao construir V2, validar contra o comportamento real de cada
-- guard antes de expor num construtor de papel).
-- ============================================================
INSERT INTO role_permissions (system_role, permission_id)
SELECT 'viewer', id FROM permissions WHERE action = 'view';

INSERT INTO role_permissions (system_role, permission_id)
SELECT 'operator', id FROM permissions
WHERE action IN ('view', 'create', 'edit')
  AND module_code IN ('fleet', 'customers', 'contracts', 'maintenance', 'inspection')
UNION
SELECT 'operator', id FROM permissions WHERE action = 'view' AND module_code = 'financial';

INSERT INTO role_permissions (system_role, permission_id)
SELECT 'admin', id FROM permissions;

INSERT INTO role_permissions (system_role, permission_id)
SELECT 'owner', id FROM permissions;
