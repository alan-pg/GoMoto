# Instruções para agentes IA — GoMoto

Este arquivo é a porta de entrada para qualquer agente IA trabalhar neste repositório. Leia antes de propor qualquer mudança.

---

## Antes de codar

1. Para ter visão geral do produto, leia `obsidian-notes/GoMoto.md`.
2. Para entender o estado atual, leia `obsidian-notes/Estado Atual.md`.
3. Para entender a direção da arquitetura, leia `obsidian-notes/Arquitetura Proposta.md` (especialmente §9, §10 e §13).
4. Se for mexer em **domínio** (regras, schemas, tipos): leia `obsidian-notes/Arquitetura.md`, `obsidian-notes/Banco de Dados.md`, `obsidian-notes/Fluxos de Negócio.md`.
5. Se for mexer em **tela**: leia `obsidian-notes/Telas/<NomeDaTela>.md`.
6. Se for mexer em **banco**: leia `obsidian-notes/Desenvolvimento Local.md` para entender o workflow de migrations.

## Regras invioláveis

- **Inglês obrigatório** em código: variáveis, funções, classes, colunas de banco, rotas, arquivos.
- **Português permitido** em: labels de UI, JSDoc, comentários, mensagens para o usuário.
- **Tabelas e linhas** sempre em `h-9 text-[13px]` (preferência explícita do usuário).
- **Toda nova tabela** precisa de: `tenant_id NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, RLS habilitada, trigger `update_updated_at_column`, política RLS via `get_user_tenants()` (multi-tenant já implementado).
- **`pnpm build` deve passar** sem erros antes de qualquer commit (roda Turbo em todos os pacotes afetados).
- **Atualizar nota Obsidian relevante** no mesmo PR que muda código de domínio ou tela.

## Padrão canônico de tela (ADR 0002)

**Leituras** via hooks de `@gomoto/data` (`useContracts`, `useMaintenances`, etc.) consumidos no Client Component.

**Mutações** via Server Actions exportadas de `./actions.ts` co-localizada na rota. Cada action:
1. Resolve tenant com `getCurrentTenantId(supabase)` — **server-side, nunca confiar no client**.
2. Valida payload com schema Zod (base em `@gomoto/core`, extensão local quando necessário).
3. Executa a mutação no Supabase.
4. Chama `logAction(...)` para cada linha tocada.
5. Invoca `revalidatePath()` nas rotas afetadas.

## Padrões mortos (não usar como referência)

- ❌ `createClient()` direto em `page.tsx` para **mutações** — todo write deve passar por Server Action (`actions.ts`).
- ❌ `tenant_id` injetado pelo client em INSERT — sempre resolver server-side via `getCurrentTenantId()`.
- ❌ Lógica de negócio dentro de handlers de UI — extrair para função pura em `packages/core/rules`.
- ❌ Schema Zod duplicado em `apps/web` — o schema base vive em `@gomoto/core`; só estender localmente o que não pertence ao domínio.

## Ambiente de banco de dados

O projeto tem **dois ambientes Supabase**:

| Ambiente | Quando usar |
|---|---|
| **Local (Docker)** | Sempre que estiver desenvolvendo ou testando. URL: `http://127.0.0.1:54321`. |
| **Cloud (`hcnxbqunescfanqzmsha`)** | Produção. Só receber mudanças via `supabase db push` controlado por humano. |

### Regras críticas para mudanças de schema

- **NUNCA** rode `supabase db push`, `psql` ou MCP Supabase contra o projeto cloud sem confirmação explícita do humano.
- Toda mudança de schema vira **arquivo versionado** em `supabase/migrations/`. Use `supabase migration new <nome>` para criar.
- Para reproduzir um bug ou testar localmente: `pnpm db:reset` zera o estado e roda o seed.
- Para gerar migration a partir de mudanças no Studio local: `pnpm db:diff <nome>`.
- O seed em `supabase/seed.sql` é a fonte de dados de desenvolvimento. Atualize-o se mudar entidades.

Detalhes do fluxo: `obsidian-notes/Desenvolvimento Local.md`.

## Fluxo de PR esperado

1. **Atualizar/criar nota** em `obsidian-notes/` relevante.
2. **Implementar mudança**:
   - Se mexe em domínio → função pura em `packages/core` + teste Vitest.
   - Se mexe em acesso a dados → hook/repositório em `packages/data`.
   - Se mexe em UI → componente/tela em `apps/web/` ou `apps/mobile/`.
