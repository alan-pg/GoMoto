---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-06-15
adr: "[[decisions/0004-control-plane-e-identidade-do-cliente]]"
related:
  - "[[Arquitetura Proposta]]"
  - "[[decisions/0003-escopo-e-auth-do-mobile-cliente]]"
  - "[[Banco de Dados]]"
  - "[[Segurança]]"
tags:
  - prd
  - plataforma
  - multi-tenant
---

# PRD 0001 — Área Administrativa da Plataforma (Control Plane)

> ✅ **Status: aprovado.** 11 decisões fechadas em 2026-06-15 e consolidadas em [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]]. Próximo passo: implementar **F1** (schema control plane + bootstrap) — ver §12 e §14.

---

## 1. Contexto

O GoMoto está evoluindo de **single-tenant** (uso interno da locadora "Bonze") para **multi-tenant SaaS** B2B — cada locadora de motos é um *tenant* independente. A Fase 5 da [[Arquitetura Proposta]] entregou o isolamento técnico: `tenant_id` em todas as 15 tabelas de domínio, RLS via `get_user_tenants()`, e roles internos `owner / admin / operator / viewer` em `tenant_members`.

**Premissas de identidade do GoMoto** (fechadas em 2026-06-15):

- **Admin / operador** (web dashboard) — **1 pessoa = 1 tenant**. Caso raro de cruzamento se resolve com email diferente. Login por email/senha.
- **Cliente final** (app mobile, locatário de moto) — **1 pessoa pode ser cliente de N tenants** (cenário comum: fechou contrato com Locadora A, abriu com Locadora B; ou mantém os dois em paralelo). Login por **CPF + senha**, com CPF UNIQUE global.

**Lacuna:** não existe a **camada acima do tenant** — quem opera o produto como produto. Hoje, criar um novo tenant exige acessar o banco via service_role (CLI/seed). Não há quem possa:

- Cadastrar, suspender ou reativar uma empresa-cliente.
- Visualizar métricas agregadas da plataforma (nº de tenants ativos, motos no sistema, MRR no futuro).
- Gerar relatórios cross-tenant para decisões comerciais.
- Auditar ações sensíveis (quem criou qual tenant, quando suspendeu).

Este PRD define a **área administrativa da plataforma** — o que em SaaS é chamado de *control plane*, separado do *tenant plane* operacional — e formaliza as duas premissas de identidade acima.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Control Plane** | Área e funcionalidades que operam **sobre** os tenants (cadastro de empresas, métricas globais). |
| **Tenant Plane** | Área operacional **dentro** de um tenant — o dashboard atual em `apps/web/src/app/(dashboard)/*`. |
| **Platform Admin** | Usuário com permissão de operar o control plane. Não é membro de nenhum tenant (ou é, mas a permissão é independente). |
| **Tenant / Empresa-cliente** | Uma locadora de motos que usa o GoMoto. Equivalente a *organization* em outros SaaS. |
| **Tenant Owner** | Dono da empresa-cliente (papel mais alto **dentro** do tenant). |
| **Cliente final** | Pessoa que aluga moto de uma empresa-cliente — usa o app mobile. **Não tem acesso ao control plane nem ao dashboard web.** Pode ser cliente de N tenants simultaneamente. |
| **Shell email** | Email sintético atribuído ao `auth.users` de cliente final, no formato `{cpf}@cliente.gomoto.app`. Nunca exibido — serve só para satisfazer a constraint do Supabase Auth. |

---

## 3. Objetivos e não-objetivos

### 3.1 Objetivos (V1)

- ✅ Cadastrar, listar, editar, **suspender** e reativar empresas-cliente.
- ✅ Criar o **primeiro usuário owner** de cada nova empresa (sem self-service signup).
- ✅ Dashboard com KPIs operacionais agregados (nº tenants ativos, total de motos, contratos ativos, cobranças vencidas em todas as empresas).
- ✅ Relatórios cross-tenant exportáveis (CSV) para suporte e decisões comerciais.
- ✅ Audit log de **toda ação de platform admin** (quem cadastrou tenant X, quem suspendeu Y).
- ✅ Gerenciar a lista de platform admins (adicionar, remover, trocar role).

### 3.2 Não-objetivos (V1 — explicitamente fora do escopo)

