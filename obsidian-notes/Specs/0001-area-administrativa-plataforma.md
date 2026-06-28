---
status: aprovado
versão: 1.1
modo: completo
autor: Alan (com agente IA)
data: 2026-06-27
prd: "[[PRDs/0001-area-administrativa-plataforma]]"
adr:
  - "[[decisions/0003-escopo-e-auth-do-mobile-cliente]]"
  - "[[decisions/0004-control-plane-e-identidade-do-cliente]]"
related:
  - "[[Arquitetura Proposta]]"
  - "[[Banco de Dados]]"
  - "[[Segurança]]"
tags:
  - spec
  - plataforma
  - multi-tenant
  - autenticacao
---

# Spec 0001 — Área Administrativa da Plataforma e Identidade de Usuários

> ✅ **Status: aprovado** em 2026-06-27 (v1.1). Spec técnica derivada de [[PRDs/0001-area-administrativa-plataforma]] (v2.1). Remove §3.2 (dual-role), `select-context/page.tsx` e `api/switch-context/route.ts`. Adiciona migration de constraint de exclusividade entre `platform_admins` e `tenant_members`.

---

## 1. Visão Geral Técnica

Esta Spec cobre três grupos de trabalho derivados do PRD 0001:

**A — Correção de isolamento de tenant (bug crítico):** `getCurrentTenantId()` em `apps/web/src/lib/auth/tenant.ts` faz `LIMIT 1` sem `ORDER BY` e não checa suspensão — o tenant resolvido pode ser o errado quando o usuário tem múltiplos vínculos ou quando a plataforma cresceu com registros fora de ordem. A correção é server-side: ordenar por `created_at ASC` e adicionar verificação de suspensão no layout do dashboard (não no middleware, para não onerar cada request).

**B — Validação matemática de CPF ausente:** `isCpfDigits()` em `packages/core` verifica apenas 11 dígitos de formato, sem o algoritmo módulo-11. RF-016 e RF-022 exigem validação do dígito verificador antes de qualquer chamada ao servidor. Fix: adicionar `validateCpfDigits()` ao `@gomoto/core` e um segundo `.refine()` no schema `cpfDigitsString`.

**C — Funcionalidades novas do PRD:** (1) Painel de KPIs no Control Plane via RPC `get_platform_kpis()`; (2) links de convite/reset com `expiresIn` correto; (3) regeneração de link do owner pelo Platform Admin; (4) badge de tenant suspenso na tela `select-tenant` do mobile; (5) auto-link cross-tenant em `createCustomer` via `service_role`; (6) constraint de exclusividade entre `platform_admins` e `tenant_members` no banco.

**Componentes envolvidos:** `packages/core/src/identity/`, `packages/core/src/schemas/`, `apps/web/src/app/(admin)/admin/`, `apps/web/src/app/(dashboard)/`, `apps/web/src/middleware.ts`, `apps/mobile/src/contexts/auth.tsx`, `apps/mobile/app/select-tenant.tsx`, `supabase/migrations/`.

---

## 2. Arquitetura

### 2.1 Contexto

O GoMoto opera com três planos de usuário:

```
                    ┌─────────────────────────────┐
                    │       Control Plane          │
                    │  (Platform Admin — web only) │
                    └────────────┬────────────────┘
                                 │ cria / suspende tenants
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       ┌────────────┐    ┌────────────┐    ┌────────────┐
       │  Tenant A  │    │  Tenant B  │    │  Tenant N  │
       │ (Tenant    │    │  (Tenant   │    │  (Tenant   │
       │  Plane)    │    │   Plane)   │    │   Plane)   │
       └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
             │                 │                  │
             └────────┬────────┘                  │
                      ▼                           │
              ┌────────────────┐                  │
              │ Cliente Final  │──────────────────┘
              │ (mobile app)   │  pode ter vínculo em N tenants
              └────────────────┘
```

Cada plano é isolado por RLS. O contexto de tenant é sempre resolvido no servidor a partir da identidade autenticada, nunca do cliente.

### 2.2 Componentes

**Novos / modificados:**

- `packages/core/src/identity/index.ts` — adiciona `validateCpfDigits(digits: string): boolean` (algoritmo módulo-11)
- `packages/core/src/identity/index.test.ts` — testes para `validateCpfDigits`
- `packages/core/src/schemas/index.ts` — `cpfDigitsString` recebe segundo `.refine(validateCpfDigits)`
- `apps/web/src/lib/auth/tenant.ts` — `getCurrentTenantId` corrigido (ORDER BY + campo `suspended_at`)
- `apps/web/src/middleware.ts` — proteção das rotas `/admin/*` (requer `is_platform_admin`); sem cookie de contexto (dual-role removido)
- `apps/web/src/app/(admin)/admin/page.tsx` — painel KPIs via `get_platform_kpis()` RPC
- `apps/web/src/app/(admin)/admin/empresas/actions.ts` — `regenerateOwnerLink(tenantId)`
- `apps/web/src/app/(dashboard)/layout.tsx` — verificação de suspensão do tenant (uma vez por navegação)
- `apps/web/src/app/(dashboard)/clientes/actions.ts` — `createCustomer` com cross-tenant lookup; `inviteCustomerToApp` e `resetCustomerPassword` com `expiresIn`
- `apps/mobile/src/contexts/auth.tsx` — `signIn` chama `validateCpfDigits` antes de ir ao servidor
- `apps/mobile/app/select-tenant.tsx` — badge "Temporariamente indisponível" para tenants suspensos
- `supabase/migrations/<ts>_customers_cpf_per_tenant_unique.sql` — troca `UNIQUE(cpf)` global por `UNIQUE(tenant_id, cpf)`
- `supabase/migrations/<ts>_create_platform_kpis_rpc.sql` — função `get_platform_kpis()` SECURITY DEFINER
- `supabase/migrations/<ts>_enforce_role_exclusivity.sql` — **nova** — triggers que impedem o mesmo user_id de estar em `platform_admins` e `tenant_members` simultaneamente

### 2.3 Responsabilidades

