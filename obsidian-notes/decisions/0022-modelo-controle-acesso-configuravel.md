# ADR 0022 — Modelo de controle de acesso configurável (RBAC por módulo)

- **Status:** Aceita
- **Data:** 2026-08-08
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] (multi-tenancy, `tenant_id`+RLS), [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]] (`platform_admins`, padrão de audit log e de link manual)
- **PRD de origem:** [[PRDs/0011-modulo-usuarios-acessos]]

## Contexto

Hoje o controle de acesso do GoMoto é fixo em dois pontos:

- `tenant_members.role` — `VARCHAR(20) CHECK (role IN ('owner','admin','operator','viewer'))`, criado na Fase 5 (multi-tenancy).
- `platform_admins.role` — `CHECK (role IN ('owner','operator'))`, criado na ADR 0004.

Não existe nenhuma tabela de permissões, módulos ou papéis customizáveis. Além disso, a criação de usuário hoje só cobre **promoção de conta já existente**:

- `add_platform_admin_by_email` (`platform_admins_rpc.sql`) falha se o email não existe em `auth.users` — o comentário da própria migration já registra: *"Falha se o usuário ainda não existe em auth.users — F9 cuidará do invite."* Este PRD é o F9.
- `create_tenant_with_owner` (`tenant_company_profile.sql`) cria o primeiro usuário do tenant, mas via **INSERT direto em `auth.users`** (SQL + `pgcrypto`, `crypt(p_owner_password, ...)`) com senha **definida na hora pelo platform admin** — não gera link de convite.
- `regenerateOwnerLink` (`empresas/actions.ts`) já usa a **Admin API do Supabase** (`supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', ... })`) para gerar um link de acesso com expiração de 72h — mas hoje só regenera acesso de um owner **já existente**, não cria usuário novo.

PRD 0011 pede duas coisas que exigem decisão arquitetural antes da Spec:

1. **Convite de usuário do zero** (Platform Admin e Tenant Member), com link de definição de senha de 72h — não existe hoje um fluxo de criação-via-convite, só promoção ou senha pré-definida.
2. **Base de permissões organizada por módulo**, preparando terreno para Papéis Customizados (V2) "sem retrabalho estrutural" — mas o próprio PRD sinaliza como risco explícito o overengineering de construir essa estrutura maior do que o necessário para o volume atual (dezenas de usuários por tenant, só 4 papéis fixos em uso).

## Decisão

### 1. Convite via Admin API do Supabase — `generateLink({ type: 'invite' })`

Server Action com `service_role` chama `supabaseAdmin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })`. Essa chamada **cria o `auth.users`** (não confirmado) **e devolve o `action_link`** real de definição de senha em uma única chamada — generaliza para criação o mesmo mecanismo que `regenerateOwnerLink` já usa para regeneração.

Fluxo em dois passos, **não atômico**:

1. Server Action valida conflito de email via nova RPC `SECURITY DEFINER` (necessário porque `auth.users` não é acessível via PostgREST — mesmo motivo já documentado em `platform_admins_rpc.sql`).
2. `generateLink` cria o `auth.users` e devolve o link.
3. INSERT em `platform_admins` (RF-001) ou `tenant_members` (RF-006) com o papel escolhido, mais o registro de audit log correspondente.

Se o passo 3 falhar, sobra um `auth.users` órfão sem vínculo — baixo risco (nenhum dado exposto) e a Spec deve tratar reconvite ao mesmo email como idempotente (detecta "usuário já existe em `auth.users`, sem vínculo" e só insere o vínculo faltante, sem gerar novo `auth.users`).

**Não** replicamos o padrão `create_tenant_with_owner` (INSERT direto em `auth.users` via SQL com `pgcrypto`) para o convite: esse padrão foi desenhado para senha definida na hora, e reproduzir via SQL puro um token de convite/recovery que o GoTrue aceite não é suportado oficialmente — frágil demais para o ganho de atomicidade.

### 2. Base de permissões por módulo: tabelas de referência globais, sem enforcement em V1

Três tabelas novas, **globais** (não tenant-scoped — justificativa no §3):

```sql
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
```

Uma migration de seed povoa `permission_modules` com o vocabulário do PRD (Frota, Clientes, Contratos, Financeiro, Manutenção, Vistoria, Usuários, Configurações) e `role_permissions` com o mapeamento atual dos 4 papéis fixos. O mapeamento exato (quem vê o quê) é dado de seed — fica pra Spec, não é decisão arquitetural.

**Enforcement em V1 não muda.** RLS e guards de Server Action continuam checando `tenant_members.role` diretamente (`role IN ('owner','admin')`, etc.), exatamente como hoje. As três tabelas novas **não são consultadas em nenhum caminho de autorização em V1** — existem só como catálogo/vocabulário correto, pronto para V2 ler.

### 3. Por que essas tabelas são globais (exceção à regra `tenant_id`+RLS do `CLAUDE.md`)

