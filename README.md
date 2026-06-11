# GoMoto

ERP de locadora de motocicletas. Web (Next.js 14) + Supabase. Em migração para monorepo PNPM/Turborepo, com app mobile (Expo) chegando em paralelo.

> Para a visão completa de arquitetura, regras de negócio e telas, veja a base de conhecimento em [`obsidian-notes/`](./obsidian-notes/GoMoto.md). Para a proposta de evolução desta arquitetura, veja [`obsidian-notes/Arquitetura Proposta.md`](./obsidian-notes/Arquitetura%20Proposta.md).

## Stack atual

- **Web:** Next.js 14 (App Router) · React 18 · TypeScript · TailwindCSS
- **Backend:** Supabase (Postgres + Auth + Storage)
- **UI:** Lucide · Leaflet · Recharts
- **Validação:** Zod
- **Testes:** Playwright E2E

## Pré-requisitos

- Node.js 20+ (22 LTS recomendado)
- PNPM 10+ (`npm i -g pnpm` ou `corepack enable`)
- Docker + Docker Compose (para Supabase local)
- Supabase CLI (`npm i -g supabase` ou via gestor de pacotes do SO)

## Setup local

```bash
# 1. Variáveis de ambiente
cp apps/web/.env.local.example apps/web/.env.local
# Preencha com as chaves locais (saída de `pnpm db:status`)

# 2. Dependências (workspace inteiro)
pnpm install

# 3. Banco local (Postgres + Auth + Storage + Studio)
pnpm db:start
pnpm db:reset       # aplica migrations + seed

# 4. App web (Turbo aciona o pacote `web`)
pnpm dev
# http://localhost:3000
```

## Comandos principais

Todos rodam na raiz e são orquestrados pelo Turborepo.

| Comando | Função |
|---|---|
| `pnpm dev` | Sobe os apps em modo desenvolvimento (Turbo) |
| `pnpm build` | Build de produção de todos os pacotes |
| `pnpm lint` | Lint do workspace |
| `pnpm test` | Roda testes (Playwright E2E no web) |
| `pnpm typecheck` | Type-check em todos os pacotes |
| `pnpm --filter web <cmd>` | Roda um comando só no pacote `web` |
| `pnpm db:start` | Sobe o stack Supabase local (Docker) |
| `pnpm db:stop` | Derruba o stack |
| `pnpm db:reset` | Reseta o banco local: roda migrations + seed |
| `pnpm db:diff` | Gera nova migration a partir de mudanças no Studio local |
| `pnpm db:status` | Mostra URLs e chaves do stack local |

## Endpoints do Supabase local

| Serviço | URL |
|---|---|
| API (Postgrest + Auth) | http://127.0.0.1:54321 |
| Studio (admin web) | http://127.0.0.1:54323 |
| Inbucket (capturador de emails) | http://127.0.0.1:54324 |
| Postgres direto | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

## Estrutura atual

```
GoMoto/
├── apps/
│   └── web/                ← Next.js 14 (src/, tests/, configs)
├── packages/               ← vazio — Fases 2-4 vão preencher
├── supabase/               ← migrations versionadas + seed local
├── obsidian-notes/         ← documentação do produto
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── README.md
```

A estrutura final do monorepo (com `packages/core`, `packages/data`, `apps/mobile`) está descrita em [`obsidian-notes/Arquitetura Proposta.md`](./obsidian-notes/Arquitetura%20Proposta.md), §10.

## Para agentes IA

Antes de propor qualquer mudança, leia [`CLAUDE.md`](./CLAUDE.md) na raiz. Ele define os pontos de entrada da documentação Obsidian, as regras invioláveis (idioma, padrões mortos a evitar) e o fluxo esperado de PR.

## Estado da migração

| Fase | Status |
|---|---|
| 0 — Preparação | ✅ concluída |
| 0.1 — Supabase local com Docker | ✅ concluída |
| 1 — Estrutura de monorepo | ✅ concluída |
| 2 — `packages/core` | ⚪ pendente |
| 3 — Regras de negócio | ⚪ pendente |
| 4 — `packages/data` | ⚪ pendente |
| 4-bis — Bootstrap mobile | ⚪ pendente |
| 5 — Multi-tenancy + RLS | ⚪ pendente |
| 6 — Edge Functions | ⚪ pendente |
| 7 — Telas mobile (incremental) | ⚪ pendente |
| 8 — Skills e CI para IA | ⚪ pendente |

Plano completo em [`obsidian-notes/Arquitetura Proposta.md`](./obsidian-notes/Arquitetura%20Proposta.md), §13.