- ❌ **Billing / cobrança dos tenants** (planos, MRR real, gateway). Modelo de cobrança ainda em definição.
- ❌ **Self-service signup** — empresas só entram no sistema via convite manual de platform admin.
- ❌ **White-label / branding customizado** por tenant.
- ❌ **SSO / SAML** (Google Workspace já é coberto pelo Supabase OAuth se necessário, mas não é V1).
- ❌ **"Impersonar" tenant** (login-as) — risco de segurança alto; só entra quando houver justificativa de suporte concreta.
- ❌ **Quotas** (limite de motos/usuários por plano).
- ❌ **Métricas técnicas** (latência, erros) — isso é Sentry/observabilidade, não control plane.

> Cada não-objetivo vira PRD próprio quando houver demanda.

---

## 4. Personas e papéis

### 4.1 Tabela de papéis (matriz completa do sistema)

| Papel | Onde existe hoje | Escopo | Acesso |
|---|---|---|---|
| `platform_owner` | 🆕 a criar | Control plane | TUDO em `/admin/*` + bypass RLS para leitura/escrita de tenants |
| `platform_operator` | 🆕 a criar | Control plane | Leitura em `/admin/*`, sem permissão para criar/suspender tenants |
| `tenant_owner` | ✅ existe (`tenant_members.role = 'owner'`) | 1 tenant | TUDO no dashboard daquele tenant |
| `tenant_admin` | ✅ existe | 1 tenant | Quase tudo, menos gerenciar membros do próprio tenant |
| `tenant_operator` | ✅ existe | 1 tenant | Operação do dia-a-dia (criar contrato, registrar cobrança) |
| `tenant_viewer` | ✅ existe | 1 tenant | Somente leitura |
| `customer` | ✅ existe (via `customers.user_id`) | Próprios dados | Mobile cliente — contrato, cobranças, manutenções, suporte |

### 4.2 Personas

- **Alan / LW Tecnologia** → `platform_owner`. Vende o GoMoto pra locadoras, faz onboarding, suporte de alto nível.
- **(futuro) suporte LW** → `platform_operator`. Atende ticket, consulta dados, mas não cria/suspende tenant.
- **Dono da locadora Bonze, Dono da locadora X** → `tenant_owner`. Opera só dentro do seu tenant.

### 4.3 Regras de combinação de papéis

- **Platform admin ↔ Tenant member:** um mesmo `auth.users` **pode ser** `platform_owner` E `tenant_owner` de algum tenant simultaneamente (ex.: Alan é platform_owner e também testa como owner da Bonze). O header global oferece **switcher de contexto** (Plataforma ↔ Tenant X) quando isso acontece.
- **Tenant member em N tenants:** **fora de escopo no V1.** Cenário improvável (operador raramente trabalha em duas locadoras). Se ocorrer, a pessoa cria contas com emails diferentes — sem switcher.
- **Cliente final em N tenants:** **de 1ª classe.** Detalhado na §4.4.

### 4.4 Cliente final em múltiplos tenants

Cenário-alvo: João alugou moto na Locadora A, devolveu, e agora aluga na Locadora B. Sistema deve tratar João como **uma única pessoa** com **dois vínculos de `customer`** (um por tenant), e **um único login** (CPF + senha).

**Regras:**

1. **CPF é a identidade global do cliente.** UNIQUE em `customers.cpf` no nível do projeto (não por tenant).
2. **`customers.user_id` aponta para o mesmo `auth.users.id`** em todos os tenants onde a pessoa é cliente. Tabela já permite (UNIQUE só por `(tenant_id, user_id)`, não global em `user_id`).
3. **Cadastro de cliente já existente:** quando uma locadora cadastra um CPF que já existe em outro tenant:
    - Sistema detecta pelo CPF.
    - Reaproveita `auth.users` existente — **não** gera novo login.
    - Cria nova linha em `customers` para o tenant atual, com o mesmo `user_id`.
    - **Não** envia novo magic link (cliente já tem senha).
    - Operador da locadora vê aviso "Este CPF já tem conta no GoMoto — vinculando à locadora atual".
4. **Privacidade entre tenants:** Locadora A **não enxerga** dados da Locadora B sobre o mesmo cliente. Cada `customers` row tem seus próprios campos editáveis (telefone, observações), e a RLS filtra por `tenant_id`. A Locadora A nunca sabe que João também é cliente da B — apenas vê que "o CPF já existe no sistema".
5. **No app mobile**, pós-login o cliente vê:
    - Se N=1: vai direto para o dashboard do único tenant.
    - Se N≥2: **tela de seleção de locadora** ("De qual locadora você quer ver?"). Cliente escolhe uma; navegação subsequente fica nesse contexto. Botão "Trocar de locadora" sempre disponível.

