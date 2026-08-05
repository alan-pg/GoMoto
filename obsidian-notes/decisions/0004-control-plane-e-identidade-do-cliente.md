# ADR 0004 — Control plane multi-tenant + identidade do cliente

- **Status:** Aceita
- **Data:** 2026-06-15
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] (multi-tenancy P2), [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] (auth do cliente)
- **PRD de origem:** [[PRDs/0001-area-administrativa-plataforma]]

## Contexto

A Fase 5 da [[Arquitetura Proposta]] entregou o **tenant plane**: `tenant_id` em 15 tabelas, RLS via `get_user_tenants()`, roles `owner/admin/operator/viewer` em `tenant_members`. Faltam duas peças cuja ausência bloqueia a operação de GoMoto como SaaS:

1. **Control plane** — área onde se cadastra, suspende, mede e audita as empresas-cliente (tenants). Hoje, criar tenant exige `service_role` via CLI/seed; ninguém pode operar a plataforma como produto.
2. **Identidade do cliente final como cidadão de N tenants** — cenário comum (cliente fecha contrato com Locadora A e abre com B) sem modelagem clara. ADR 0003 deixou o schema preparado (UNIQUE parcial `(tenant_id, user_id)`), mas faltam: identidade global (CPF), UX de seleção pós-login, fluxo de cadastro-cruzando-tenants.

Este ADR formaliza as 11 decisões consolidadas em [[PRDs/0001-area-administrativa-plataforma]] §13.

## Decisão

### 1. Modelo de papel de plataforma — tabela `platform_admins`

Nova tabela explícita:

```sql
CREATE TABLE platform_admins (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'operator')) DEFAULT 'operator',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES auth.users(id)
);
```

Helpers `is_platform_admin()` e `get_platform_role()` (`SECURITY DEFINER`) consumidos por policies RLS e middleware. Convive com `tenant_members` sem mistura — um `auth.users` pode ser ambos.

### 2. Roles dentro do control plane — `owner` e `operator`

- **`platform_owner`:** cria/suspende tenants, promove/demove platform admins.
- **`platform_operator`:** somente leitura no `/admin/*`. Atende suporte sem poder destrutivo.

Sem `viewer` por enquanto — `operator` já cobre o caso.

### 3. Bypass de RLS para platform admin em camadas

Toda policy de tabela de domínio ganha cláusula adicional `OR is_platform_admin()`. Plataforma enxerga tudo de tudo. **Toda leitura platform-bypass é auditada** em `platform_audit_logs` (escrita só por Server Action explícita; leitura não — auditoria de leitura cross-tenant fica para fase futura se virar requisito de compliance).

### 4. Suspensão de tenant — duas camadas

```sql
ALTER TABLE tenants ADD COLUMN
    suspended_at      TIMESTAMPTZ NULL,
    suspended_reason  TEXT NULL,
    suspended_by      UUID REFERENCES auth.users(id);
```

- **RLS:** todas as policies de domínio passam a checar `tenant_id IN (SELECT t.id FROM tenants t WHERE t.id IN (SELECT get_user_tenants()) AND t.suspended_at IS NULL)`. Tenant suspenso → dados invisíveis para membros, mesmo via API direta.
- **Middleware do web:** rejeita sessão de `tenant_member` cujo único tenant ativo está suspenso, mostrando "Locadora temporariamente indisponível".

Platform admin ignora as duas camadas — precisa investigar tenant suspenso para suporte.

### 5. Exclusão de tenant — **fora do V1**

Apenas suspensão indefinida. Hard delete reabre se aparecer requisito legal (LGPD apagamento solicitado pelo dono da locadora) — vira ADR próprio.

### 6. Bootstrap do primeiro platform admin — migration explícita

A migration `<ts>_platform_admin.sql` faz `INSERT INTO platform_admins` para `admin@gomoto.dev` (user já existente no seed) com `role = 'owner'`. Explícito, versionado, replicável em qualquer ambiente. Em produção, equivalente substituirá o email pelo da Alan.

### 7. Magic link manual no V0 (sem Resend)

`/admin/empresas/nova` retorna o magic link num modal copiável; platform admin envia por WhatsApp/email externo até integração Resend (F9 do PRD). Mesmo padrão já provado para o convite do cliente mobile (commit `06054f3`).