| Camada | Responsabilidade |
|---|---|
| `packages/core` | Validação pura (CPF formato + dígito verificador); schemas Zod canônicos |
| Server Actions (`actions.ts`) | Resolução server-side de `tenant_id`, validação Zod, mutação no Supabase, `logAction`/`logPlatformAction`, `revalidatePath` |
| RLS (Supabase) | Isolamento de dados — última linha de defesa; não depende de validação do app |
| Middleware (`middleware.ts`) | Proteção de rotas `/admin/*` (checar `is_platform_admin`); redirecionamento pós-login simples: platform_admin → `/admin/dashboard`, demais → `/dashboard` |
| Layout `(dashboard)/layout.tsx` | Verificar `tenant.suspended_at` uma vez por navegação — exibir tela de indisponibilidade se suspenso |
| Mobile `AuthProvider` | Validação de CPF no dispositivo; seleção de contexto de tenant; routing pós-login |
| DB Triggers | `trg_platform_admin_not_tenant_member` e `trg_tenant_member_not_platform_admin` — enforçam exclusividade mútua em nível de banco |

---

## 3. Fluxos Técnicos

### 3.1 Fluxo A — Onboarding de nova empresa (Platform Admin)

```
Platform Admin                apps/web                          Supabase
     │                            │                                 │
     │──── POST createTenant ─────▶                                 │
     │                            │── requirePlatformOwner() ──────▶│
     │                            │◀─── ok ─────────────────────────│
     │                            │── CreateTenantWithOwnerSchema ──│  (valida localmente)
     │                            │── RPC create_tenant_with_owner ─▶│
     │                            │   (cria tenant + auth.users     │
     │                            │    + tenant_members owner)      │
     │                            │◀─── { tenant_id, owner_id } ───│
     │                            │── admin.generateLink(invite,    │
     │                            │   expiresIn: 259200) ──────────▶│
     │                            │◀─── { action_link } ───────────│
     │                            │── logPlatformAction(create_     │
     │                            │   tenant) ─────────────────────▶│
     │◀─── { link } ──────────────│                                 │
     │  (envia manualmente ao     │                                 │
     │   owner via WhatsApp)      │                                 │
```

**Fluxo 3.1-B — Regeneração de link do owner (RF-029):**

`regenerateOwnerLink(tenantId)`:
1. `requirePlatformAdmin(supabase)`
2. Busca owner do tenant em `tenant_members WHERE role = 'owner'`
3. Busca `customers` do owner para obter email OU usa `tenant_members.user_id` → `auth.users.email`
4. `admin.generateLink({ type: 'magiclink', email, options: { expiresIn: 259200 } })`
5. `logPlatformAction('regenerate_owner_link', 'tenant', tenantId)`
6. Retorna `{ link }`

**Fluxo 3.1-C — Suspensão de empresa (RF-004):**

`suspendTenant(tenantId, rawReason)`:
1. `requirePlatformOwner(supabase)` — só Owner pode suspender
2. `TenantSuspendSchema.parse({ reason })` — motivo obrigatório
3. `UPDATE tenants SET suspended_at = NOW(), suspended_reason = reason, suspended_by = user.id`
4. `logPlatformAction('suspend_tenant', 'tenant', tenantId, { reason })`
5. `revalidatePath('/admin/empresas')`

---

### 3.2 Fluxo B — Redirecionamento pós-login (RF-013)

```
Usuário web                   middleware.ts               Supabase
     │                            │                          │
     │── GET /login (pós-auth) ───▶                          │
     │                            │── getUser() ────────────▶│
     │                            │◀─── { user } ───────────│
     │                            │── get_platform_role() ──▶│
     │                            │◀─── 'owner'|'operator'  │
     │                            │     OR null             │
     │                            │                          │
     │        [platform_admin]    │                          │
     │◀── redirect /admin/dashboard                          │
     │                            │                          │
     │        [tenant_member]     │                          │
     │◀── redirect /dashboard ────│                          │
```

- Nenhum cookie de contexto. O redirecionamento é determinístico: platform_admin → `/admin/dashboard`, todos os demais → `/dashboard`.
- O mesmo email não pode ser ao mesmo tempo platform_admin e tenant_member — impedido por trigger no banco.

---

### 3.3 Fluxo C — Isolamento de tenant e suspensão

**3.3-A — Correção de `getCurrentTenantId`:**

```ts
// apps/web/src/lib/auth/tenant.ts (versão corrigida)
export async function getCurrentTenantId(client: SupabaseClient): Promise<string | null> {
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null

  const { data } = await client
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })  // determinístico
    .limit(1)
    .single()

  return data?.tenant_id ?? null
}
```

**3.3-B — Verificação de suspensão no layout:**

```ts
// apps/web/src/app/(dashboard)/layout.tsx
const tenantId = await getCurrentTenantId(supabase)
if (!tenantId) redirect('/login')

const { data: tenant } = await supabase
  .from('tenants')
  .select('id, name, suspended_at')
  .eq('id', tenantId)
  .single()

if (tenant?.suspended_at) {
  return <TenantSuspendedPage tenantName={tenant.name} />
}
```

**3.3-C — Proteção `/admin/*` no middleware:**

```ts
// middleware.ts — adicionar antes do redirect pós-login
if (pathname.startsWith('/admin')) {
  const role = await getPlatformRole(supabase)  // SECURITY DEFINER, cached
  if (!role) {
    return NextResponse.rewrite(new URL('/404', request.url))
  }
}
```

---

### 3.4 Fluxo D — Login do cliente final (mobile)

**3.4-A — Login com CPF + validação local (RF-015, RF-016):**

```ts
// apps/mobile/src/contexts/auth.tsx — signIn (trecho modificado)
const digits = normalizeCpf(cpf)
if (!isCpfDigits(digits)) {
  return { error: 'CPF precisa ter 11 dígitos.' }
}
if (!validateCpfDigits(digits)) {           // novo — módulo-11
  return { error: 'CPF inválido: dígito verificador incorreto.' }
}
const email = cpfShellEmail(digits)
const { error } = await supabase.auth.signInWithPassword({ email, password })
if (error) return { error: 'CPF ou senha incorretos.' }  // mensagem genérica (RF-017)
```

**3.4-B — Tela de seleção (RF-019) — badge de suspenso:**

```tsx
// apps/mobile/app/select-tenant.tsx
{tenants.map(t => (
  <TenantCard
    key={t.tenant_id}
    name={t.tenant_name}
    disabled={!!t.suspended_at}
    badge={t.suspended_at ? 'Temporariamente indisponível' : undefined}
    onPress={() => !t.suspended_at && selectTenant(t.tenant_id)}
  />
))}
```