---

## 5. Modelo de dados

### 5.1 Novas tabelas

```sql
-- ============================================================
-- Tabela: platform_admins
-- Define quem pode operar o control plane.
-- ============================================================
CREATE TABLE platform_admins (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'operator')) DEFAULT 'operator',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES auth.users(id)  -- quem promoveu este admin
);

CREATE TRIGGER trg_platform_admins_updated_at
    BEFORE UPDATE ON platform_admins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Tabela: platform_audit_logs
-- Audit log dedicado do control plane (separado de audit_logs por tenant).
-- ============================================================
CREATE TABLE platform_audit_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id     UUID NOT NULL REFERENCES auth.users(id),
    action       VARCHAR(50) NOT NULL,   -- ex: 'tenant.created', 'tenant.suspended', 'admin.promoted'
    target_type  VARCHAR(50),            -- 'tenant' | 'platform_admin' | ...
    target_id    UUID,
    metadata     JSONB,                  -- payload da mudança (antes/depois)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_logs_actor ON platform_audit_logs(actor_id);
CREATE INDEX idx_platform_audit_logs_target ON platform_audit_logs(target_type, target_id);
CREATE INDEX idx_platform_audit_logs_created ON platform_audit_logs(created_at DESC);
```

### 5.2 Alterações em tabelas existentes

```sql
-- tenants: estado de suspensão + metadados administrativos
ALTER TABLE tenants
    ADD COLUMN suspended_at      TIMESTAMPTZ NULL,
    ADD COLUMN suspended_reason  TEXT NULL,
    ADD COLUMN suspended_by      UUID REFERENCES auth.users(id),
    ADD COLUMN created_by        UUID REFERENCES auth.users(id),
    ADD COLUMN trial_ends_at     TIMESTAMPTZ NULL;  -- placeholder para fase de billing

-- A coluna `active BOOLEAN` existente vira derivada de suspended_at = NULL,
-- mas mantemos por compat enquanto migrações de RLS não a referenciam.

-- customers: CPF como identidade global do cliente
-- Antes desta migration, CPF era nullable e sem constraint global.
-- Backfill assumido: todos os customers existentes têm CPF preenchido.
ALTER TABLE customers
    ALTER COLUMN cpf SET NOT NULL;

CREATE UNIQUE INDEX customers_cpf_global_unique
    ON customers(cpf);
-- ⚠️ Atenção: se houver CPFs duplicados em tenants diferentes hoje
-- (mesma pessoa cadastrada em N locadoras antes deste constraint),
-- a migration falha. Procedimento de pré-checagem listado em §10.3.
```

### 5.3 Identidade do cliente final (login por CPF)

Para satisfazer o Supabase Auth (que exige `email UNIQUE NOT NULL` em `auth.users`) sem expor email ao usuário, adotamos o padrão **shell email**:

```
-- Função utilitária (executada em Server Action, não no SQL direto)
shell_email(cpf) := REGEXP_REPLACE(cpf, '[^0-9]', '', 'g') || '@cliente.gomoto.app'

-- Exemplo:
-- cpf '123.456.789-00' → shell_email = '12345678900@cliente.gomoto.app'
```

**Fluxo de login mobile do cliente:**

```
1. Usuário digita: CPF + senha
2. App (mobile):
     a. valida CPF localmente (formato + dígito verificador)
     b. monta synthetic_email = shell_email(cpf)
     c. chama supabase.auth.signInWithPassword({ email: synthetic_email, password })
3. Supabase autentica normalmente; retorna sessão JWT padrão
4. App busca customers WHERE user_id = auth.uid()
     → N=1: vai pro dashboard
     → N≥2: tela de seleção de locadora
```

**Cadastro do cliente (no painel da locadora):**

```
1. Operador preenche cadastro: cpf, nome, telefone, (email opcional)
2. Server Action:
     a. valida CPF (formato + algoritmo)
     b. SELECT * FROM customers WHERE cpf = ?
        - Se existe em outro tenant: reaproveita user_id, vincula novo customers row
        - Se não existe: cria auth.users com shell_email + senha temporária + magic link
     c. INSERT INTO customers (tenant_id, cpf, name, phone, email, user_id, ...)
     d. Retorna magic link ou aviso "CPF já existia, vinculado"
```

**`customers.email` continua existindo** para contato real (nota fiscal, comunicação) — sem relação com login. Pode ser `NULL`.