`permission_modules`/`permissions`/`role_permissions` descrevem o que os 4 Papéis de Sistema fixos podem fazer — isso é **igual em todo tenant**, não é dado de negócio configurável por tenant (diferente de `maintenance_items`, que cada tenant customiza). É catálogo de produto, do mesmo tipo que `platform_admins` (que também não tem `tenant_id`). RLS fica habilitada com policy `SELECT USING (true)` para `authenticated` (leitura livre — dado não sensível) e sem policy de escrita (só migration/`service_role` altera). Quando Papéis Customizados (V2) chegarem, a tabela nova `roles` — essa sim tenant-scoped, com `tenant_id` + RLS completo — referencia `permissions` pelo `id`, sem duplicar o catálogo global.

### 4. Caminho de evolução para V2 (não construído agora)

- Nova tabela `roles` (tenant-scoped): `id, tenant_id, name, created_at, ...` + tabela de junção `role_permission_grants(role_id, permission_id)`.
- `tenant_members` ganha coluna nullable `custom_role_id UUID REFERENCES roles(id)`. Quando presente, o papel efetivo é o customizado; quando `NULL`, continua valendo o `role` fixo atual — **nenhum re-cadastro necessário para usuários já ativos**, atendendo à mitigação de risco do próprio PRD.
- Guards e RLS passam a checar `custom_role_id` antes do `role` fixo — mudança aditiva, não substitui o `CHECK` existente.

Não é implementado nesta Spec; registrado aqui para não ser redescoberto do zero quando V2 for priorizado.

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| RPC SQL atômica para convite (replicar `create_tenant_with_owner`) | Exigiria reproduzir geração de token de convite/recovery do GoTrue via SQL puro — não documentado, alto risco de token inválido silencioso |
| Enforcement já em V1 via `role_permissions` (reescrever RLS/guards agora) | Reescreveria caminho de autorização testado e em produção sem ganho imediato (V1 só tem os 4 papéis fixos) — exatamente o overengineering que o PRD já sinaliza como risco |
| Nenhuma tabela nova, só vocabulário em TS (`@gomoto/core`) | Mais simples agora, mas força V2 a desenhar o schema de permissões do zero — contraria a garantia explícita do PRD de "sem retrabalho estrutural" |
| Permissões como JSONB em `tenant_members` | Sem catálogo centralizado — cada tenant/role reinventaria a lista de permissões livremente, sem validação semântica ("esse módulo existe?") no banco |

## Consequências

### Positivas

- Convite reaproveita mecanismo já provado (`regenerateOwnerLink`) — sem reinventar geração de token.
- Vocabulário de módulos/permissões nasce correto e será 100% reaproveitado em V2 — literalmente "sem retrabalho estrutural" para o catálogo.
- Enforcement V1 não muda — zero risco novo em RLS/guards que já protegem dados sensíveis multi-tenant.
- `tenant_members.role` como `CHECK` fixo continua sendo a fonte de verdade em V1 — nenhuma migração de dados de usuários existentes.

### Negativas

- Convite em dois passos não é atômico — falha entre `generateLink` e o INSERT de vínculo deixa `auth.users` órfão (mitigado por idempotência no reconvite, ver §1).
- Três tabelas novas sem nenhum consumidor de leitura em V1 além do seed — infraestrutura "dormente" até V2, mas de custo baixo (3 tabelas pequenas, 1 seed).
- Checagem de conflito de email (RF-003/004/008/009/010) exige nova RPC `SECURITY DEFINER` (`auth.users` não é acessível via PostgREST) — mais uma função a manter, mesmo padrão de `platform_admins_rpc.sql`.

## Quando reavaliar

- Quando Papéis Customizados (V2) for priorizado — usar o caminho do §4 como ponto de partida, não redesenhar do zero.
- Se o convite em dois passos gerar `auth.users` órfãos com frequência perceptível em produção — considerar mover checagem de conflito + `generateLink` para uma Edge Function com compensação explícita.
- Se `permission_modules`/`permissions` precisarem de rótulo multi-idioma — hoje `label_pt` é fixo em português, mesmo padrão do resto do produto.

## Estado atual (2026-08-08)

Decisão registrada nesta ADR; nada implementado ainda. Implementação segue via Spec 0011 (`obsidian-notes/Specs/0011-modulo-usuarios-acessos.md`), a ser gerada em seguida.

## Referências

- [[PRDs/0011-modulo-usuarios-acessos]] — documento de origem, especialmente §1.2, §9.4 (RN-011) e §11.
- [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]] — `platform_admins`, padrão de audit log, link manual de convite.
- [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] — multi-tenancy, `tenant_id` + RLS.
- `apps/web/src/app/(admin)/admin/empresas/actions.ts` — `regenerateOwnerLink`, padrão de Admin API reaproveitado aqui.
- `supabase/migrations/20260615150400_platform_admins_rpc.sql` — `add_platform_admin_by_email`, comentário sobre `auth.users` não ser acessível via PostgREST.
- `supabase/migrations/20260615150500_tenant_company_profile.sql` — `create_tenant_with_owner`, padrão alternativo descartado para convite.