### 8. Impersonação de tenant (login-as) — **fora do V1**

Risco de segurança alto vs benefício especulativo. Reabrir se surgir caso de suporte concreto onde "ver como tenant X" seja necessário e a foto via Studio + service_role com log explícito não baste.

### 9. Self-service signup de tenant — **fora do V1**

Onboarding é manual via platform owner. Quando produto justificar (alta volumetria de leads), vira PRD próprio com fluxo de aprovação.

### 10. Identidade global do cliente final — CPF `UNIQUE`

```sql
ALTER TABLE customers ALTER COLUMN cpf SET NOT NULL;
CREATE UNIQUE INDEX customers_cpf_global_unique ON customers(cpf);
```

**Consequências:**
- Mesma pessoa = mesmo CPF em todos os tenants onde é cliente.
- Cadastro de cliente reaproveita `auth.users` se CPF já existe em outro tenant.
- Locadora A não enxerga dados da Locadora B sobre o mesmo cliente (RLS por tenant continua valendo).
- ADR 0003 §2 fica reforçado — UNIQUE parcial `(tenant_id, user_id)` continua, agora complementado por UNIQUE global em `cpf`.

### 11. Login do cliente mobile — CPF via shell email

Supabase Auth exige email único. Em vez de brigar, sintetizamos:

```ts
shell_email(cpf) = cpf.replace(/\D/g, '') + '@cliente.gomoto.app'
```

- `auth.users.email` armazena o shell — **nunca exibido** ao usuário.
- Cliente digita CPF + senha; app monta shell email e chama `signInWithPassword`.
- `customers.email` continua existindo para contato real (NF, comunicação), opcional.
- Recuperação de senha no V1: platform admin / operador da locadora regenera magic link; SMS/WhatsApp em fase futura.

Admin web **continua** com email/senha — sem mudança.

### 12. Cliente em N tenants — picker dedicado pós-login

Após `signInWithPassword`, app consulta `customers WHERE user_id = auth.uid()`:

- **N=1:** AsyncStorage grava `selectedTenantId` e vai direto pras tabs.
- **N≥2:** tela `/select-tenant` lista as locadoras (nome, status do contrato atual, data do último). Cliente escolhe; troca sempre disponível no header.

Função `current_customer_ids()` já é `SETOF UUID` (commit `c9c3e9c`) — RLS funciona out-of-the-box.

### 13. Tenant member em múltiplos tenants — fora do V1

Operador/admin trabalhando em duas locadoras é cenário raro. Se ocorrer, a pessoa cria contas com emails diferentes. **Sem switcher de tenant ↔ tenant** no web. O único switcher é **plataforma ↔ tenant** (caso D11 do PRD): quando o mesmo user é `platform_admin` E `tenant_member`.

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| **Claim `platform_role` em `auth.users.raw_app_meta_data` (JWT)** | Exige hook custom do Supabase Auth, dificulta revogação via UI, queries em policy ficam menos legíveis (`auth.jwt()->>'platform_role'` vs `is_platform_admin()`). Tabela explícita é mais auditável. |
| **`tenants.active BOOLEAN` em vez de `suspended_at`** | Bool perde a informação de **quando** e **por quê**. Timestamp + reason + actor = trilha auditável sem custo. Coluna `active` legacy fica até a próxima limpeza. |
| **Login do cliente por email (não CPF)** | Demografia do locatário de moto: muitos não têm/lembram email; CPF é universal. Brigar com Supabase Auth para puro CPF-login custaria mais que o shell email. |
| **Tabela `people` global + `customer_profiles` por tenant** | Indireção sem ganho enquanto o conjunto de campos de `customers` é pequeno (cpf, nome, telefone, email). Migrar depois é trivial se virar problema; agora seria overengineering. |
| **Subdomain por tenant (`bonze.gomoto.com.br`)** | Custo de wildcard DNS + SSL + roteamento; valor real só aparece quando branding por tenant for produto. Picker pós-login resolve o problema de identidade de tenant a custo zero. |
| **Hard delete de tenant no V1** | Cascade em 15 tabelas + audit logs perdidos. Suspensão cobre 100% dos casos atuais sem risco. |
| **Impersonação (login-as) no V1** | Vetor clássico de incident de segurança e exposição LGPD. Não há demanda comprovada — Studio + service_role atende suporte por enquanto. |

## Consequências