### 5.4 Helper function

```sql
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM platform_admins WHERE user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION get_platform_role()
RETURNS VARCHAR
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT role FROM platform_admins WHERE user_id = auth.uid() LIMIT 1;
$$;
```

### 5.5 Novas policies RLS

```sql
-- platform_admins: só platform admins enxergam, só owners gerenciam
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read peers"
    ON platform_admins FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "Platform owners can manage admins"
    ON platform_admins FOR ALL TO authenticated
    USING (get_platform_role() = 'owner')
    WITH CHECK (get_platform_role() = 'owner');

-- tenants: platform admin enxerga TUDO; platform owner cria/atualiza
CREATE POLICY "Platform admins can read all tenants"
    ON tenants FOR SELECT TO authenticated
    USING (is_platform_admin());

CREATE POLICY "Platform owners can insert tenants"
    ON tenants FOR INSERT TO authenticated
    WITH CHECK (get_platform_role() = 'owner');

CREATE POLICY "Platform owners can update tenants"
    ON tenants FOR UPDATE TO authenticated
    USING (get_platform_role() = 'owner');

-- platform_audit_logs: leitura por platform admin; escrita só via Server Action (service_role)
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read audit logs"
    ON platform_audit_logs FOR SELECT TO authenticated
    USING (is_platform_admin());
```

### 5.6 Bloqueio de tenant suspenso (defesa em camadas)

Decisão fechada (D2 em §13): proteger em **dois níveis**:

- **(A) RLS** — adicionar `AND (suspended_at IS NULL)` em todas as policies de domínio que filtram por `get_user_tenants()`. Tenant suspenso → dados invisíveis para membros, mesmo via API direta.
- **(B) Middleware** — rejeita sessão de membro cujo tenant está suspenso (UX: tela "Locadora temporariamente indisponível").

Platform admin (com `is_platform_admin()`) **ignora** o bloqueio — precisa ver dados de tenants suspensos para suporte.

---

## 6. Segurança

### 6.1 Gating de rotas

- Rota Next.js `/admin/*` (route group `(admin)`) é protegida no middleware: rejeita se `is_platform_admin()` retornar `false`.
- Toda Server Action do control plane revalida `is_platform_admin()` no início.
- Cliente do Supabase usado nas Server Actions do control plane **NÃO** é `service_role` exceto onde explicitamente necessário (ex.: criação de auth.users — passo único).

### 6.2 Princípios

1. **Defesa em camadas:** middleware → route guard → RLS → ação. Falhar em qualquer um nega.
2. **Tudo é auditado:** cada mutação no control plane grava em `platform_audit_logs`.
3. **Sem impersonação tácita:** não criar mecanismo de "ver como tenant X" agora. Se precisar inspecionar dados de um tenant, usar Studio + service_role com log explícito.
4. **Service_role só onde indispensável:** criação de auth.users, reset de senha — sempre via Server Action server-side, nunca exposto ao client.

### 6.3 Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Platform admin vaza dados de tenants por bypass RLS | Audit log obrigatório + revisão periódica + número de platform admins pequeno (2-3) |
| Service_role key vaza | Manter só em env vars server-side; rodar verificação no build de que não vai pro bundle do client |
| Criação de tenant duplicada por slug | UNIQUE constraint já existe em `tenants.slug` |
| Promoção indevida de platform admin | Só `platform_owner` promove; primeira promoção feita via migration/seed |

---

## 7. Telas e fluxos

> Convenção: rotas em português (`/admin/empresas`), código em inglês.

### 7.1 Mapa de telas

```
/admin                          → Dashboard plataforma
/admin/empresas                 → Lista de empresas (tenants)
/admin/empresas/nova            → Wizard de criação (modal ou rota)
/admin/empresas/[id]            → Detalhe + edição + suspensão
/admin/empresas/[id]/membros    → Listagem read-only dos membros do tenant
/admin/usuarios                 → Lista de platform admins
/admin/relatorios               → Relatórios cross-tenant (export CSV)
/admin/auditoria                → Audit log do control plane
```

### 7.2 Detalhamento por tela

#### 7.2.1 `/admin` — Dashboard plataforma

**KPIs (cards em h-9 text-[13px] coerentes com tabelas):**
- Tenants ativos / suspensos / total
- Motos no sistema (soma)
- Contratos ativos (soma)
- Cobranças vencidas (soma)
- Usuários da plataforma (membros de algum tenant)