3. **Validar**: `pnpm build` (turbo, todos pacotes afetados), `pnpm test` (E2E quando relevante), `pnpm db:reset` se mexeu em schema.
4. **Commit** com mensagem em português, prefixo convencional (`feat`, `fix`, `chore`, `docs`, `refactor`).
5. **Push e PR** apenas se o humano pedir.

## Estrutura atual do monorepo

Fases concluídas: **0** (bootstrap), **0.1** (Supabase local), **1** (monorepo), **2** (`packages/core`), **3** (ADR 0002 — padrão canônico de tela), **4** (`packages/data`), **4-bis** (`apps/mobile`), **5** (multi-tenancy + RLS via `get_user_tenants()`).

```
/
├── apps/
│   ├── web/           # Next.js 14 — cockpit do operador
│   │   ├── src/
│   │   ├── tests/     # Playwright E2E
│   │   └── .env.local
│   └── mobile/        # @gomoto/mobile — Expo SDK 56 + Expo Router — app do cliente
├── packages/
│   ├── core/          # @gomoto/core — Zod schemas, regras puras, types (sem I/O)
│   └── data/          # @gomoto/data — hooks TanStack Query + repositórios Supabase
├── supabase/          # migrations + seed
├── obsidian-notes/    # documentação fonte da verdade
├── tsconfig.base.json
├── turbo.json
└── pnpm-workspace.yaml
```

Comandos padrão na raiz: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm typecheck` — todos delegam para Turbo.

`pnpm test` roda **unit tests** (Vitest). Para Playwright E2E: `pnpm --filter web test:e2e`. Para rodar só um pacote: `pnpm --filter web dev`.

**Onde colocar o quê:**
- Schemas Zod, types, regras de negócio puras → `@gomoto/core` (`packages/core/`). Nunca duplicar em `apps/`.
- Hooks de leitura (TanStack Query) e repositórios Supabase → `@gomoto/data` (`packages/data/`).
- UI web → `apps/web/src/app/(dashboard)/<tela>/page.tsx` + `actions.ts`.
- UI mobile → `apps/mobile/src/screens/` ou `apps/mobile/src/app/` (Expo Router).

Use sempre o estado **atual** do código como verdade — leia os arquivos em vez de inferir o que existe.

## Plugins Claude Code do projeto

Este repo versiona `.claude/settings.json` para que todos os contribuidores tenham os mesmos plugins habilitados. `settings.local.json` continua ignorado (permissões pessoais).

### Mercado Pago (`mercadopago@mercadopago-claude-marketplace`)

Skills: `mp-integrate`, `mp-webhooks`, `mp-test-setup`, `mp-review`. Comandos: `/mp-connect`, `/mp-integrate`, `/mp-review`.

**Setup por contribuidor (uma vez):**

1. Aceitar o marketplace quando o Claude Code perguntar (declarado em `extraKnownMarketplaces`).
2. Rodar `/mp-connect` — faz OAuth pessoal contra `mcp.mercadopago.com`. Sem isso, todas as skills MP se recusam a operar.
3. (Opcional) Para desabilitar o hook de leak prevention em sessões que mexem só em `.env.local` sem código MP, criar `.claude/mercadopago.local.md` com `enabled: false` (arquivo pessoal, ignorado pelo git).

O hook do plugin **bloqueia leitura de `.env`** e escrita de credenciais MP hardcoded — isso é desejado, não contornar.

### CLAUDE.md management (`claude-md-management@claude-plugins-official`)

Skill `claude-md-improver` audita este arquivo contra o estado real do código (drift entre o que prometemos e o que existe). Comando `/revise-claude-md` captura aprendizados da sessão atual pra adicionar aqui.

Sem MCP, sem auth, sem hook. Habilitado automaticamente ao aceitar o marketplace `claude-plugins-official`.

## Operações destrutivas

Sem aprovação explícita do humano, NÃO execute:

- `git push --force` em qualquer branch.
- `git reset --hard` que descarte mudanças não commitadas.
- `rm -rf` em pastas com conteúdo não commitado.
- Qualquer operação que afete o projeto Supabase cloud (`hcnxbqunescfanqzmsha`).
- Instalação global de pacotes que mude o ambiente do desenvolvedor.

## Decisões arquiteturais

ADRs ficam em `obsidian-notes/decisions/`. Cada decisão significativa vira um ADR curto. Se você está prestes a tomar uma decisão arquitetural não documentada (escolher entre A e B, descartar uma abordagem, adotar uma nova dependência grande), rascunhe um ADR e peça revisão humana antes de implementar.