---

### 3.5 Fluxo E — Cadastro de cliente pelo operador

**Cross-tenant auto-link (RF-023):**

```ts
// apps/web/src/app/(dashboard)/clientes/actions.ts — createCustomer (trecho adicionado)
const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
const cpfEmail = cpfShellEmail(parsed.data.cpf)

// lookup cross-tenant: auth.users não tem RLS
const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const existing = list?.users.find(u => u.email?.toLowerCase() === cpfEmail)

const { data, error } = await supabase
  .from('customers')
  .insert({
    ...parsed.data,
    tenant_id: tenantId,
    user_id: existing?.id ?? null,   // vincula se já existe
    in_queue: false,
  })
  .select()
  .single()

// se vinculou: retornar { data, alreadyLinked: true } para o operador exibir aviso (RF-024)
```

**Links com expiração correta (RF-027, RF-028):**

- `inviteCustomerToApp` (tipo `invite` ou `magiclink`): `options: { expiresIn: 259200, redirectTo: MOBILE_REDIRECT }` — 72h
- `resetCustomerPassword` (tipo `recovery`): `options: { expiresIn: 3600, redirectTo: MOBILE_REDIRECT }` — 1h

---

### 3.6 Fluxos de falha

| Situação | Resposta do sistema |
|---|---|
| Email de owner já em uso ao criar tenant | `createTenant` recebe `23505` do Supabase → `{ ok: false, error: { code: 'EMAIL_IN_USE', message: 'Email já cadastrado no sistema.' } }` |
| Slug de empresa duplicado | Idem com `code: 'SLUG_IN_USE'` |
| `tenant_id` não encontrado em `getCurrentTenantId` | `redirect('/login')` no layout |
| Tenant suspenso detectado no layout | Render de `<TenantSuspendedPage />` — sem redirect, sem loop |
| CPF com dígito verificador errado (mobile) | Erro local antes de chamada de rede — `'CPF inválido: dígito verificador incorreto.'` |
| `service_role` key ausente em `createCustomer` | `{ ok: false, error: { code: 'CONFIG_ERROR', message: 'Configuração do servidor incompleta.' } }` |
| `generateLink` falha (Auth rate limit) | Propaga `error.message` do Supabase — operador tenta novamente |
| RLS bloqueia read cross-tenant | Supabase retorna vazio (row não encontrada) → 404 no app, sem mensagem que revele o tenant |

---

## 4. Modelo de Dados

### 4.1 Entidades

| Entidade | Status | O que muda |
|---|---|---|
| `tenants` | Existente | Nenhuma coluna nova — `suspended_at/reason/by` já existe |
| `customers` | Existente — **constraint alterada** | Drop `UNIQUE(cpf)` global → `UNIQUE(tenant_id, cpf)` composto |
| `platform_admins` | Existente — **triggers adicionados** | `trg_platform_admin_not_tenant_member` impede inserção de user_id já em `tenant_members` |
| `platform_audit_logs` | Existente | Sem alteração |
| `tenant_members` | Existente — **triggers adicionados** | `trg_tenant_member_not_platform_admin` impede inserção de user_id já em `platform_admins` |
| `get_platform_kpis()` | **Nova** | RPC SECURITY DEFINER — agregação global |

### 4.2 Campos (SQL concreto)

#### Migration 1 — `customers_cpf_per_tenant_unique`

```sql
-- Pré-requisito: verificar ausência de CPFs duplicados entre tenants
-- SELECT cpf, COUNT(*) FROM customers WHERE cpf IS NOT NULL GROUP BY cpf HAVING COUNT(*) > 1;

-- Troca constraint global por constraint composta (permite mesmo CPF em tenants distintos)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_cpf_key;

CREATE UNIQUE INDEX customers_tenant_cpf_unique
  ON customers(tenant_id, cpf)
  WHERE cpf IS NOT NULL;

-- Índice composto tenant_id+user_id já existe (customers_tenant_user_unique)
-- Nenhuma alteração necessária.
```

#### Migration 2 — `create_platform_kpis_rpc`

```sql
CREATE OR REPLACE FUNCTION get_platform_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'tenants_active',    (SELECT COUNT(*) FROM tenants WHERE suspended_at IS NULL),
    'tenants_suspended', (SELECT COUNT(*) FROM tenants WHERE suspended_at IS NOT NULL),
    'motorcycles_total', (SELECT COUNT(*) FROM motorcycles),
    'contracts_active',  (SELECT COUNT(*) FROM contracts WHERE status = 'active'),
    'billings_overdue',  (SELECT COUNT(*) FROM billings WHERE status = 'overdue')
  );
END;
$$;
```

#### Migration 3 — `enforce_role_exclusivity`

```sql
-- Impede que um mesmo user_id exista em platform_admins e tenant_members simultaneamente.
-- Enforça RN-015: os papéis são mutuamente exclusivos.

CREATE OR REPLACE FUNCTION check_not_tenant_member()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_members WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Usuário já é membro de tenant e não pode ser Platform Admin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_admin_not_tenant_member
  BEFORE INSERT ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION check_not_tenant_member();

CREATE OR REPLACE FUNCTION check_not_platform_admin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Usuário já é Platform Admin e não pode ser membro de tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_member_not_platform_admin
  BEFORE INSERT ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION check_not_platform_admin();
```

### 4.3 Relacionamentos, índices e RLS

**Índices críticos:**

```sql
-- Já existente — garante determinismo no getCurrentTenantId corrigido:
-- idx_tenant_members_user_id ON tenant_members(user_id)
-- Nenhum índice novo necessário.
```

**RLS — resumo das políticas relevantes:**

| Tabela | Política | Regra |
|---|---|---|
| `customers` | `tenant_isolation_customers` | `tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND ...)` via `get_user_tenants()` |
| `customers` | `platform_admin_bypass_customers` | `is_platform_admin()` |
| `platform_audit_logs` | `platform_audit_logs_read` | `is_platform_admin()` |
| `platform_audit_logs` | `platform_audit_logs_insert` | `is_platform_admin() AND actor_id = auth.uid()` |
| `platform_audit_logs` | *(sem UPDATE/DELETE)* | Imutabilidade garantida por ausência de política |
| `tenants` | `platform_admin_manage_tenants` | `is_platform_admin()` |