**Gráficos (Recharts):**
- Tenants criados por mês (últimos 12 meses)
- Crescimento de contratos ativos por tenant (top 5)

**Implementação:** function `SECURITY DEFINER` que retorna o agregado, evitando expor service_role.

#### 7.2.2 `/admin/empresas` — Lista

Tabela `h-9 text-[13px]` com colunas:
- Nome
- Slug
- Status (Ativa / Suspensa)
- Membros (count)
- Motos (count)
- Criada em
- Ações (Ver / Suspender)

Filtros: status, busca por nome/slug.

#### 7.2.3 `/admin/empresas/nova` — Criar empresa

Wizard em 2 passos:

1. **Dados da empresa** — nome, slug (auto-gerado), CNPJ (opcional V1), observações.
2. **Owner inicial** — email + nome do owner. Sistema:
    - Cria `auth.users` (Server Action com service_role).
    - Gera magic link de definição de senha (reaproveita fluxo `/set-password` já existente — commit `c54118f`).
    - Cria `tenants` row.
    - Cria `tenant_members` com `role = 'owner'`.
    - Grava `platform_audit_logs` action `tenant.created`.
    - Retorna magic link copiável no modal (até integração Resend).

#### 7.2.4 `/admin/empresas/[id]` — Detalhe

Sumário + ações:
- Editar nome, observações.
- **Suspender** — modal pede motivo (obrigatório, ≥20 chars). Grava `suspended_at`, `suspended_reason`, `suspended_by`. Log de auditoria.
- **Reativar** — limpa os 3 campos. Log.
- **Excluir** — **fora do V1** (decisão D3 em §13). Apenas suspensão indefinida.

#### 7.2.5 `/admin/empresas/[id]/membros` — Membros (read-only)

Lista os `tenant_members` do tenant com role. Platform admin **não edita** — apenas observa. Edição é responsabilidade do `tenant_owner` no dashboard do tenant.

#### 7.2.6 `/admin/usuarios` — Platform admins

CRUD da tabela `platform_admins`. Só `platform_owner` pode promover/demover. Listagem mostra: email, role, criado em, criado por.

#### 7.2.7 `/admin/relatorios` — Relatórios cross-tenant

Relatórios V1:
- Motos por tenant (CSV)
- Contratos ativos por tenant (CSV)
- Cobranças vencidas por tenant (CSV)
- Receita acumulada por tenant (CSV) — proxy futuro de MRR

#### 7.2.8 `/admin/auditoria` — Audit log

Lista paginada de `platform_audit_logs` com filtros por actor, action, período.

### 7.3 Switcher de contexto (web)

Header global do dashboard web:

- Se user é `platform_admin` **E** `tenant_member` (caso raro: Alan testa como owner da Bonze) → toggle "Plataforma / Tenant X" no canto superior direito.
- Se user é só `platform_admin` → marca "Plataforma" fixa, sem toggle.
- Se user é só `tenant_member` → sem toggle, vai direto pro `(dashboard)` atual.

Toggle muda apenas a rota e layout/sidebar; sessão Supabase é a mesma.

### 7.4 Login do cliente mobile (CPF)

Tela `apps/mobile/app/login.tsx` reescrita:

- Campo **"CPF"** com máscara `000.000.000-00` (não "Email").
- Validação local: formato + dígito verificador (regra pura em `@gomoto/core/rules/cpf`).
- Resolve `shell_email(cpf)` e chama `signInWithPassword`.
- Erro genérico em falha (não revela "CPF não encontrado" — anti-enumeração).

### 7.5 Tela de seleção de locadora (mobile cliente)

Nova rota `apps/mobile/app/select-tenant.tsx` exibida pós-login se `customers WHERE user_id = auth.uid()` retorna ≥2 linhas:

- Lista de cards: nome da locadora, status do contrato atual (Ativo / Encerrado), data do último contrato.
- Tap em um card → AsyncStorage guarda `selectedTenantId` e navega para tabs.
- Botão "Trocar de locadora" sempre acessível no header das tabs.
- Se N=1, pula esta tela direto.

---

## 8. Fluxos críticos (end-to-end)

### 8.1 Onboarding de nova empresa

```
[Platform owner] /admin/empresas/nova
        ↓ preenche nome, slug, owner email+nome
[Server Action]
  1. Valida is_platform_admin()
  2. Cria auth.users (service_role)
  3. Cria tenant
  4. Cria tenant_members (role=owner)
  5. Gera magic link (Supabase Admin API)
  6. Grava platform_audit_logs
  7. Retorna { tenant, magicLink }
[UI] mostra magic link em modal copiável (até Resend entrar)
```

