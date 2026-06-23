# ADR 0008 — Upgrade Next.js 14 → 16 para habilitar AGENTS.md + next-devtools-mcp

- **Status:** Proposta
- **Data:** 2026-06-23
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Relacionada:** [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] (estrutura monorepo onde `apps/web` vive)

## Contexto

`apps/web` roda **Next.js 14.2.35**. A Vercel publicou em março/2026 duas features oficiais para auxiliar agentes IA em projetos Next.js — ambas exigem Next 16+:

1. **`AGENTS.md` + docs versionados** (`/docs/app/guides/ai-agents`)
   - A partir do Next.js **16.2.0-canary.37**, o pacote `next` inclui a documentação completa em `node_modules/next/dist/docs/` (mirror exato de `nextjs.org/docs`, casada com a versão instalada).
   - Um `AGENTS.md` mínimo na raiz instrui o agente a ler essas docs antes de codar, eliminando dependência de training data desatualizado.
   - `CLAUDE.md` pode importar via `@AGENTS.md` (sintaxe nativa do Claude Code).
   - Em versões 16.1 e anteriores, o codemod `npx @next/codemod@latest agents-md` gera `.next-docs/` — **não há evidência de que funcione em Next 14.x**.

2. **`next-devtools-mcp`** (`/docs/app/guides/mcp`) — **Next.js 16+**
   - MCP server (configurado em `.mcp.json`) que conecta o agente ao dev server rodando.
   - Endpoint built-in em `/_next/mcp` exposto pelo dev server.
   - Ferramentas expostas:
     - `get_errors` — erros de build, runtime e tipo, em tempo real.
     - `get_logs` — logs do dev server e console do browser.
     - `get_routes` — rotas do App Router e Pages Router (com `[param]` / `[...slug]`).
     - `get_page_metadata` — componentes renderizados, layouts, modo de renderização.
     - `get_project_metadata` — estrutura do projeto, URL do dev server.
     - `get_server_action_by_id` — resolve Server Action ID → arquivo + função.

Hoje o agente trabalha às cegas em três pontos críticos: (a) versão exata de APIs Next (sempre risco de sugerir padrão antigo de Pages Router em código App Router); (b) erros de runtime no dev server precisam ser copiados manualmente pelo dev pro chat; (c) inspeção de rotas e Server Actions exige `grep`/`find` em vez de uma query estruturada.

## Decisão

**Adiar o adoption das features até o upgrade Next.js 14 → 16.** Registrar este ADR como rastreamento pra que o upgrade não esqueça desses ganhos colaterais. Quando o upgrade acontecer:

1. Garantir `next` em `apps/web/package.json` ≥ `16.2.0` (não canary em produção).
2. Criar `apps/web/AGENTS.md` com o template oficial:
   ```md
   <!-- BEGIN:nextjs-agent-rules -->
   # Next.js: ALWAYS read docs before coding
   Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.
   <!-- END:nextjs-agent-rules -->
   ```
   Regras específicas do GoMoto vão **fora** dos marcadores `BEGIN/END:nextjs-agent-rules`.
3. Adicionar `@AGENTS.md` no `CLAUDE.md` da raiz ou criar `apps/web/CLAUDE.md` específico que importe.
4. Criar `.mcp.json` na raiz versionado:
   ```json
   {
     "mcpServers": {
       "next-devtools": {
         "command": "npx",
         "args": ["-y", "next-devtools-mcp@latest"]
       }
     }
   }
   ```
5. Remover `.mcp.json` do `.gitignore` (hoje na linha 60) — passa a ser arquivo compartilhado.
6. Atualizar [[CLAUDE]] seção "Plugins Claude Code do projeto" com a etapa "rodar `pnpm dev` em `apps/web` antes de pedir diagnóstico ao agente".

## Alternativas consideradas

1. **Tentar o codemod legacy `npx @next/codemod@latest agents-md` em Next 14.** Rejeitada por ora — a doc oficial menciona "16.1 and earlier" sem confirmar suporte a 14.x; o output `.next-docs/` viria com docs de uma versão de `next` que não é a que o projeto roda, perdendo a garantia "version-matched" que é o ponto inteiro da feature. Pode ser tentado como experimento isolado se alguém quiser.
2. **Escrever `AGENTS.md` manual com regras Next 14 do projeto, sem bundled docs.** Rejeitada — duplica o papel do `CLAUDE.md` atual sem trazer as docs versionadas em si, que é o ganho real.
3. **Adoção parcial: subir só `next-devtools-mcp` sem o upgrade.** Inviável — o MCP exige o endpoint `/_next/mcp` que o dev server do Next 14 não expõe.
4. **Upgrade imediato (este PR).** Rejeitada — Next 14 → 16 traz breaking changes não triviais (async params em layouts/pages, novas semânticas de cache, fetch behavior, possíveis incompatibilidades com Supabase auth helpers). Merece PR dedicado, não rabicho de um setup de plugin.

## Consequências

- **Positivas (após o upgrade):**
  - Agente IA passa a consultar docs casadas com a versão instalada — fim de sugestões baseadas em padrões antigos.
  - Diagnóstico de erros de dev server vira uma query do agente em vez de cópia manual.
  - Inspeção de rotas/Server Actions estruturada via MCP, útil em mudanças grandes.

- **Custos:**
  - Upgrade Next 14 → 16 é trabalho real: revisão de App Router patterns, ajustes em `cookies()` / `headers()` async, possível retrabalho em `apps/web/src/app/**/page.tsx` e `layout.tsx`.
  - `node_modules/next/dist/docs/` aumenta footprint do `node_modules` (aceitável — é só dev).
  - `next-devtools-mcp` é um processo a mais no fluxo de dev; precisa do `pnpm dev` rodando pra ser útil.
  - `.mcp.json` versionado significa que todo contribuidor passa a executar `npx -y next-devtools-mcp@latest` ao abrir o projeto — supply-chain consideration (mitigado por usar versão pinada quando estabilizar).

## Rastreamento

- Versão atual: `apps/web/package.json` → `"next": "14.2.35"`.
- Quando subir, atualizar este ADR pra **Aceita** com data e PR de referência.
- Documentação Vercel:
  - https://nextjs.org/docs/app/guides/ai-agents
  - https://nextjs.org/docs/app/guides/mcp
  - https://github.com/vercel/next-devtools-mcp