**`get_user_tenants()` — comportamento:**
Filtra membros de tenants **não suspensos** (`tenants.suspended_at IS NULL`). Membros de tenants suspensos recebem conjunto vazio via RLS — dados inacessíveis por construção, sem código adicional no app.

---

## 5. APIs

### 5.1 Server Actions

**Control Plane — `apps/web/src/app/(admin)/admin/empresas/actions.ts`:**

| Action | Guard | Descrição |
|---|---|---|
| `createTenant(rawData)` | `requirePlatformOwner` | Cria tenant + owner + gera link 72h |
| `updateTenant(id, rawData)` | `requirePlatformAdmin` | Atualiza dados da empresa |
| `suspendTenant(id, rawData)` | `requirePlatformOwner` | Suspende com motivo obrigatório |
| `reactivateTenant(id)` | `requirePlatformOwner` | Reativa empresa suspensa |
| `regenerateOwnerLink(id)` | `requirePlatformAdmin` | **Nova** — gera novo link magiclink para owner |

**Control Plane — `apps/web/src/app/(admin)/admin/platform-admins/actions.ts`:**

| Action | Guard | Descrição |
|---|---|---|
| `addPlatformAdmin(rawData)` | `requirePlatformOwner` | Promove usuário existente |
| `setPlatformAdminRole(id, role)` | `requirePlatformOwner` | Altera papel |
| `removePlatformAdmin(id)` | `requirePlatformOwner` | Remove da plataforma |

**Tenant Plane — `apps/web/src/app/(dashboard)/clientes/actions.ts`:**

| Action | Mudança | Descrição |
|---|---|---|
| `createCustomer(rawData)` | Cross-tenant lookup via `service_role` | RF-023: vincula CPF existente |
| `inviteCustomerToApp(id)` | `expiresIn: 259200` adicionado | Link 72h |
| `resetCustomerPassword(id)` | `expiresIn: 3600` adicionado | Link 1h |

### 5.2 Schemas Zod (`@gomoto/core`)

**`packages/core/src/identity/index.ts` — nova função:**

```ts
export function validateCpfDigits(digits: string): boolean {
  if (!isCpfDigits(digits)) return false
  // rejeita sequências trivialmente inválidas (000...0, 111...1, etc.)
  if (/^(\d)\1{10}$/.test(digits)) return false

  const calcDigit = (slice: string, weight: number) => {
    const sum = slice.split('').reduce((acc, d, i) => acc + Number(d) * (weight - i), 0)
    const rem = (sum * 10) % 11
    return rem === 10 ? 0 : rem
  }

  const d1 = calcDigit(digits.slice(0, 9), 10)
  const d2 = calcDigit(digits.slice(0, 10), 11)
  return d1 === Number(digits[9]) && d2 === Number(digits[10])
}
```

**`packages/core/src/schemas/index.ts` — `cpfDigitsString` atualizado:**

```ts
const cpfDigitsString = z
  .string({ error: 'CPF é obrigatório' })
  .transform((input) => normalizeCpf(input))
  .refine((digits) => isCpfDigits(digits), { message: 'CPF inválido: precisa ter 11 dígitos' })
  .refine((digits) => validateCpfDigits(digits), { message: 'CPF inválido: dígito verificador incorreto' })
```

**Schemas existentes (sem alteração de contrato):**

- `CreateTenantWithOwnerSchema` — já inclui `owner.password`; V1 completo
- `TenantSuspendSchema` — `reason: z.string().trim().min(1)`
- `CustomerSchema` — herda `cpfDigitsString` atualizado automaticamente

### 5.3 Erros

| Código | Quando ocorre | Resposta |
|---|---|---|
| `VALIDATION_ERROR` | Schema Zod falhou | `{ ok: false, error: { code, message, field? } }` |
| `UNAUTHORIZED` | Sem sessão ativa | redirect `/login` ou `{ ok: false, error: { code: 'UNAUTHORIZED' } }` |
| `FORBIDDEN` | Role insuficiente (Operator tentando ação Owner) | `{ ok: false, error: { code: 'FORBIDDEN', message: 'Ação restrita ao Owner da plataforma.' } }` |
| `EMAIL_IN_USE` | Email de owner já cadastrado | `{ ok: false, error: { code: 'EMAIL_IN_USE', message: 'Email já cadastrado no sistema.' } }` |
| `SLUG_IN_USE` | Slug de tenant duplicado | `{ ok: false, error: { code: 'SLUG_IN_USE' } }` |
| `CONFIG_ERROR` | `SUPABASE_SERVICE_ROLE_KEY` ausente | `{ ok: false, error: { code: 'CONFIG_ERROR' } }` — não expor detalhes ao cliente |
| `NOT_FOUND` | Tenant ou recurso não encontrado pelo RLS | `{ ok: false, error: { code: 'NOT_FOUND' } }` — sem revelar existência |

---

## 6. Segurança

### 6.1 Autenticação

**Dois mecanismos independentes (RN-003):**

| Mecanismo | Usuários | Implementação |
|---|---|---|
| Email + senha | Platform Admins, membros de tenant (web) | Supabase Auth padrão |
| CPF + senha | Clientes finais (mobile) | Shell email `cpfShellEmail(cpf)` → Supabase Auth |

O shell email (`<11dígitos>@cliente.gomoto.app`) nunca é exposto ao cliente final — é um detalhe de implementação invisível. O cliente sempre enxerga CPF.

**Contexto de tenant — determinado pelo servidor (RN-004):**
`getCurrentTenantId(supabase)` usa `auth.uid()` server-side para resolver o tenant. Nenhum valor do cliente é aceito como `tenant_id`.

**Exclusividade de papel:** platform_admin e tenant_member são mutuamente exclusivos para o mesmo user_id. Enforçado por triggers no banco (`trg_platform_admin_not_tenant_member`, `trg_tenant_member_not_platform_admin`) e validado nas Server Actions de criação de tenant e promoção de Platform Admin.

### 6.2 Autorização

**RLS como última linha de defesa:** mesmo que o código do app tenha bug, o RLS garante que os dados retornados pertencem ao tenant correto do usuário autenticado.

**Hierarquia de roles:**