### 8.2 Suspensão de tenant

```
[Platform owner] /admin/empresas/[id] → Suspender
        ↓ informa motivo
[Server Action]
  1. Valida is_platform_admin() E role = 'owner'
  2. UPDATE tenants SET suspended_at, suspended_reason, suspended_by
  3. Grava platform_audit_logs (action=tenant.suspended, metadata={motivo})
  4. (futuro) invalida sessões ativas dos membros
[Resultado] RLS bloqueia leitura/escrita dos membros do tenant
```

### 8.3 Promoção de platform admin

```
[Platform owner] /admin/usuarios → Adicionar
        ↓ informa email
[Server Action]
  1. Valida get_platform_role() = 'owner'
  2. Procura auth.users por email (deve existir)
  3. INSERT platform_admins (user_id, role='operator', created_by=auth.uid())
  4. Grava platform_audit_logs (action=admin.promoted)
```

### 8.4 Cadastro de cliente já existente em outro tenant

```
[Operador da Locadora B] dashboard → Clientes → Novo
        ↓ digita CPF=12345678900 + nome + telefone
[Server Action createCustomer]
  1. valida CPF (formato + dígito)
  2. SELECT * FROM customers WHERE cpf = '12345678900' LIMIT 1
       → encontrado (cliente da Locadora A)
  3. INSERT INTO customers (
       tenant_id   = <Locadora B>,
       cpf         = '12345678900',
       user_id     = <user_id reaproveitado>,
       name, phone, ...
     )
  4. NÃO cria auth.users, NÃO gera magic link
  5. (Locadora A continua intocada por RLS)
[UI] flash: "CPF já cadastrado no GoMoto — vinculando à Locadora B. Cliente já tem login."
```

Variante "cliente novo":

```
[Operador da Locadora B] dashboard → Clientes → Novo
        ↓ digita CPF=99988877700 + nome + telefone + (email)
[Server Action createCustomer]
  1. valida CPF
  2. SELECT * FROM customers WHERE cpf = '99988877700' → vazio
  3. Cria auth.users com:
       email    = shell_email('99988877700')  -- '99988877700@cliente.gomoto.app'
       password = senha temporária randômica
  4. Gera magic link para fluxo /set-password
  5. INSERT customers (tenant_id, cpf, user_id, name, phone, email=opcional)
  6. Retorna magic link (copiável; operador envia por WhatsApp)
```

### 8.5 Login do cliente em N tenants

```
[Cliente João] abre app
        ↓ digita CPF=12345678900 + senha
[App mobile]
  1. shell_email = '12345678900@cliente.gomoto.app'
  2. signInWithPassword({ email: shell_email, password })
  3. SELECT * FROM customers WHERE user_id = auth.uid()
       → [Locadora A row, Locadora B row]
  4. N=2 → navega para /select-tenant
[Tela] mostra 2 cards (A, B)
       ↓ João escolhe B
  5. AsyncStorage.set('selectedTenantId', <B>)
  6. Navega para tabs
[Tabs] contratos/cobranças filtram client-side por selectedTenantId
       (RLS já entrega só o que João tem direito; filtro local seleciona o tenant ativo)
```

---

## 9. Bootstrap do primeiro platform admin

Não pode haver platform admin para promover o primeiro. Soluções:

- **(A)** Migration faz `INSERT INTO platform_admins` para o user já existente (`admin@gomoto.dev` do seed) com role `owner`.
- **(B)** Variável de ambiente `PLATFORM_BOOTSTRAP_EMAIL` — primeiro login desse email vira platform admin automaticamente.

**Recomendação:** **(A)** — explícito, versionado, fácil de auditar. Seed e migration de produção tratam isso uma vez só.

---

## 10. Impacto em código existente

### 10.1 Mudanças necessárias

