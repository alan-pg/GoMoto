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

- Node.js 22+
- PNPM 11+ (migração em curso; `npm` ainda funciona enquanto a Fase 1 não termina)
- Docker + Docker Compose (para Supabase local)
- Supabase CLI (`npm i -g supabase` ou via gestor de pacotes do SO)

## Setup local

```bash
# 1. Variáveis de ambiente
cp .env.local.example .env.local
# Preencha com as chaves locais (saída de `supabase status`)

# 2. Dependências
npm install      # ou: pnpm install (após Fase 1)

# 3. Banco local (Postgres + Auth + Storage + Studio)
npm run db:start
npm run db:reset    # aplica migrations + seed

# 4. App web
npm run dev
# http://localhost:3000
```

## Comandos principais

| Comando | Função |
|---|---|
| `npm run dev` | Sobe Next.js em modo desenvolvimento |
| `npm run build` | Build de produção |
| `npm run lint` | Lint do projeto |
| `npm run test` | Playwright E2E |
| `npm run db:start` | Sobe o stack Supabase local (Docker) |
| `npm run db:stop` | Derruba o stack |
| `npm run db:reset` | Reseta o banco local: roda migrations + seed |
| `npm run db:diff` | Gera nova migration a partir de mudanças no Studio local |
| `npm run db:status` | Mostra URLs e chaves do stack local |

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
├── src/                    ← código Next.js (migra para apps/web/ na Fase 1)
├── supabase/               ← migrations versionadas + seed local
├── obsidian-notes/         ← documentação do produto (migra para docs/ na Fase 1)
├── tests/                  ← Playwright
└── README.md
```

A estrutura final do monorepo (apps/, packages/, docs/) está descrita em [`obsidian-notes/Arquitetura Proposta.md`](./obsidian-notes/Arquitetura%20Proposta.md), §10.

## Para agentes IA

Antes de propor qualquer mudança, leia [`CLAUDE.md`](./CLAUDE.md) na raiz. Ele define os pontos de entrada da documentação Obsidian, as regras invioláveis (idioma, padrões mortos a evitar) e o fluxo esperado de PR.

## Estado da migração

| Fase | Status |
|---|---|
| 0 — Preparação | 🟡 em andamento |
| 0.1 — Supabase local com Docker | 🟡 em andamento |
| 1 — Estrutura de monorepo | ⚪ pendente |
| 2 — `packages/core` | ⚪ pendente |
| 3 — Regras de negócio | ⚪ pendente |
| 4 — `packages/data` | ⚪ pendente |
| 4-bis — Bootstrap mobile | ⚪ pendente |
| 5 — Multi-tenancy + RLS | ⚪ pendente |
| 6 — Edge Functions | ⚪ pendente |
| 7 — Telas mobile (incremental) | ⚪ pendente |
| 8 — Skills e CI para IA | ⚪ pendente |

Plano completo em [`obsidian-notes/Arquitetura Proposta.md`](./obsidian-notes/Arquitetura%20Proposta.md), §13.