| Role | Pode fazer |
|---|---|
| Platform Admin Owner | Tudo no Control Plane + criar/suspender/reativar tenants + gerenciar Platform Admins |
| Platform Admin Operator | Ler Control Plane + ações operacionais (sem criar/suspender/remover admins) |
| Tenant Owner | Tudo dentro do próprio tenant |
| Tenant Admin/Operator/Viewer | Subconjunto das ações do tenant (definido em `tenant_members.role`) |
| Cliente Final | Somente leitura dos próprios dados no contexto de tenant ativo |

**Guards no app (complementam RLS):**

```ts
// apps/web/src/lib/auth/platform.ts
export async function requirePlatformOwner(client: SupabaseClient) {
  const role = await getPlatformRole(client)  // SECURITY DEFINER
  if (role !== 'owner') throw new Error('FORBIDDEN')
}
```

**Rotas `/admin/*`:** protegidas no middleware — qualquer usuário sem `is_platform_admin() = true` recebe 404 (RF-014, RN-004). A existência das rotas não é revelada.

### 6.3 Auditoria

**`platform_audit_logs` — audit log do Control Plane (RF-009, RN-021, RN-022):**

Registro imutável de toda ação sensível no Control Plane. Separado de `audit_logs` (operacional por tenant).

```ts
// Assinatura de logPlatformAction (nova função em apps/web/src/lib/audit.ts)
async function logPlatformAction(params: {
  action: string          // ex.: 'create_tenant', 'suspend_tenant', 'regenerate_owner_link'
  targetType: string      // ex.: 'tenant', 'platform_admin'
  targetId: string        // UUID do alvo
  metadata?: Record<string, unknown>  // ex.: { reason: '...' }
}): Promise<void>
```

Chamado em **toda** Server Action do Control Plane. A imutabilidade é garantida pela ausência de políticas UPDATE/DELETE na tabela — não há código de proteção, é estrutural no RLS.

**Ações auditadas:**

| Ação | `action` | `target_type` |
|---|---|---|
| Criar empresa | `create_tenant` | `tenant` |
| Suspender empresa | `suspend_tenant` | `tenant` |
| Reativar empresa | `reactivate_tenant` | `tenant` |
| Regenerar link do owner | `regenerate_owner_link` | `tenant` |
| Adicionar Platform Admin | `add_platform_admin` | `platform_admin` |
| Alterar papel de admin | `set_platform_admin_role` | `platform_admin` |
| Remover Platform Admin | `remove_platform_admin` | `platform_admin` |

---

## 7. Observabilidade

### 7.1 Logs essenciais

Toda Server Action bem-sucedida chama `logAction` (tenant plane) ou `logPlatformAction` (control plane) — esses logs são o rastro estruturado de operações críticas. Campos obrigatórios: `actor_id`, `action`, `target_type`, `target_id`, `metadata` (sem PII bruta — apenas IDs e status).

Eventos adicionais a logar no servidor (via `console.error` ou logger estruturado):

| Evento | Nível | Campos |
|---|---|---|
| `getCurrentTenantId` retorna null para usuário autenticado | WARN | `user_id`, `path` |
| Tenant suspenso detectado no layout | INFO | `tenant_id`, `user_id` |
| `service_role` key ausente em produção | ERROR | `action`, `path` |
| `generateLink` falha (Supabase Auth) | ERROR | `customer_id`, `error_code` |
| CPF com dígito verificador inválido aceito pelo servidor (não deveria chegar) | WARN | `tenant_id`, CPF **não logar** |

### 7.2 Métricas e alertas

N/A — feature não crítica de throughput. Monitoring de disponibilidade via Vercel dashboard + Supabase status page.

---

## 8. Performance e Escalabilidade

Sem requisitos materiais de implementação nova. RNF-001, RNF-002, RNF-003 cobertos por:
- Supabase com índices existentes em `tenant_members(user_id)`, `customers(tenant_id)`
- Novo índice `customers_tenant_cpf_unique` melhora lookup por CPF dentro do tenant
- `get_platform_kpis()` usa `COUNT(*)` em tabelas sem filtro complexo — suficiente para o volume atual

---

## 9. Test Strategy

### 9.1 Unit tests (Vitest em `packages/core`)

**`packages/core/src/identity/index.test.ts` — bloco novo:**

```ts
describe('validateCpfDigits', () => {
  it('aceita CPF válido', () => expect(validateCpfDigits('52998224725')).toBe(true))
  it('rejeita CPF com dígito verificador errado', () => expect(validateCpfDigits('52998224726')).toBe(false))
  it('rejeita sequência trivial (111...1)', () => expect(validateCpfDigits('11111111111')).toBe(false))
  it('rejeita string vazia / curta', () => expect(validateCpfDigits('123')).toBe(false))
})
```

**`packages/core/src/schemas/index.test.ts` — verificar integração:**

```ts
describe('CustomerSchema CPF', () => {
  it('aceita CPF válido', () => expect(CustomerSchema.safeParse({ ...base, cpf: '529.982.247-25' }).success).toBe(true))
  it('rejeita CPF com dígito verificador errado', () => {
    const r = CustomerSchema.safeParse({ ...base, cpf: '529.982.247-26' })
    expect(r.success).toBe(false)
    expect(r.error?.flatten().fieldErrors.cpf).toContain('dígito verificador incorreto')
  })
})
```

### 9.2 E2E tests (Playwright em `apps/web`)

**Arquivo sugerido: `apps/web/tests/spec-0001-tenant-isolation.spec.ts`**

| Cenário | CA | Passos |
|---|---|---|
| Tenant B não vê dados do Tenant A | CA-011 | Login com user-B → assert que API retorna somente registros com `tenant_id = tenantB` |
| Cross-tenant por ID manipulado → 404 | CA-012 | Autenticado como Tenant B, GET `/clientes/<id-de-A>` → assert "não encontrado" |
| Membro vê tela de suspensão | CA-013 | Suspender Tenant A → login com membro-A → assert `<TenantSuspendedPage>` visível |
| Não-admin acessa `/admin` → 404 | CA-016 | Login com user-tenant → GET `/admin` → assert status 404 |
| Criar empresa + link | CA-001 | Login como Platform Admin Owner → criar empresa → assert link retornado e audit log criado |
| Suspender sem motivo bloqueado | CA-005 | POST `suspendTenant` sem `reason` → assert erro de validação Zod |
| Regenerar link do owner | CA-029 | `regenerateOwnerLink(tenantId)` → assert link retornado + audit log |
| CPF duplicado cross-tenant no cadastro | CA-024 | Cadastrar cliente com CPF já em outro tenant → assert `alreadyLinked: true` + sem novo auth.user |