| Componente | Mudança |
|---|---|
| `apps/web/src/middleware.ts` | Adicionar branch: se rota inicia com `/admin/*`, exigir `is_platform_admin()`. Bloquear sessões de tenants suspensos (membros). |
| `apps/web/src/lib/auth/tenant.ts` | Adicionar helpers `getPlatformRole()` e `isPlatformAdmin()`. |
| `apps/web/src/app/(admin)/layout.tsx` | Novo route group + sidebar de plataforma. |
| `apps/web/src/components/layout/Sidebar` | Switcher de contexto (Plataforma ↔ Tenant) só quando user tem ambos os papéis. |
| `apps/web/src/app/(dashboard)/clientes/actions.ts` | `createCustomer` passa a checar CPF global, reaproveitar `user_id` ou criar `auth.users` com shell email. |
| `apps/mobile/app/login.tsx` | Substituir campo "Email" por "CPF" com máscara + validação local. |
| `apps/mobile/app/select-tenant.tsx` | **Nova** tela de seleção quando cliente tem N≥2 customers. |
| `apps/mobile/src/contexts/auth.tsx` | Expor `selectedTenantId` + `setSelectedTenantId` via AsyncStorage. |
| `packages/core/src/rules/cpf.ts` | Função pura `isValidCpf(cpf)` + `cpfToShellEmail(cpf)`. |
| `packages/core/src/rules/tenant.ts` | `canSuspendTenant(tenant, actor)`, `requireSuspendReason(reason)`. |
| `packages/core/src/schemas` | Schemas Zod para `tenant`, `platform_admin`, `customer` (com CPF obrigatório). |
| Migrations novas | `supabase/migrations/<ts>_platform_admin.sql`, `<ts>_customers_cpf_global.sql`, `<ts>_tenants_suspension.sql`. |
| Seed | Promover `admin@gomoto.dev` a `platform_owner`; ajustar `cliente@gomoto.dev` para usar shell email. |

### 10.2 NÃO precisa mudar

- Roles existentes em `tenant_members` (`owner/admin/operator/viewer`).
- RLS atual filtrada por `get_user_tenants()` — **continua válida**. Apenas **acrescentam-se** policies de bypass para platform admin + filtro de `suspended_at IS NULL`.
- Função `current_customer_ids()` já é `SETOF UUID` — funciona out-of-the-box com cliente em N tenants.
- Login admin web continua email/senha (sem CPF).

### 10.3 Pré-checagem antes de aplicar a migration de CPF global

A migration `customers_cpf_global` cria `UNIQUE INDEX customers_cpf_global_unique`. Vai falhar se já houver CPFs duplicados em tenants distintos. Antes:

```sql
-- Lista CPFs duplicados (precisa virar 0 linhas)
SELECT cpf, COUNT(*) AS n, ARRAY_AGG(tenant_id) AS tenants
  FROM customers
  WHERE cpf IS NOT NULL
  GROUP BY cpf
  HAVING COUNT(*) > 1;
```

**Conflict resolution policy:** se houver duplicatas, escolher 1 `user_id` canônico (o mais antigo) e fazer `UPDATE customers SET user_id = <canonico> WHERE cpf = ?` antes de aplicar a constraint. Cada linha vira um vínculo por tenant para o mesmo `auth.users`.

---

## 11. Critérios de aceite (V1)

**Control plane:**

- [ ] Platform admin cria nova empresa via UI, obtém magic link copiável, e o owner recém-criado loga e vê o dashboard do seu tenant vazio.
- [ ] Platform admin suspende uma empresa: membros perdem acesso a leituras e escritas (validado via Playwright + queries diretas) e veem tela "Locadora temporariamente indisponível".
- [ ] Dashboard de plataforma mostra contagens consistentes com `SELECT count(*)` direto nas tabelas (mesmo número).
- [ ] Toda mutação no control plane gera 1 linha em `platform_audit_logs` com `actor_id` correto.
- [ ] `platform_operator` consegue ler, **não** consegue criar/suspender (UI mostra ação desabilitada + RLS rejeita).
- [ ] Usuário não-admin recebe 404 ao acessar `/admin/*` (não vaza existência).

**Identidade do cliente:**

- [ ] Cadastro de cliente com CPF já existente em outro tenant reaproveita `user_id`, não envia magic link, e exibe aviso "CPF já cadastrado".
- [ ] Cliente com 2 customers (tenants A e B) loga com CPF, vê tela de seleção, escolhe um e navega; troca de locadora funciona no header das tabs.
- [ ] Cliente com 1 customer pula a tela de seleção.
- [ ] Locadora A não enxerga em momento algum dados da Locadora B sobre o mesmo cliente (validado via Playwright + queries diretas).
- [ ] Tentar cadastrar CPF inválido (dígito errado) é bloqueado client-side e server-side.

**Geral:**

