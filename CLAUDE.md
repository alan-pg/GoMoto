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
- **Toda nova tabela** precisa de: `tenant_id` (após Fase 5), RLS habilitada, trigger `update_updated_at_column`, política RLS por `auth.uid()` + `tenant_id`.
- **`npm run build` deve passar** sem erros antes de qualquer commit.
- **Atualizar nota Obsidian relevante** no mesmo PR que muda código de domínio ou tela.

## Padrões mortos (não usar como referência)

- ❌ `src/app/**/actions.ts` — código morto. As páginas atuais usam Supabase direto via `createClient()` no client. Não copie esse padrão; quando refatorar uma tela, mova a lógica para `packages/core` (Fase 3) e o acesso a dados para `packages/data` (Fase 4).
- ❌ Fetch direto via `createClient()` dentro de `page.tsx` — é o padrão atual mas é anti-padrão segundo a [arquitetura proposta](./obsidian-notes/Arquitetura%20Proposta.md). Novo código deve consumir hooks de `packages/data` quando ele existir.
- ❌ Lógica de negócio dentro de handlers de UI — extrair para função pura em `packages/core/rules`.

## Ambiente de banco de dados

O projeto tem **dois ambientes Supabase**:

| Ambiente | Quando usar |
|---|---|
| **Local (Docker)** | Sempre que estiver desenvolvendo ou testando. URL: `http://127.0.0.1:54321`. |
| **Cloud (`hcnxbqunescfanqzmsha`)** | Produção. Só receber mudanças via `supabase db push` controlado por humano. |

### Regras críticas para mudanças de schema

- **NUNCA** rode `supabase db push`, `psql` ou MCP Supabase contra o projeto cloud sem confirmação explícita do humano.
- Toda mudança de schema vira **arquivo versionado** em `supabase/migrations/`. Use `supabase migration new <nome>` para criar.
- Para reproduzir um bug ou testar localmente: `npm run db:reset` zera o estado e roda o seed.
- Para gerar migration a partir de mudanças no Studio local: `npm run db:diff <nome>`.
- O seed em `supabase/seed.sql` é a fonte de dados de desenvolvimento. Atualize-o se mudar entidades.

Detalhes do fluxo: `obsidian-notes/Desenvolvimento Local.md`.

## Fluxo de PR esperado

1. **Atualizar/criar nota** em `obsidian-notes/` relevante.
2. **Implementar mudança**:
   - Se mexe em domínio → função pura em `packages/core` + teste Vitest (após Fase 2).
   - Se mexe em acesso a dados → repositório em `packages/data` (após Fase 4).
   - Se mexe em UI → componente/tela em `apps/web/` ou `apps/mobile/`.
3. **Validar**: `npm run build` (web), `npm run test` (E2E quando relevante), `npm run db:reset` se mexeu em schema.
4. **Commit** com mensagem em português, prefixo convencional (`feat`, `fix`, `chore`, `docs`, `refactor`).
5. **Push e PR** apenas se o humano pedir.

## Estado da migração para monorepo

Estamos saindo de monolito Next.js para monorepo PNPM + Turborepo. Veja `obsidian-notes/Arquitetura Proposta.md` §13.

Enquanto a Fase 1 não terminar, a estrutura ainda é `src/` na raiz. Use sempre o estado **atual** do código como verdade — não antecipe estrutura de fases futuras em código que não foi migrado.

## Operações destrutivas

Sem aprovação explícita do humano, NÃO execute:

- `git push --force` em qualquer branch.
- `git reset --hard` que descarte mudanças não commitadas.
- `rm -rf` em pastas com conteúdo não commitado.
- Qualquer operação que afete o projeto Supabase cloud (`hcnxbqunescfanqzmsha`).
- Instalação global de pacotes que mude o ambiente do desenvolvedor.

## Decisões arquiteturais

ADRs ficam em `obsidian-notes/decisions/`. Cada decisão significativa vira um ADR curto. Se você está prestes a tomar uma decisão arquitetural não documentada (escolher entre A e B, descartar uma abordagem, adotar uma nova dependência grande), rascunhe um ADR e peça revisão humana antes de implementar.