### 9.3 Integration / Contract

N/A — Unit + E2E suficientes. `service_role` calls testadas via E2E em ambiente Supabase local (`pnpm db:reset`).

---

## 10. Deploy e Rollback

### Ordem de deploy

```
1. pnpm db:reset (local) → validar migrations
2. Pré-check em produção (ver abaixo)
3. supabase db push → migrations em ordem:
     a. <ts>_customers_cpf_per_tenant_unique.sql
     b. <ts>_create_platform_kpis_rpc.sql
4. Deploy web (Vercel) → middleware + pages + actions
5. Deploy mobile (Expo) → @gomoto/core atualizado + select-tenant + AuthProvider
```

Não há feature flag. Todas as mudanças são correções — nenhuma habilita comportamento novo que precise ser gradual.

### Pré-check obrigatório antes de migrar produção

```sql
-- Rodar via Supabase Studio antes do push
SELECT cpf, COUNT(*) as ocorrencias
FROM customers
WHERE cpf IS NOT NULL
GROUP BY cpf
HAVING COUNT(*) > 1;
-- Se retornar linhas: auditar antes de aplicar a migration.
-- Se retornar vazio: seguro prosseguir.
```

### Rollback

**Web (Vercel):** "Instant Rollback" no dashboard — reverte middleware, pages e actions automaticamente.

**Mobile (Expo):** reverter `validateCpfDigits` no `packages/core` → rebuild → distribuição via OTA (Expo Updates) ou nova submissão.

**Migrations:**

```sql
-- Rollback migration 1 (somente se nenhum CPF duplicado foi inserido após o deploy)
DROP INDEX IF EXISTS customers_tenant_cpf_unique;
ALTER TABLE customers ADD CONSTRAINT customers_cpf_key UNIQUE(cpf);

-- Rollback migration 2
DROP FUNCTION IF EXISTS get_platform_kpis();
```

> **Restrição:** o rollback da migration 1 só é viável se nenhum cliente com CPF duplicado entre tenants foi cadastrado após o deploy. Se já houver, a recriação do constraint global falha com `23505`. Nesse caso: manter a migration nova e investigar os dados.

---

## 11. Riscos Técnicos e Questões Abertas

### 11.1 Riscos

**R1 — Migration `customers_tenant_cpf_unique` falha em produção se há CPFs duplicados**
- **Prob/Impacto:** baixa / alto
- **Mitigação:** pré-check obrigatório documentado em §10 antes do `supabase db push`. Em ambiente local e seed atual: nenhum duplicado.

**R2 — `listUsers({ page: 1, perPage: 1000 })` não escala além de ~1000 usuários auth**
- Afeta `setCustomerPassword` e `inviteCustomerToApp`. Lookup linear por `cpfShellEmail` falha silenciosamente após ~1001 usuários.
- **Prob/Impacto:** nula agora / alto futuro
- **Mitigação V1:** manter como está; documentar como dívida técnica. Fix futuro: query direta via RPC em `auth.users` por email com `service_role`.

**R3 — RF-023: auto-link cross-tenant requer `service_role` em `createCustomer`** *(implementação incompleta)*
- A ação atual não implementa o lookup cross-tenant. O comportamento atual: cliente cadastrado sem `user_id`, operador precisa convidá-lo manualmente depois.
- **Prob/Impacto:** média (UX degradada, não bug de segurança)
- **Fix prescrito:** após INSERT em `createCustomer`, chamar `supabaseAdmin.auth.admin.listUsers` filtrado por `cpfShellEmail` e, se encontrar, fazer UPDATE `{ user_id }`. Retornar `alreadyLinked: true`.

**R4 — `inviteCustomerToApp` bloqueia regeneração se `user_id` já está setado**
- `clientes/actions.ts:150`: guard que retorna erro se cliente já tem `user_id`. Impede regeneração de link para cliente que esqueceu a senha mas já estava vinculado.
- **Mitigação:** operador usa `resetCustomerPassword` (recovery link) — fluxo funciona, apenas não é óbvio.
- **Fix opcional V1:** remover o guard e sempre gerar `magiclink` quando `user_id` existe.

**R5 — Suspensão de tenant não reflete imediatamente no cliente logado** *(aceito)*
- Decisão explícita: verificação de suspensão no layout do dashboard, não no middleware. RLS bloqueia dados imediatamente — não há exposição de informação, apenas UX pode mostrar tela vazia por um ciclo de navegação.

### 11.2 Questões Abertas

- [ ] **QA-001** — Status `prejudice` nas KPIs (RF-008): cobranças com `status = 'prejudice'` devem aparecer como sub-categoria no painel ("em perda: R$ X") ou permanecem fora? Impacto: mudança no SQL de `get_platform_kpis()` antes do deploy.
- [ ] **QA-002** — RNF-004 (sessão web 8h / mobile 30 dias): configuração manual no Supabase Dashboard (Authentication > Settings). Incluir no checklist de go-live.
- [ ] **QA-003** — Links sem `expiresIn` (RF-027, RF-028): fix trivial em `inviteCustomerToApp` e `resetCustomerPassword` — adicionar `options.expiresIn` nas chamadas `generateLink`.

---

## 12. Matriz de Rastreabilidade e Aprovação

### 12.1 Requisitos Funcionais