- [ ] Build verde + migrações `pnpm db:reset` sobem limpo.
- [ ] ADR 0004 escrito formalizando o modelo de control plane.
- [ ] Notas Obsidian atualizadas: [[Banco de Dados]], [[Segurança]], [[Estado Atual]], [[decisions/0003-escopo-e-auth-do-mobile-cliente]] (adendo sobre CPF login).

---

## 12. Faseamento sugerido

| Fase | Escopo | Esforço |
|---|---|---|
| **F1 — Schema control plane + bootstrap** | Migrations `platform_admin` + `tenants_suspension`, helper functions, policies, promoção do primeiro admin no seed | 1 dia |
| **F2 — Identidade do cliente (CPF global + shell email)** | Migration `customers_cpf_global`, refactor de `createCustomer`, `cpfToShellEmail` em `@gomoto/core`, regra `isValidCpf` | 1-2 dias |
| **F3 — Mobile: login CPF + tenant picker** | Tela login reescrita, `select-tenant.tsx`, `selectedTenantId` no contexto | 1-2 dias |
| **F4 — CRUD de empresas** | `/admin/empresas`, criar/listar/ver/editar/suspender/reativar | 2-3 dias |
| **F5 — Platform admins UI** | `/admin/usuarios`, promover/demover, audit log básico | 1 dia |
| **F6 — Dashboard plataforma** | `/admin`, KPIs agregados via SECURITY DEFINER functions | 1-2 dias |
| **F7 — Relatórios** | `/admin/relatorios` com exports CSV | 1-2 dias |
| **F8 — Auditoria** | `/admin/auditoria` com filtros | 1 dia |
| **F9 — Integração Resend** | Substituir magic link manual por email automático | depende Edge Function |

**Total estimado V1 (F1-F8):** 9-14 dias focados, web em produção entre fases.

**Ordem de prioridade:** F1 → F2 → F4 (em paralelo F3 quando mobile ganhar prioridade).

---

## 13. Decisões (fechadas em 2026-06-15)

| # | Decisão | Resolução |
|---|---|---|
| ✅ D1 | Modelo de papel platform (tabela vs JWT claim) | **Tabela `platform_admins`** |
| ✅ D2 | Bloqueio de tenant suspenso (RLS vs middleware-only) | **Ambos** — defesa em camadas (RLS + middleware) |
| ✅ D3 | Exclusão de tenant (hard delete) | **Não no V1** — só suspensão indefinida |
| ✅ D4 | Magic link manual vs Resend para owner inicial | **Manual no V0**, Resend em fase F9 |
| ✅ D5 | Impersonação de tenant (login-as) | **Não no V1** — reabrir se surgir caso concreto |
| ✅ D6 | Bootstrap do primeiro admin | **Migration explícita** promovendo `admin@gomoto.dev` |
| ✅ D7 | Self-service signup futuro | **Fora do V1** — PRD próprio quando justificar |
| ✅ D8 | CPF como chave global do cliente | **Sim** — `customers.cpf` UNIQUE global |
| ✅ D9 | UX do cliente em N tenants (picker dedicado vs feed agregado) | **Picker dedicado** — tela `/select-tenant` pós-login |
| ✅ D10 | Login do cliente por CPF ou email | **CPF** — via shell email interno, mantém Supabase Auth nativo |
| ✅ D11 | Admin/operador em múltiplos tenants | **Não** — caso raro resolvido com email diferente; sem switcher de tenant para tenant_member |

Próximo passo: consolidar decisões em **ADR 0004 — Modelo de control plane multi-tenant + identidade do cliente** e mover este PRD para `status: aprovado`.

---

## 14. Próximos passos

1. ~~Fechar decisões pendentes~~ ✅ (11 decisões fechadas em 2026-06-15).
2. Revisão humana final deste rascunho (Alan).
3. Escrever **ADR 0004 — Modelo de control plane multi-tenant + identidade do cliente**.
4. Quebrar em tarefas no [[Roadmap]] (F1 → F8).
5. Implementar **F1** (schema control plane + bootstrap) como primeiro PR — valida modelo antes de gastar tempo em UI.
6. Implementar **F2** (CPF global + shell email) em seguida — destrava o mobile do cliente.

> ⚠️ **Atenção ao executar F2:** rodar a pré-checagem de CPFs duplicados (§10.3) antes da migration. No estado atual do seed, há apenas o `cliente@gomoto.dev`, sem conflito esperado — mas vale validar.

---

## Tags

`#prd` `#plataforma` `#multi-tenant` `#control-plane`
