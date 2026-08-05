# ADR 0001 — Monorepo com PNPM Workspaces + Turborepo

- **Status:** Aceita
- **Data:** 2026-06-10
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —

## Contexto

O GoMoto é hoje um monolito Next.js 14 + Supabase, com 14 telas, ~50 arquivos em `src/`, 15 tabelas e documentação rica em `obsidian-notes/`. O produto vai evoluir para:

- App **mobile nativo** (Android + iOS) compartilhando regras de negócio com a web.
- Operação **multi-tenant** (será SaaS B2B).
- Desenvolvimento assistido por **agentes IA** com acesso pleno ao repositório.
- Equipe permanece **enxuta** (1–3 devs + agentes).

A análise completa das alternativas (polirepo, Nx, backend dedicado, universal app/Tamagui) está em `obsidian-notes/Arquitetura Proposta.md` §3.

## Decisão

Adotar **monorepo com PNPM Workspaces + Turborepo**, com a seguinte topologia:

```
gomoto/
├── apps/
│   ├── web/         ← Next.js (migra de src/)
│   └── mobile/      ← Expo + Expo Router (novo)
├── packages/
│   ├── core/        ← domínio puro (types, schemas Zod, regras)
│   ├── data/        ← repositórios Supabase tipados, hooks TanStack Query
│   ├── design-tokens/
│   └── config/      ← tsconfig, eslint compartilhados
├── supabase/        ← migrations versionadas, Edge Functions
└── docs/            ← obsidian-notes/ migra para cá
```

Compartilhar **lógica e contratos** (`core`, `data`, `design-tokens`), **não componentes UI** (UIs web e mobile permanecem separadas).

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| **A — Polirepo** com `gomoto-shared` publicado no npm | Overhead de versionamento para 1–3 devs; documentação Obsidian fica em um repo só → drift garantido |
| **C — Nx** | Curva de aprendizado e complexidade conceitual (executors, generators, project.json) não compensam para 2 apps + equipe enxuta |
| **D — Backend dedicado** (NestJS/Hono/tRPC) | Dobra a superfície de manutenção; resolve um problema que não existe hoje; perde Auth/Realtime/Storage do Supabase. Reavaliar se Supabase virar gargalo |
| **E — Universal App** (Expo Router web + mobile, Tamagui) | Descarta investimento atual em Next.js; Recharts, Leaflet, Tailwind não funcionam nativamente; UX web e mobile devem divergir num ERP |

Detalhes e pontuação ponderada em `obsidian-notes/Arquitetura Proposta.md` §3.6.

## Premissas confirmadas

Validadas com o stakeholder em 2026-06-10:

| # | Premissa |
|---|---|
| P1 | Mobile **somente Android e iOS** (sem mobile web). |
| P2 | Operação **será multi-tenant** (não é "talvez no futuro"). |
| P3 | Equipe permanece **enxuta** (1–3 devs + agentes IA). |
| P4 | Supabase como backend; backend dedicado só num futuro distante. |
| P5 | Agentes IA têm acesso ao repositório completo, incluindo `obsidian-notes/`. |
| P6 | Mobile recebe **projeto base cedo** e é implementado **aos poucos**. |

## Consequências

### Positivas

- Domínio em `packages/core` é fonte única de verdade para web, mobile e Edge Functions.
- Documentação Obsidian vira contexto operacional para agentes IA.
- Schemas Zod + regras puras destravam testes unitários rápidos (Vitest).
- Caminho direto para multi-tenancy (Fase 5 do plano) e Edge Functions (Fase 6).
- Vercel deploy continua funcionando, apontando para `apps/web/` como root.

### Negativas / riscos aceitos

- Curva de ~1 semana para devs sem experiência em monorepo.
- TypeScript paths e module resolution entre Next.js e Metro (Expo) exigem configuração cuidadosa.
- Cache do Turborepo precisa de hashes corretos (especialmente para arquivos `docs/`).
- Mobile entrar em produção antes do RLS por tenant estar correto é risco crítico — mitigado pelo gate da Fase 5.

### Neutras

- `actions.ts` mortos serão apagados (Fase 3).
- `obsidian-notes/` será movido para `docs/` (Fase 1).

## Plano de migração

Resumo (detalhes em `obsidian-notes/Arquitetura Proposta.md` §13):

1. **Fase 0** — Preparação (README, CLAUDE.md, ADR, tag de backup).
2. **Fase 0.1** — Supabase local com Docker.
3. **Fase 1** — Estrutura de monorepo (mover `src/` → `apps/web/`).
4. **Fases 2–4** — Extrair `packages/core` e `packages/data`.
5. **Fase 4-bis** — Bootstrap `apps/mobile`.
6. **Fase 5** — Multi-tenancy completa + RLS por tenant.
7. **Fases 6–8** — Edge Functions, telas mobile incrementais, skills IA.

## Referências

- `obsidian-notes/Arquitetura Proposta.md` — análise completa e justificativa.
- `obsidian-notes/Arquitetura.md` — estado atual.
- `obsidian-notes/Estado Atual.md` — snapshot operacional.