| ID | Resumo | Seção(ões) | Artefato de implementação | CA(s) |
|---|---|---|---|---|
| RF-001 | Criar empresa com nome, slug e owner | §3.1-A, §5.1 | `empresas/actions.ts::createTenant` | CA-001, CA-002 |
| RF-002 | Link de senha do owner ao criar empresa (72h) | §3.1-B, §5.1 | `createTenant` + `generateLink(invite, expiresIn:259200)` | CA-001 |
| RF-003 | Listar empresas com filtro por status e busca | §3.1, §5.1 | `empresas/page.tsx` + `useTenants` hook | CA-003 |
| RF-004 | Suspender empresa com motivo obrigatório | §3.1-C, §5.1 | `suspendTenant` + `TenantSuspendSchema` | CA-004, CA-005 |
| RF-005 | Reativar empresa suspensa | §3.1-C, §5.1 | `reactivateTenant` | CA-006 |
| RF-006 | Visualizar membros do tenant em modo somente leitura | §3.1, §5.1 | `empresas/[id]/page.tsx` | CA-007 |
| RF-007 | Gerenciar Platform Admins (adicionar, remover, alterar papel) | §3.2, §5.1 | `platform-admins/actions.ts` | CA-008 |
| RF-008 | Painel de KPIs no Control Plane | §3.2, §4.2, §5.1 | RPC `get_platform_kpis()` + `admin/page.tsx` | CA-009 |
| RF-009 | Audit log imutável de ações do Control Plane | §4.3, §6.3 | `platform_audit_logs` + `logPlatformAction()` | CA-010 |
| RF-010 | Resolver tenant a partir da identidade autenticada no servidor | §2.2, §3.3-A | `auth/tenant.ts::getCurrentTenantId` corrigido | CA-011 |
| RF-011 | Usuário de tenant acessa somente dados do próprio tenant | §2.2, §4.3 | RLS `tenant_isolation_*` + `get_user_tenants()` | CA-011, CA-012 |
| RF-012 | Membro de tenant suspenso perde acesso na próxima requisição | §2.2, §3.3-B | `(dashboard)/layout.tsx` suspension check | CA-013 |
| RF-013 | Usuário com duplo papel vê seletor de contexto | §2.3, §3.2, §5.2 | Cookie `gomoto-context` + `/select-context` page | CA-015 |
| RF-014 | Não-Platform Admin recebe 404 em rotas do Control Plane | §2.2, §6.1 | Middleware + `(admin)/layout.tsx::requirePlatformAdmin` | CA-016 |
| RF-015 | Cliente final autentica com CPF e senha no mobile | §3.4-A | `AuthProvider.signIn` — já implementado | CA-017 |
| RF-016 | Validar CPF (formato + dígito verificador) no dispositivo | §3.4-A, §5.2 | `validateCpfDigits()` em `@gomoto/core` + `AuthProvider.signIn` | CA-017, CA-018 |
| RF-017 | Mensagem genérica em falha de autenticação mobile | §6.2 | `AuthProvider` — erro genérico "CPF ou senha incorretos" | CA-019 |
| RF-018 | Cliente com 1 vínculo vai direto ao dashboard | §3.4-A | `AuthProvider + RootGate` — já implementado | CA-020 |
| RF-019 | Cliente com ≥2 vínculos vê tela de seleção; suspenso como indisponível | §3.4-B | `select-tenant.tsx` (badge "Temporariamente indisponível") | CA-021 |
| RF-020 | Alternar empresa sem logout | §3.4-B | `AuthProvider.selectTenant` — já implementado | CA-022 |
| RF-021 | Contexto ativo exibe somente dados daquele tenant (mobile) | §4.3, §6.1 | `current_customer_ids()` RLS + hooks mobile | CA-022 |
| RF-022 | Validar CPF no cadastro de cliente (formato + dígito verificador) | §3.5, §5.2 | `cpfDigitsString.refine(validateCpfDigits)` em `@gomoto/core` | CA-023 |
| RF-023 | Vincular CPF existente ao tenant atual sem criar novo login | §3.5, §5.2 | `createCustomer` — cross-tenant lookup via `service_role` (R3) | CA-024 |
| RF-024 | Não revelar tenant de origem ao detectar CPF existente | §3.5, §6.2 | `createCustomer` — mensagem de aviso sem mencionar tenant | CA-024 |
| RF-025 | Gerar link de senha 72h para novo cliente | §3.5, §5.2 | `inviteCustomerToApp` com `expiresIn:259200` | CA-025 |
| RF-026 | Operador regenera link para cliente com link expirado | §3.5, §5.2 | `inviteCustomerToApp` — nova chamada | CA-027 |
| RF-027 | Links de definição de senha expiram em 72h | §3.1-B, §3.5, §5.2 | `expiresIn:259200` em todos os `generateLink` (owner + cliente) | CA-025, CA-026 |
| RF-028 | Link de redefinição de senha expira em 1h | §3.5, §5.2 | `resetCustomerPassword` com `expiresIn:3600` | CA-028 |
| RF-029 | Platform Admin regenera link de senha do owner | §3.2, §5.1 | `regenerateOwnerLink` em `empresas/actions.ts` | CA-029 |

### 12.2 Requisitos Não Funcionais

| ID | Resumo | Seção(ões) | Artefato / Observação |
|---|---|---|---|
| RNF-001 | Dashboard p95 < 3s (até 500 motos) | §8 — N/A | Sem implementação nova; coberto por Supabase + índices existentes |
| RNF-002 | Fluxo de auth p95 < 2s | §8 — N/A | Login direto via Supabase Auth; sem intermediário novo |
| RNF-003 | Tela de seleção mobile p95 < 1,5s | §8 — N/A | `fetchCustomerTenants` já cacheado em `AuthProvider` |
| RNF-004 | Sessão web 8h / mobile refresh token 30 dias | §6.1, §11.2 QA-002 | Configuração manual no Supabase Dashboard — checklist de go-live |
| RNF-005 | Rate limiting: 5 tentativas / 15 min | **Deferido** | Decisão explícita: não implementado no V1 |
| RNF-006 | Zero vazamento cross-tenant | §4.3, §6.1, §9.2 | RLS `tenant_isolation_*` + `get_user_tenants()` + testes CA-011, CA-012 |
| RNF-007 | Audit log do Control Plane imutável | §4.3, §6.3 | `platform_audit_logs` — sem políticas UPDATE/DELETE |
| RNF-008 | PII do cliente acessível só por membros do tenant | §4.3, §6.1 | RLS `tenant_isolation_customers` + `platform_admin_bypass_customers` |
| RNF-009 | Anti-enumeração: mensagem genérica em auth | §6.2 | Auth error handling — não revela existência de email/CPF |
| RNF-010 | Dados de clientes não compartilhados entre tenants | §4.2, §4.3 | `UNIQUE(tenant_id, cpf)` + `UNIQUE(tenant_id, user_id)` + RLS |
| RNF-011 | 99,5% disponibilidade em horário comercial | N/A | SLA de infraestrutura (Supabase cloud + Vercel); sem código novo |
| RNF-012 | Web funcional Chrome/Firefox/Safari (2 últimas versões) | N/A | Next.js 14 + Playwright em Chrome |
| RNF-013 | Mobile Android 10+ / iOS 14+ | N/A | Expo SDK 56 — configuração no `app.json` |