### Positivas

- **Camada de plataforma desbloqueia operação como SaaS.** Onboarding manual de tenant deixa de exigir CLI.
- **Defesa em camadas para suspensão.** RLS é fonte de verdade, middleware é UX.
- **CPF como identidade global** simplifica suporte ("qual seu CPF" funciona em qualquer tenant) e elimina contas duplicadas do mesmo cliente.
- **Shell email mantém Supabase Auth nativo.** Magic link, OAuth (futuro admin), recuperação por email — tudo continua funcionando.
- **`current_customer_ids()` já estava pronta** para N tenants (ADR 0003 §3) — implementação F3 do PRD é só UX.
- **Cada decisão é reversível.** Tabela `platform_admins` pode virar JWT depois; shell email pode virar CPF-puro se mudar de auth provider; suspended_at pode ganhar hard delete.

### Negativas

- **Service role key fica mais usada.** Criação de `auth.users` para owner inicial + cliente, geração de magic link. Mantém-se a regra: só Server Actions consomem.
- **Migration `customers_cpf_global` exige pré-checagem.** Hoje sem conflito esperado (seed tem 1 cliente), mas em produção real precisa rodar a query do PRD §10.3 antes.
- **Bypass RLS por platform admin abre superfície de auditoria futura.** V1 audita só escritas; leituras cross-tenant ficarão sem trilha até virar requisito de compliance.
- **Mobile precisa de validação de CPF dupla** (client-side antes de montar shell email, server-side antes de criar `auth.users`). Função pura em `@gomoto/core/rules/cpf` é fonte única.
- **Cliente que troca de locadora pode estranhar** que o login (CPF + senha) continua o mesmo. Mitigado por UX clara no picker: "Você é cliente de N locadoras".

### Neutras

- **`tenants.active` permanece como coluna legada** até próxima limpeza. Sem custo, sem uso.
- **Sem branding por tenant.** Logo/cores da locadora no app fica para fase futura.
- **Sem SMS/WhatsApp para recuperação de senha.** Cliente que esquecer pede para o operador regenerar magic link.

## Quando reavaliar

- **Volume de tenants > 50** → considerar self-service signup (decisão 9) e branding por tenant.
- **Auditoria de leitura cross-tenant vira requisito de compliance** → adicionar wrapper de query do platform admin que loga toda agregação.
- **Cliente precisa escrever no mobile** (pagar boleto, abrir chamado) → reavaliar RLS read-only (ver ADR 0003 §5) e definir Server Actions/Edge Functions para cliente.
- **Operador trabalhando em N tenants** virar realidade → adicionar switcher tenant ↔ tenant no web (decisão 13).
- **CPF deixar de ser único globalmente** (cenário hipotético de cliente PJ multinacional) → revisar identidade global; possível migração para `documento + país`.
- **Hard delete de tenant** virar requisito legal (LGPD do dono da locadora pedindo apagamento) → reabrir decisão 5.

## Estado atual (2026-06-15)

- Schema do control plane: **a criar** (migration F1 do PRD).
- `customers.cpf` UNIQUE global: **a criar** (migration F2 do PRD).
- `tenants.suspended_at` + columns: **a criar** (migration F1).
- Função `current_customer_ids()`: **já existe** (commit `c9c3e9c`) — atende N tenants sem mudança.
- Login mobile por email: **trocar por CPF** (F3 do PRD).
- Tela `select-tenant.tsx`: **a criar** (F3).
- `admin@gomoto.dev` no seed: **promover** a `platform_owner` na migration F1.

## Referências

- [[PRDs/0001-area-administrativa-plataforma]] — documento de origem com escopo completo, telas, fluxos, faseamento.
- [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] — adoção do monorepo + premissa P2 (multi-tenant).
- [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] — auth do cliente; este ADR estende §2 (CPF UNIQUE global) e §3 (picker dedicado em `/select-tenant`).
- [[Arquitetura Proposta]] §13 — Fase 5 (multi-tenancy) entregue.
- `supabase/migrations/20260611232140_tenants_and_tenant_members.sql` — tenants + tenant_members.
- `supabase/migrations/20260612220223_add_customer_user_link.sql` — UNIQUE parcial que habilita cliente em N tenants.
- `supabase/migrations/20260613014117_customer_read_policies.sql` — `current_customer_ids()` SETOF.