### 12.3 Regras de Negócio

| ID | Resumo | Seção(ões) | Artefato |
|---|---|---|---|
| RN-001 | Email único globalmente | §4.2 | `UNIQUE` em `auth.users.email` — enforced pelo Supabase |
| RN-002 | CPF identifica globalmente 1 pessoa / 1 login | §4.2 | Shell email `cpfShellEmail(cpf)` + `UNIQUE` em `auth.users` |
| RN-003 | Login plataforma/tenant: email+senha; cliente: CPF+senha | §6.1, §3.4 | Implementações separadas — `AuthProvider` vs. web login |
| RN-004 | Contexto de tenant sempre resolvido pelo servidor | §2.3, §3.3-A | `getCurrentTenantId(supabase)` em todas as Server Actions |
| RN-005 | Dado de tenant pertence exclusivamente ao tenant | §4.3 | `tenant_id NOT NULL` + RLS em todas as tabelas de domínio |
| RN-006 | Membro de tenant não lê/escreve dados de outro tenant | §4.3, §6.1 | RLS `tenant_isolation_*` + testes CA-012 |
| RN-007 | Cliente vê somente dados do contexto de tenant ativo | §4.3, §6.1 | `current_customer_ids()` RLS + `AuthProvider.currentTenantId` |
| RN-008 | Cliente pode ter perfil em múltiplos tenants | §4.2 | `UNIQUE(tenant_id, cpf)` — permite mesmo CPF em tenants distintos |
| RN-009 | CPF existente → vínculo sem novo login | §3.5, §5.2 | `createCustomer` auto-link via `service_role` |
| RN-010 | Tenant não recebe info sobre outros tenants do cliente | §3.5, §6.2 | Mensagem de aviso sem mencionar tenant de origem |
| RN-011 | Email de contato do cliente: comunicação, não auth, não único | §4.2, §5.2 | `CustomerSchema.email` — opcional, sem constraint unique |
| RN-012 | Só Platform Admin Owner cria/suspende/reativa tenants | §6.1 | `requirePlatformOwner` nas actions + RLS `platform_admin_manage_tenants` |
| RN-013 | Só Platform Admin Owner promove/remove Platform Admins | §6.1 | RLS `platform_admins_manage`: `get_platform_role() = 'owner'` |
| RN-014 | Primeiro Platform Admin Owner via bootstrap | §2.1 | Script de bootstrap existente |
| RN-015 | Usuário dual-role: contextos explícitos e separados | §2.3, §3.2 | Cookie `gomoto-context` + `/select-context` page |
| RN-016 | Suspensão exige motivo obrigatório | §5.1 | `TenantSuspendSchema.reason: z.string().min(1)` |
| RN-017 | Suspensão preserva dados, só bloqueia acesso | §4.3 | `suspended_at` flag sem DELETE; dados intactos |
| RN-018 | Membro perde acesso na próxima requisição após suspensão | §2.2, §3.3-B | `(dashboard)/layout.tsx` — check `tenant.suspended_at` |
| RN-019 | Suspensão não afeta cliente em outros tenants ativos | §3.4-B | `select-tenant.tsx` — suspenso como indisponível, demais acessíveis |
| RN-020 | Membro mantém vínculo durante suspensão; recupera ao reativar | §4.3 | `tenant_members` não é tocado na suspensão |
| RN-021 | Toda ação do Control Plane → registro imutável no audit log | §4.3, §6.3 | `logPlatformAction()` em cada action do Control Plane |
| RN-022 | Audit log do Control Plane separado dos logs operacionais | §4.3 | `platform_audit_logs` (separada de `audit_logs`) |

### 12.4 Critérios de Aceite — mapeamento inverso

| CA | RF/RN vinculados | Tipo de teste |
|---|---|---|
| CA-001 | RF-001, RF-002 | E2E (Playwright) |
| CA-002 | RF-001 | E2E |
| CA-003 | RF-003 | E2E |
| CA-004 | RF-004 | E2E |
| CA-005 | RF-004 | Unit (Vitest) |
| CA-006 | RF-005 | E2E |
| CA-007 | RF-006 | E2E |
| CA-008 | RF-007, RN-013 | Unit + E2E |
| CA-009 | RF-008 | Unit (SQL local) + E2E |
| CA-010 | RF-009, RN-021 | Unit (RLS via Supabase local) |
| CA-011 | RF-010, RF-011 | E2E (2 tenants) |
| CA-012 | RF-011, RN-006 | E2E (manipulação de URL) |
| CA-013 | RF-012, RN-018 | E2E |
| CA-014 | RF-012, RN-019 | E2E |
| CA-015 | RF-013, RN-015 | E2E |
| CA-016 | RF-014 | E2E |
| CA-017 | RF-015, RF-016 | Unit (Vitest) |
| CA-018 | RF-016 | Unit (Vitest) |
| CA-019 | RF-017 | Unit (Vitest) |
| CA-020 | RF-018 | Unit (Vitest) |
| CA-021 | RF-019 | E2E |
| CA-022 | RF-020, RF-021 | E2E |
| CA-023 | RF-022 | Unit (Vitest) |
| CA-024 | RF-023, RF-024 | E2E |
| CA-025 | RF-025, RF-027 | Unit + E2E |
| CA-026 | RF-027 | E2E |
| CA-027 | RF-026 | E2E |
| CA-028 | RF-028 | Unit |
| CA-029 | RF-029 | E2E |

### 12.5 Checklist de aprovação

- [x] Sem placeholders `<!-- preencher -->`
- [x] Tabelas modificadas (`customers`) mantêm `tenant_id` + RLS + trigger existente
- [x] Nenhuma tabela nova (somente migration de constraint + nova RPC function)
- [x] Decisões arquiteturais não triviais referenciam ADR 0003 e ADR 0004
- [x] Matriz cobre 100%: 29 RFs ✅ · 13 RNFs ✅ · 22 RNs ✅ · 29 CAs ✅
- [x] RNF-005 marcado como **deferido** (decisão explícita)
- [x] Anti-padrões GoMoto não adotados
- [x] QA-001 (status `prejudice` nas KPIs) documentada como questão aberta em §11.2

**Aprovado por:** Alan em 2026-06-26
