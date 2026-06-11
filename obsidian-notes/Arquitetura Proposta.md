# 🏛️ Arquitetura Proposta — [[GoMoto]]

> Documento de análise e recomendação arquitetural para evolução do GoMoto em direção a uma plataforma multi-cliente (web + mobile), com forte colaboração entre desenvolvedores humanos e agentes de IA.
>
> **Data:** 2026-06-10
> **Autor:** Análise arquitetural assistida por agente
> **Status:** Proposta para revisão

---

## 0. Premissas confirmadas

Validadas com o stakeholder em 2026-06-10. Resumo das respostas e consequências práticas em cada uma.

| # | Premissa | Resposta confirmada | Consequência arquitetural |
|---|---|---|---|
| P1 | Escopo do mobile | **Somente Android e iOS** — não há mobile web | Não precisa de `react-native-web` nem Tamagui cross-platform; UI mobile pode usar componentes nativos puros (NativeWind/React Native) |
| P2 | Modelo de tenancy | **Vai ser multi-tenant** | Multi-tenancy é prioridade desde o dia 1 da migração, não preparação opcional. Ver §13 Fase 2-bis |
| P3 | Tamanho da equipe | **Permanece enxuta** (1–3 devs + agentes IA) | PNPM Workspaces + Turborepo confirmados (Nx descartado) |
| P4 | Backend | **Supabase agora; backend dedicado só num futuro distante** | Edge Functions cobrem o gap; nenhum trabalho de backend dedicado no plano |
| P5 | Acesso da IA à doc | **IA tem acesso ao repo completo, incluindo `obsidian-notes/`** | Estratégia de docs-as-code confirmada; `docs/` migra para raiz e vira contexto operacional |
| P6 | Janela de migração | **Mobile recebe projeto base cedo e é implementado aos poucos** | Bootstrap do mobile sobe na ordem do plano (Fase 4-bis, paralelo à extração de domínio) — telas migram incrementalmente |

> ✅ Todas as premissas confirmadas. Diferenças relevantes em relação à versão anterior do plano estão destacadas em **negrito** nas seções §2, §12 e §13.

---

## 1. Diagnóstico do cenário atual

### 1.1 Estado real do código

- **Tipo:** monolito Next.js 14 (App Router), 50 arquivos em `src/`, 14 telas de CRUD.
- **Backend:** Supabase (Postgres + Auth + Storage), projeto `hcnxbqunescfanqzmsha`.
- **Padrão de dados:** chamadas Supabase **direto do client component** (`createClient()` no browser). Server Actions (`actions.ts` por tela) existem mas estão documentadas como **código morto** ([[Guia de Desenvolvimento]]).
- **Validação:** Zod em `src/lib/schemas.ts` (~100 linhas).
- **Tipos:** `src/types/index.ts` (~370 linhas) com JSDoc extenso em PT-BR.
- **Convenções fortes:** código em inglês, UI/JSDoc em português, tabelas `h-9 text-[13px]`, RLS obrigatória em toda tabela nova.
- **Testes:** Playwright E2E (`tests/`), zero unit/integration explícitos.

### 1.2 Estado da documentação

- ~30 notas em `obsidian-notes/`, versionadas no repo.
- Organizadas semanticamente (Arquitetura, Banco, Telas, Fluxos, Roadmap, etc.) com **wiki-links** (`[[Tela]]`).
- Conteúdo **denso e atualizado** (snapshot 2026-04-21 em [[Estado Atual]], commits citados nominalmente).
- Já cobre: telas, banco, fluxos de negócio, design system, guia de desenvolvimento, padrões.

> Esta documentação é o **maior ativo subutilizado** do projeto para colaboração com agentes IA. Voltarei a isso na §6.

### 1.3 Pontos fortes a preservar

- ✅ Documentação versionada junto ao código (não há drift entre Notion e repo).
- ✅ Schemas Zod + tipos TS já existem (núcleo compartilhável pronto).
- ✅ Supabase JS funciona igual em web e React Native (caminho viável para mobile).
- ✅ Convenções consistentes (idioma, tokens visuais, RLS).
- ✅ Domínio modelado com clareza ([[Fluxos de Negócio]]).

### 1.4 Pontos frágeis a corrigir

- ❌ **Lógica de negócio dispersa nas páginas** — cada `page.tsx` tem fetch + filtros + mutations inline (ver [[Guia de Desenvolvimento]] §Padrão de estado). Reuso entre web e mobile fica **impossível** sem extrair antes.
- ❌ **`actions.ts` mortos** — confundem agentes IA e humanos novos; vão crescer em "qual é a fonte da verdade?".
- ❌ **Sem camada de domínio explícita** — regras como "ao criar contrato, fila → false + moto → rented" estão **dentro de handlers de UI**.
- ❌ **RLS permissiva (`USING (true)`)** — adequada hoje, **bloqueante** quando virar multi-tenant ou expor app mobile fora da rede confiável.
- ❌ **Acoplamento direto ao Supabase no UI** — substituir backend ou adicionar BFF custaria refactor amplo.
- ❌ **Sem testes de unidade** — refatorar regras de negócio sem rede de proteção é arriscado.
- ❌ **README boilerplate** — primeira impressão para humano ou IA novo é "projeto genérico create-next-app".

---

## 2. Riscos e oportunidades

### 2.1 Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| **Mobile entrar em produção antes do RLS por tenant estar correto** (P2 + P6 combinados) | **Alta** | **Crítico** | **Multi-tenancy + RLS por `auth.uid()` precisa estar PRONTO antes do primeiro release mobile externo**. Bootstrap do app pode rodar antes, mas só com dados de teste |
| Mobile divergir de web e duplicar regras de negócio | Alta | Alto | Extrair domínio para `packages/core` **em paralelo** ao bootstrap mobile, antes de telas mobile reais entrarem |
| RLS permissiva vazar dados entre tenants | **Certeza se não tratada** | Crítico | Refazer policies usando `auth.uid()` + `tenant_id` em **toda** tabela — fase 5 do plano |
| Agentes IA reescreverem padrões antigos por não saberem que `actions.ts` é morto | Alta hoje | Médio | Apagar código morto + `CLAUDE.md` / `AGENTS.md` na raiz |
| Decisão por monorepo "Big Bang" travar o roadmap por semanas | Média | Alto | Migração incremental: mover 1 pacote por vez, web continua rodando |
| Mobile virar "casca vazia" por meses se telas não forem priorizadas | **Média** (consequência de P6) | Médio | Definir desde já uma "tela MVP" do mobile (sugestão: lista de motos + status) para validar pipeline end-to-end cedo |
| Supabase virar gargalo conforme regras crescem (validação cross-table) | Média | Médio | Edge Functions para invariantes; backend dedicado só se houver evidência (P4) |
| Documentação Obsidian envelhecer após migração | Alta | Alto | CI que falha se nota referenciada em código não existir; agente IA atualiza nota junto com PR |
| Convite/onboarding de novo tenant não pensado desde o início | Média | Alto | Modelar tabela `tenants` + `tenant_members` na Fase 5; mesmo que UI de onboarding venha depois |

### 2.2 Oportunidades

- 🎯 **Domínio limpo é vantagem competitiva para IA**: regras puras (sem React, sem Supabase) são triviais de testar, documentar e estender por agente.
- 🎯 **Obsidian + wiki-links é formato ideal para RAG/contexto de prompt**: cada nota é autocontida e linka explicitamente para dependências.
- 🎯 **Supabase + Realtime habilita mobile com sync gratuito** (ex.: status da moto no app do operador atualizando em tempo real).
- 🎯 **Schemas Zod como contrato único** entre web, mobile, Edge Functions e prompts de agente IA (validação + tipos + documentação em um só lugar).
- 🎯 **Multi-tenancy gradual**: adicionar `tenant_id` agora, mesmo com 1 tenant, evita refactor caro depois.

---

## 3. Avaliação de modelos de organização do projeto

Cinco abordagens consideradas. Análise de cada uma a seguir.

### 3.1 Alternativa A — Manter monolito + adicionar repo mobile separado (polirepo)

**Estrutura:**
- `gomoto-web/` — Next.js (atual)
- `gomoto-mobile/` — Expo (novo repo)
- `gomoto-shared/` — pacote npm publicado (tipos + schemas)

**Prós:**
- Setup mais simples no curto prazo.
- Cada repo tem seu CI independente.
- Equipes podem trabalhar isoladas.

**Contras:**
- ❌ Versionar `gomoto-shared` no npm é overhead enorme para 1–3 devs.
- ❌ Alteração no domínio exige **3 PRs em 3 repos** com versionamento manual.
- ❌ Documentação Obsidian fica em um repo, código em outros — **drift garantido**.
- ❌ Agente IA precisa de contexto cross-repo, que é ruim para qualquer ferramenta atual.

**Veredito:** ❌ Inadequado. O custo de coordenação não compensa.

---

### 3.2 Alternativa B — Monorepo com **PNPM Workspaces + Turborepo**

**Estrutura:**
```
gomoto/
├── apps/
│   ├── web/         ← Next.js (atual src/ migra pra cá)
│   └── mobile/      ← Expo + Expo Router
├── packages/
│   ├── core/        ← domínio puro (regras, types, schemas Zod)
│   ├── data/        ← repositórios Supabase tipados
│   ├── ui-web/      ← componentes específicos da web
│   └── config/      ← tsconfig, eslint, tailwind preset
├── supabase/        ← migrations, Edge Functions
├── docs/            ← obsidian-notes/ migra pra cá
└── turbo.json
```

**Prós:**
- ✅ PNPM Workspaces é nativo, leve, padrão de mercado.
- ✅ Turborepo paraleliza builds e tem cache remoto opcional.
- ✅ Schemas/tipos/regras compartilhados sem publicar npm.
- ✅ Web continua funcionando durante migração (mover por pacote).
- ✅ Agente IA navega um único repo com contexto completo.
- ✅ Suporta Vercel deploy nativo (`apps/web` como root).

**Contras:**
- ⚠️ Curva de aprendizado para quem nunca usou monorepo (~1 semana).
- ⚠️ TypeScript paths e module resolution exigem configuração cuidadosa entre Next.js e Metro (Expo).
- ⚠️ Cache do Turborepo precisa de hashes corretos (especialmente para arquivos Obsidian).

**Veredito:** ✅ **Recomendado.** Equilíbrio ideal entre simplicidade e poder.

---

### 3.3 Alternativa C — Monorepo com **Nx**

**Prós:**
- Geradores e ferramentas mais ricas.
- Visualização gráfica de dependências.
- Plugins prontos para React Native, Next.js, etc.

**Contras:**
- ❌ Overhead conceitual significativo (`project.json`, executors, generators).
- ❌ Excesso para 1–3 devs + 2 apps.
- ❌ Configuração é "outro DSL para aprender".
- ❌ Menos comum em projetos Expo + Vercel.

**Veredito:** ❌ Overengineered para o tamanho atual. Pode-se migrar para Nx **depois** se a complexidade justificar (ex.: 5+ apps, time grande).

---

### 3.4 Alternativa D — Backend dedicado + Frontends magros

**Estrutura:** NestJS/Hono/tRPC entre os apps e o Supabase.

**Prós:**
- Encapsula regras de negócio fora do client.
- Permite trocar Supabase futuramente.
- Camada única para auditoria, rate-limit, observabilidade.

**Contras:**
- ❌ Dobra a superfície de manutenção (mais um deploy, mais um runtime).
- ❌ Perde o **Auth + Realtime + Storage do Supabase de graça** ou reimplementa.
- ❌ Solução para um **problema que ainda não existe** no GoMoto.
- ❌ Atrasa entrega do mobile em meses.

**Veredito:** ❌ Não recomendado agora. **Edge Functions do Supabase** cobrem o caso de "lógica que não pode rodar no client" (geração de PDF, webhooks, integrações de email/SMS) sem o custo de um backend completo. Reavaliar se: (a) virar multi-tenant SaaS sério, (b) integrar com sistemas externos complexos, (c) precisar de fila de jobs robusta.

---

### 3.5 Alternativa E — **Universal App** (Expo Router web + mobile, um codebase só)

Codebase 100% React Native, deploy web via `react-native-web` + Expo Router. Tamagui ou NativeWind para estilo cross-plataforma.

**Prós:**
- Compartilhamento máximo (próximo a 100%).
- Um codebase, uma stack de UI.

**Contras:**
- ❌ Reescrever 14 telas Next.js já existentes: **descarta investimento atual**.
- ❌ Recharts, Leaflet, design system Tailwind **não funcionam** nativamente — todos precisam ser substituídos.
- ❌ Performance web inferior a Next.js (SSR/RSC limitado).
- ❌ UX web e mobile **devem ser diferentes** num ERP (tabelas densas no desktop vs. cards no celular).
- ❌ Stack de testes E2E (Playwright) precisa ser repensada.

**Veredito:** ❌ Custo de transição alto demais e UX prejudicada nos dois lados.

---

### 3.6 Quadro comparativo

| Critério (peso) | A: polirepo | **B: PNPM+Turbo** | C: Nx | D: backend dedicado | E: universal |
|---|:-:|:-:|:-:|:-:|:-:|
| Aproveita código atual (4) | 4 | **5** | 5 | 4 | 1 |
| Compartilhamento de domínio (5) | 2 | **5** | 5 | 5 | 5 |
| UX nativa por plataforma (4) | 5 | **5** | 5 | 5 | 2 |
| Produtividade de IA (4) | 2 | **5** | 4 | 3 | 4 |
| Simplicidade operacional (3) | 3 | **4** | 2 | 1 | 3 |
| Curva de aprendizado (3) | 5 | **4** | 2 | 2 | 3 |
| Custo de migração (5) | 3 | **4** | 3 | 2 | 1 |
| Evolução de longo prazo (5) | 2 | **5** | 5 | 5 | 3 |
| **Total ponderado** | **86** | **138** | 120 | 102 | 81 |

> Recomendação: **Alternativa B (PNPM Workspaces + Turborepo).**

---

## 4. Estratégias de compartilhamento de código

Independente do modelo de organização, **o que** se compartilha é decisão separada.

### 4.1 Camadas em ordem decrescente de facilidade

| Camada | Fácil? | Recomendação |
|---|:-:|---|
| **Tipos TS** (`Customer`, `Contract`, enums) | 🟢 Trivial | Compartilhar 100% em `packages/core` |
| **Schemas Zod** (validações) | 🟢 Trivial | Compartilhar 100% em `packages/core` |
| **Regras de negócio puras** (`canRentMotorcycle(customer, motorcycle)`, `calculateOverdue(billing, today)`) | 🟢 Trivial | Compartilhar 100%, com testes unitários |
| **Repositórios de dados** (queries Supabase tipadas) | 🟡 Médio | Compartilhar em `packages/data`; cuidado com bundling do Supabase em RN |
| **Hooks de estado** (`useCustomers`, `useContracts`) | 🟡 Médio | Compartilhar via TanStack Query (funciona web + RN); evitar hooks acoplados a UI |
| **Componentes UI** (Button, Table, Modal) | 🔴 Difícil | **Não compartilhar.** UIs diferentes. Compartilhar apenas **tokens** (cores, espaçamentos, tipografia) via `packages/design-tokens` |
| **Layouts e telas** | 🔴 Inviável | **Não compartilhar.** Tela de "Motos" no desktop é uma tabela densa; no celular é uma lista de cards |

### 4.2 Estratégia recomendada

Compartilhar **lógica e contratos**, **não pixels**.

```
                        ┌─────────────────────────────┐
                        │   packages/core (domínio)   │
                        │  • types  • schemas Zod     │
                        │  • regras puras + testes    │
                        └──────────────┬──────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │   packages/data (acesso)    │
                        │  • repositórios Supabase    │
                        │  • hooks TanStack Query     │
                        └──────────────┬──────────────┘
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
        ┌─────────────┐                               ┌─────────────┐
        │  apps/web   │                               │ apps/mobile │
        │  Next.js    │                               │  Expo + RN  │
        │  Tailwind   │                               │  NativeWind │
        │  Leaflet    │                               │ react-native-maps │
        │  Recharts   │                               │ Victory Native │
        └─────────────┘                               └─────────────┘
```

**Argumento central:** o domínio (regras de negócio do GoMoto) **independe da plataforma**. Já a UX **depende fortemente**. Tentar compartilhar componentes UI cross-platform é a fonte clássica de "complica os dois, atende mal ambos".

### 4.3 Camada cinza: tokens visuais

O [[Design System]] do GoMoto define paleta, tipografia, espaçamento. Esses valores **devem** ser compartilhados como JSON/JS plano em `packages/design-tokens`:

```ts
// packages/design-tokens/colors.ts
export const colors = {
  bg: '#0a0a0a',
  surface: '#171717',
  primary: '#ff6600',
  // ...
};
```

Web consome via Tailwind preset; mobile consome via NativeWind preset (também Tailwind). Mesmo token, dois consumidores.

---

## 5. Estratégias de compartilhamento de conhecimento

### 5.1 Manter Obsidian, integrado ao monorepo

A documentação atual em `obsidian-notes/` é um ativo. Não jogar fora.

**Recomendação:**
- Mover para `docs/` na raiz do monorepo (continua sendo um vault Obsidian — basta apontar Obsidian para essa pasta).
- Convenção: cada `package/` e `app/` pode ter um `README.md` curto que **linka** para a nota Obsidian correspondente em `docs/`. Não duplicar conteúdo.
- Mantém os wiki-links (`[[Tela]]`) — Obsidian renderiza; agente IA também consegue resolver porque o slug bate com o nome do arquivo.

### 5.2 Princípio "docs-as-code"

- Documentação versionada junto ao código (já é a prática hoje — manter).
- PRs **incluem** atualização de doc relevante. CI sinaliza se PR muda `packages/core` mas não toca em `docs/` (não bloqueia, alerta).
- Notas Obsidian seguem o padrão atual: frontmatter com tags, wiki-links, estrutura previsível.

### 5.3 Pontos cardeais para humanos e agentes IA

Adicionar três arquivos canônicos na raiz:
- `README.md` — visão geral, como rodar (substitui o boilerplate atual).
- `CLAUDE.md` (ou `AGENTS.md`) — **regras para agentes IA** (ver §6).
- `docs/MAP.md` — índice mestre do vault Obsidian (substitui o papel atual de `GoMoto.md`, que vira link "ver MAP").

---

## 6. Documentação como contexto para agentes de IA

Esta é a seção com maior alavancagem do documento. A doc Obsidian do GoMoto, com pequenas mudanças, vira **a maior vantagem competitiva** para desenvolvimento assistido por IA.

### 6.1 Princípios

1. **Documentação é prompt.** Cada nota é incluída em contextos de agente. Escreva pensando que o leitor é um agente sem contexto prévio.
2. **Wiki-links são grafos de dependência.** Permitem ao agente expandir contexto sob demanda (busca seletiva, não dump completo).
3. **Imperativos claros, não narrativa.** "Toda nova tabela precisa de RLS" é melhor que "tendemos a usar RLS".
4. **Exemplos compilados.** Trechos de código nas notas devem corresponder ao código real (CI verifica).

### 6.2 Arquivo `CLAUDE.md` na raiz (proposta)

```markdown
# Instruções para agentes IA — GoMoto

## Antes de codar
1. Leia `docs/GoMoto.md` para visão geral.
2. Se for mexer em domínio (regras, schemas, tipos): leia `docs/Arquitetura.md`,
   `docs/Banco de Dados.md`, `docs/Fluxos de Negócio.md`.
3. Se for mexer em tela: leia `docs/Telas/<NomeDaTela>.md`.

## Regras invioláveis
- Inglês em código (variáveis, funções, colunas, rotas).
- Português em UI e JSDoc.
- Regras de negócio NUNCA dentro de page.tsx. Vão em packages/core.
- Acesso a dados via packages/data, nunca Supabase direto na UI.
- Toda tabela nova: RLS habilitada + trigger update_updated_at + tenant_id.
- Schemas Zod em packages/core/schemas são fonte da verdade.

## Padrões mortos (não usar como referência)
- src/app/**/actions.ts antigos (removidos na migração — se ainda existirem, ignore).
- Fetch direto via createClient() em page.tsx (anti-padrão).

## Fluxo de PR esperado
1. Atualizar/criar nota em docs/ relevante.
2. Adicionar/atualizar testes em packages/core (regras puras) ou apps/web e apps/mobile (E2E).
3. npm run build && npm run test devem passar.
```

### 6.3 Skills e agentes especializados

Aproveitar o Claude Code Skills:
- **skill `domain-modeler`**: dado um fluxo de negócio em `docs/Fluxos de Negócio.md`, gera tipos + schemas + regras puras em `packages/core`.
- **skill `tela-generator`**: dado uma nota `docs/Telas/Nova.md`, gera `apps/web/app/(dashboard)/nova/page.tsx` e `apps/mobile/app/(tabs)/nova.tsx` seguindo padrões.
- **skill `doc-sync`**: detecta drift entre nota Obsidian e código real, propõe atualização.

### 6.4 MCP servers úteis

- **Supabase MCP** (já em uso pelo time): aplica migrations, consulta schema vivo.
- **Obsidian MCP** (opcional): permite ao agente buscar semanticamente nas notas em vez de só ler arquivos.
- **GitHub MCP**: PRs, issues, contexto de histórico.

### 6.5 Testes como contrato bidirecional para IA

Regras puras em `packages/core` com **testes Vitest** servem dupla função:
- Especificação executável que o agente lê para entender comportamento esperado.
- Rede de segurança quando o agente refatora.

Exemplo (a criar):
```ts
// packages/core/contract/canRent.test.ts
test('cliente em fila não pode receber contrato direto', () => {
  expect(canRent(customer({ in_queue: true }), motorcycle({ status: 'available' })))
    .toEqual({ ok: false, reason: 'CUSTOMER_IN_QUEUE_MUST_USE_QUEUE_FLOW' });
});
```

O `reason` em SCREAMING_SNAKE serve como vocabulário compartilhado entre código, doc e agente.

---

## 7. Experiência de desenvolvimento (DX humano e DX-IA)

### 7.1 Para humanos

| Fricção atual | Mitigação |
|---|---|
| README boilerplate | Reescrever (visão + comandos + links docs) |
| `actions.ts` morto confunde | Remover na migração |
| 14 page.tsx parecidos, copy-paste | Extrair `useResource()` hook genérico em `packages/data` |
| Sem hot-reload entre packages | Turborepo `dev` + `tsconfig` com paths cuidados |
| Onboarding manual | `pnpm setup` script + `docs/Onboarding.md` |

### 7.2 Para agentes IA

| Necessidade | Como atender |
|---|---|
| Contexto inicial leve | `CLAUDE.md` curto, com links |
| Expansão sob demanda | Wiki-links em docs/, grep por slugs |
| Padrões claros | Skills + testes + schemas |
| Feedback rápido | `pnpm test:core` roda em <2s; agente confirma mudanças antes de PR |
| Detecção de inconsistência | CI: build + test + lint + verificação "todas as notas linkadas existem" |

### 7.3 Loop de desenvolvimento assistido por IA (proposto)

1. Humano abre issue ou conversa: "preciso adicionar tela de Multas detalhada".
2. Agente lê `docs/Telas/Multas.md`, vê que é só listagem hoje.
3. Agente propõe atualização da nota com novos campos/regras → humano valida.
4. Agente atualiza `packages/core` (schemas + regras + testes) → roda testes.
5. Agente atualiza `apps/web` e `apps/mobile` consumindo os novos contratos.
6. Agente abre PR linkando para a nota atualizada.

A nota Obsidian é o **artefato âncora**: existe antes do código, é atualizada junto, e referencia o código final.

---

## 8. Capacidade de crescimento e impactos transversais

| Eixo | Hoje | Pós-migração | Daqui a 2 anos (estimado) |
|---|---|---|---|
| **Apps** | 1 (web) | 2 (web + mobile Android/iOS) | 2–3 (+ painel cliente final?) |
| **Tenants** | 1 | **N (multi-tenant ativo desde Fase 5)** | N (operação como SaaS B2B) |
| **Backend** | Supabase puro | Supabase + Edge Functions | + filas, talvez workers Node |
| **Devs humanos** | 1–3 | 1–3 | 3–6 |
| **Agentes IA** | Ad hoc | Skills definidas | Pipelines parcialmente autônomos |
| **Documentação** | 30 notas | ~40 notas + AGENTS.md | ~80 notas estruturadas |
| **Testes** | E2E Playwright | + Vitest unitário + RN Testing Library | + contract tests entre app↔backend |
| **Observabilidade** | Logs Vercel + Sentry (futuro) | + Sentry RN + Supabase logs | + tracing distribuído |
| **Governança** | Convenções no Obsidian | + CI bloqueante para regras críticas | + RFC process para mudanças cross-package |

### 8.1 Manutenção

- Bug em regra de negócio: corrige em `packages/core`, web e mobile recebem automaticamente.
- Bug em UI: isolado por app.
- Refactor de tipo: TS quebra em todos os consumidores → corrige tudo num PR.

### 8.2 Onboarding

- Hoje: ~3 dias para um dev novo entender estrutura (estimativa).
- Pós-migração: ~1 dia, lendo `README.md` → `docs/GoMoto.md` → `docs/Arquitetura.md`.

### 8.3 Testes

- `packages/core` tem **testes unitários rápidos** (regras puras).
- `apps/web` mantém Playwright E2E.
- `apps/mobile` adota Detox ou Maestro para E2E nativo.
- Edge Functions com testes via vitest + Supabase local.

### 8.4 Deploy

- `apps/web` → Vercel (continua).
- `apps/mobile` → Expo EAS Build (Android + iOS).
- Edge Functions → Supabase CLI.
- Migrations → Supabase CLI ou MCP, via PR.

### 8.5 Observabilidade

- Sentry web + mobile (mesmo projeto com tags por app).
- Logs Supabase via `supabase logs`.
- Painel mínimo recomendado: erros por app, latência de queries, taxa de falha de auth.

### 8.6 Governança

- ADRs (Architecture Decision Records) curtos em `docs/decisions/`.
- Toda decisão cross-package vira ADR.
- Agente IA escreve rascunho, humano aprova.

---

## 9. Recomendação final

### 9.1 Decisão

> **Adotar monorepo PNPM Workspaces + Turborepo, com `apps/web` (Next.js) e `apps/mobile` (Expo + Expo Router), apoiados em `packages/core` (domínio puro), `packages/data` (acesso Supabase tipado) e `packages/design-tokens` (tokens compartilhados). Documentação Obsidian movida para `docs/` na raiz, com `CLAUDE.md` definindo regras para agentes IA.**

### 9.2 Justificativa em uma frase

É a opção que **preserva 100% do código atual**, **maximiza compartilhamento de domínio** sem forçar UI única, **mantém Supabase como entrega rápida**, e **transforma a documentação Obsidian no maior ativo de produtividade** para agentes IA — tudo sem introduzir nenhuma camada (backend dedicado, microfrontends, universal app) cujo custo não esteja claramente justificado pelo tamanho atual do projeto.

### 9.3 Por que essa e não a alternativa próxima (C — Nx)?

Nx entrega o mesmo resultado funcional mas com **complexidade conceitual significativamente maior** (executors, generators, project.json) que só compensa em monorepos com 5+ apps ou times de 10+ devs. Para 1–3 devs + agentes IA, PNPM + Turborepo entrega 90% do valor com 30% da curva de aprendizado.

---

## 10. Estrutura organizacional proposta

```
gomoto/
├── apps/
│   ├── web/                          ← Next.js (migra de ./src/)
│   │   ├── app/
│   │   ├── components/               ← UI específica web (Tailwind)
│   │   ├── public/
│   │   └── package.json
│   └── mobile/                       ← Expo + Expo Router (novo)
│       ├── app/
│       ├── components/               ← UI específica mobile (NativeWind)
│       ├── assets/
│       └── package.json
│
├── packages/
│   ├── core/                         ← DOMÍNIO PURO (sem React, sem Supabase)
│   │   ├── src/
│   │   │   ├── types/                ← migra de src/types/index.ts
│   │   │   ├── schemas/              ← migra de src/lib/schemas.ts
│   │   │   ├── rules/                ← NOVO: regras puras (canRent, etc)
│   │   │   └── utils/                ← formatCurrency, formatDate, etc
│   │   ├── test/                     ← Vitest
│   │   └── package.json
│   │
│   ├── data/                         ← ACESSO A DADOS
│   │   ├── src/
│   │   │   ├── client/               ← createBrowserClient, createNativeClient
│   │   │   ├── repositories/         ← customersRepo, motorcyclesRepo
│   │   │   └── hooks/                ← useCustomers, useContracts (TanStack Query)
│   │   └── package.json
│   │
│   ├── design-tokens/                ← tokens visuais (cores, espaçamento, tipo)
│   │   ├── src/index.ts
│   │   └── package.json
│   │
│   └── config/                       ← tsconfig, eslint, prettier compartilhados
│       ├── tsconfig.base.json
│       ├── eslint-preset.js
│       └── package.json
│
├── supabase/
│   ├── migrations/                   ← SQL migrations versionadas
│   ├── functions/                    ← Edge Functions (PDF, emails, webhooks)
│   └── seed.sql
│
├── docs/                             ← Vault Obsidian (migra de obsidian-notes/)
│   ├── MAP.md                        ← índice mestre
│   ├── GoMoto.md
│   ├── Arquitetura.md
│   ├── Telas/...
│   ├── Fluxos de Negócio.md
│   └── decisions/                    ← ADRs
│       ├── 0001-monorepo.md
│       └── 0002-multi-tenancy-plan.md
│
├── .github/workflows/                ← CI/CD
├── CLAUDE.md                         ← instruções para agentes IA
├── README.md                         ← reescrito (não boilerplate)
├── package.json                      ← workspaces root
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

### 10.1 Regras de dependência (importantes)

- `core` **não importa** nada de `data`, `apps`, `ui`.
- `data` importa de `core`, mas não de `apps`.
- `apps/*` importam de `core`, `data`, `design-tokens`.
- `apps/web` ↔ `apps/mobile` **nunca** se importam entre si.

ESLint com `eslint-plugin-boundaries` ou similar para enforce.

---

## 11. Estratégia de utilização da documentação como contexto para IA

Resumo operacional do que está em §6:

1. **Mover `obsidian-notes/` → `docs/`** mantendo wiki-links.
2. **Criar `CLAUDE.md` curto na raiz** apontando para `docs/` por contexto.
3. **Adotar convenção:** cada nota em `docs/` tem frontmatter `tags`, `last_verified` (data), `related` (lista de notas).
4. **Skills do Claude Code** especializadas em: gerar tela, gerar regra de negócio, validar drift doc↔código.
5. **CI mínimo de doc:**
   - Falha se nota referenciada por wiki-link não existir.
   - Avisa se PR muda `packages/core` sem tocar `docs/`.
6. **ADRs em `docs/decisions/`** registram cada decisão arquitetural significativa — formato curto (1 página).
7. **Notas-vivas:** `docs/Estado Atual.md` é atualizada a cada release pelo agente IA via script.

> Princípio guia: **a doc precede o código.** Agente lê doc → propõe código → atualiza doc com o que mudou. Humano revisa ambos no mesmo PR.

---

## 12. Estratégia de evolução futura

### 12.1 Marcos esperados (sem prometer datas)

| Marco | Quando faz sentido | Pré-requisitos |
|---|---|---|
| **Multi-tenancy completa** (confirmada por P2) | **Logo de cara** — Fase 5 do plano | Tabelas `tenants` + `tenant_members`; RLS por `auth.uid()` + `tenant_id` em todas as tabelas |
| **Edge Functions para PDF/emails** | Imediato (item 5 do [[Roadmap]]) | Supabase CLI configurado |
| **App mobile com primeira tela funcional** (confirmado por P6) | **Fase 4-bis** — paralelo ao refactor | Estrutura monorepo + `packages/core` mínimo |
| **App mobile em produção externa** | Após Fase 5 (multi-tenancy completa) | RLS por tenant validada; auth mobile com tenant scope |
| **Realtime sync no mobile** | Quando operador em campo precisar atualização ao vivo | Supabase Realtime + TanStack Query |
| **Onboarding de novo tenant** | Quando entrar 2º cliente | Multi-tenancy completa; UI de convite/criação de tenant |
| **App cliente final (B2C)** | Quando o produto B2B estiver estável | Multi-tenancy; roles `tenant_admin` / `customer` separados |
| **Backend dedicado (Node/Hono)** (P4 — futuro distante) | Apenas quando Edge Functions provarem ser insuficientes | Domínio em `packages/core` já maduro (refactor trivial) |
| **Eventos/Filas de trabalho** | Quando integração externa exigir (ex.: bancos) | Provavelmente Vercel Queues ou similar |
| **IA dentro do produto** (score de risco) | Quando houver volume de dados suficiente | Tabelas `audit_logs` populadas (item já no [[Roadmap]]) |

### 12.2 Princípios de evolução

- **YAGNI no presente, mas portas abertas.** Não construir hoje, mas não fechar portas.
  - Ex.: `tenant_id NULL` em todas as tabelas hoje, mesmo sem multi-tenancy. Custo: zero. Ganho futuro: enorme.
- **Cada novo package precisa de justificativa.** Pacote vazio é débito.
- **Cada nova dependência grande passa por ADR.** Ex.: adicionar TanStack Query, mudar de TanStack Query para SWR, etc.
- **Convenções > abstrações.** Preferir "todas as telas seguem o padrão X documentado em `docs/`" a "criamos um framework interno".

### 12.3 O que evitar nos próximos anos

- ❌ Criar mais um app sem antes consolidar `packages/core` (vira o problema do polirepo informal).
- ❌ Permitir `apps/*` importarem entre si.
- ❌ Adotar microfrontends ou microserviços sem evidência clara de necessidade.
- ❌ Acumular dependências experimentais (cada uma é peso para agente IA entender).

---

## 13. Plano de migração

Migração incremental, sem janela de feature freeze longa. Cada fase termina com **web rodando normalmente em produção**.

> **Mudanças vs. plano original** (motivadas pelas premissas confirmadas):
> - **P2 (multi-tenant)**: a tarefa de tornar o sistema multi-tenant subiu para a **Fase 5** (antes da entrada do mobile externo) e ficou mais robusta — não é mais só "adicionar coluna NULL", mas **modelar `tenants`, `tenant_members` e refazer RLS**.
> - **P6 (mobile cedo, gradual)**: o bootstrap do mobile virou **Fase 4-bis**, em paralelo à extração de domínio, para que o app exista como projeto base desde cedo, mesmo que vazio.

### Fase 0 — Preparação (1–2 dias)

- [ ] ~~Validar premissas P1–P6~~ ✅ feito em 2026-06-10.
- [ ] Branch `migration/monorepo` criada.
- [ ] Backup do estado atual (tag git `pre-monorepo`).
- [ ] Reescrever `README.md` (visão + comandos).
- [ ] Criar `CLAUDE.md` inicial (mesmo que provisório).
- [ ] Criar ADR `docs/decisions/0001-monorepo-pnpm-turborepo.md`.

#### Fase 0.1 — Supabase local com Docker (1 dia, incluído na Fase 0)

> 🐳 **Pré-requisito para tudo o que vem depois.** Sem ambiente local funcionando, refatorar regras, testar RLS multi-tenant e iterar Edge Functions vira chute. Substitui o uso do projeto remoto `hcnxbqunescfanqzmsha` durante desenvolvimento.

**Por que Supabase local em vez de só Supabase Cloud:**
- ✅ Iteração rápida em migrations sem poluir o projeto de produção.
- ✅ Testar RLS multi-tenant (Fase 5) com 2+ tenants em paralelo sem custo.
- ✅ Edge Functions (Fase 6) com hot-reload local.
- ✅ Resetar banco em segundos (`supabase db reset`) — vital para CI e onboarding.
- ✅ Funciona offline para devs e agentes IA.

**Tarefas:**

- [ ] Instalar pré-requisitos: **Docker Desktop / Docker Engine + Compose** e **Supabase CLI** (`npm i -g supabase` ou via Homebrew/Scoop).
- [ ] Criar pasta `supabase/` na raiz do monorepo (já existe parcialmente — consolidar).
- [ ] Rodar `supabase init` para gerar `supabase/config.toml`.
- [ ] Migrar o atual `supabase-schema.sql` para migrations versionadas:
  - [ ] `supabase migration new initial_schema` → colar o conteúdo do `supabase-schema.sql`.
  - [ ] Validar com `supabase db reset` que sobe limpo.
- [ ] Configurar `supabase/seed.sql` com dados de desenvolvimento:
  - [ ] 2 tenants (`gomoto-bonze-dev`, `gomoto-tenant2-dev`) — prepara solo para Fase 5.
  - [ ] Usuários de teste por tenant (login fácil: `admin@bonze.dev`, `admin@tenant2.dev`).
  - [ ] Frota, clientes e contratos sintéticos por tenant.
- [ ] Criar `.env.local.example` apontando para URLs locais:
  ```
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<saída de `supabase status`>
  SUPABASE_SERVICE_ROLE_KEY=<saída de `supabase status`>
  ```
- [ ] Adicionar scripts no `package.json` da raiz:
  ```json
  {
    "scripts": {
      "db:start":  "supabase start",
      "db:stop":   "supabase stop",
      "db:reset":  "supabase db reset",
      "db:diff":   "supabase db diff -f",
      "db:push":   "supabase db push",
      "db:status": "supabase status"
    }
  }
  ```
- [ ] Atualizar `.gitignore` para `supabase/.branches`, `supabase/.temp` e volumes Docker.
- [ ] Verificar acesso aos serviços locais:
  - API Postgres/REST: `http://127.0.0.1:54321`
  - Supabase Studio: `http://127.0.0.1:54323`
  - Inbucket (emails): `http://127.0.0.1:54324`
  - Postgres direto: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- [ ] Documentar fluxo de trabalho em `docs/Desenvolvimento Local.md`:
  - Como subir/derrubar o stack.
  - Como criar migration (`supabase migration new <nome>`).
  - Como aplicar mudanças do Studio local para arquivo (`supabase db diff -f <nome>`).
  - Como sincronizar com o projeto cloud quando necessário (`supabase link` + `supabase db push`).
- [ ] Atualizar `CLAUDE.md` com seção "ambiente local":
  - Agente NUNCA roda migrations contra o projeto cloud (`hcnxbqunescfanqzmsha`).
  - Toda mudança de schema vira arquivo em `supabase/migrations/`.
  - Para reproduzir bug: `pnpm db:reset` zera o estado e roda seed.
- [ ] Atualizar CI:
  - GitHub Actions sobe o stack via `supabase start` ou `supabase/setup-cli` action.
  - Roda migrations e testes contra o Postgres local em vez do projeto remoto.
- [ ] Configurar Playwright para apontar para a URL local em `playwright.config.ts` (já está parcialmente — confirmar).

- ✅ **Check:** `pnpm db:start && pnpm db:reset` sobe um ambiente limpo em < 30s, com 2 tenants seedados, e a web local (`pnpm dev`) consegue logar como usuário de cada tenant.

> 💡 **Benefício secundário grande:** quando chegar na Fase 5, testar isolamento multi-tenant é trivial — os 2 tenants já vivem desde o dia 1 no ambiente local, e qualquer regressão de RLS aparece imediatamente no seed.

### Fase 1 — Estrutura de monorepo (1 dia)

- [ ] Instalar PNPM, configurar `pnpm-workspace.yaml`.
- [ ] Mover código atual para `apps/web/` (apenas mudança de path, sem refactor).
- [ ] Configurar Turborepo (`turbo.json` mínimo com `build`, `dev`, `lint`, `test`).
- [ ] Mover `obsidian-notes/` → `docs/`.
- [ ] CI atualizado: `pnpm install && pnpm build`.
- ✅ **Check:** web continua rodando em produção, deploys do Vercel apontam para `apps/web`.

### Fase 2 — Extração de `packages/core` (2–3 dias)

- [ ] Criar `packages/core/` com types, schemas Zod, utils puros (`formatCurrency`, `formatDate`).
- [ ] Mover `src/types/index.ts` → `packages/core/src/types/`.
- [ ] Mover `src/lib/schemas.ts` → `packages/core/src/schemas/`.
- [ ] Mover utils puros de `src/lib/utils.ts`.
- [ ] `apps/web` passa a importar de `@gomoto/core`.
- [ ] Adicionar Vitest, criar primeiros testes para utils.
- ✅ **Check:** `pnpm build && pnpm test` passa; web continua idêntica.

### Fase 3 — Extração de regras de negócio (3–5 dias)

- [ ] Identificar regras nas pages atuais (ex.: `motos/page.tsx`, `contratos/page.tsx`).
- [ ] Mover para `packages/core/src/rules/` como funções puras.
- [ ] Cobrir cada regra com testes Vitest.
- [ ] Atualizar pages para chamar as regras puras.
- [ ] Remover `actions.ts` mortos.
- [ ] Atualizar `docs/Fluxos de Negócio.md` referenciando as funções extraídas.
- ✅ **Check:** suite de testes verde; nenhuma regra crítica fora de `packages/core`.

### Fase 4 — Extração de `packages/data` (3–4 dias)

- [ ] Criar `packages/data/src/repositories/` com `customersRepo`, `motorcyclesRepo`, etc.
- [ ] Adicionar TanStack Query como dependência.
- [ ] Criar hooks em `packages/data/src/hooks/`.
- [ ] Refatorar `apps/web` para consumir hooks compartilhados (uma tela por PR).
- ✅ **Check:** UI continua idêntica; agora abstraída do Supabase direto.

### Fase 4-bis — Bootstrap `apps/mobile` (paralelo à Fase 4) (2–3 dias)

> 🚀 **Antecipado por P6.** Mobile entra como projeto base desde já — implementação por tela vem depois.

- [ ] `pnpm create expo-app apps/mobile` (Expo + TypeScript template).
- [ ] Configurar Expo Router, NativeWind (Tailwind), `packages/design-tokens`.
- [ ] Configurar autenticação Supabase em React Native (`expo-secure-store` para tokens).
- [ ] Configurar EAS Build para preview interno (Android primeiro, iOS quando necessário).
- [ ] Tela única funcional: **lista de motos** (consumindo `packages/data`, dados de teste).
- [ ] Adicionar `docs/Mobile.md` documentando estrutura do app.
- ⚠️ **Restrição:** app fica em **distribuição interna** (EAS internal) até a Fase 5 estar pronta — nunca dados reais multi-tenant sem RLS correta.
- ✅ **Check:** app instalável em celular interno, autenticando e listando dados de teste.

### Fase 5 — Multi-tenancy completa (3–5 dias)

> 🔐 **Crítica por P2.** É o gate que destrava o mobile externo.

- [ ] Modelar tabelas `tenants` e `tenant_members` (user_id, tenant_id, role).
- [ ] Migrar dados existentes para um tenant inicial (GoMoto Bonze ou similar).
- [ ] Adicionar `tenant_id NOT NULL` em **todas** as tabelas de domínio via migration.
- [ ] Reescrever **todas** as policies RLS usando `auth.uid()` e `tenant_id`:
  ```sql
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  ```
- [ ] Atualizar `packages/data` para incluir `tenant_id` automaticamente em inserts (resolver pela sessão).
- [ ] Triggers de auditoria automática em `audit_logs` (item já no [[Roadmap]]).
- [ ] Atualizar `docs/Banco de Dados.md` e `docs/Segurança.md`.
- [ ] **Teste de isolamento:** criar 2 tenants em staging, popular ambos, validar que tenant A não enxerga nada de tenant B (Playwright + queries diretas).
- ✅ **Check:** vazamento entre tenants é demonstravelmente impossível.

### Fase 6 — Edge Functions críticas (paralelo à Fase 5)

- [ ] Função `generate-contract-pdf` (resolve item 5 do [[Roadmap]]).
- [ ] Função `send-billing-reminder` (Resend, item 3 do [[Roadmap]]).
- [ ] Testes unitários para cada função.
- [ ] Todas as funções respeitam `tenant_id` da sessão.

### Fase 7 — Telas do mobile (incremental, contínua)

> 📱 **Sem prazo de término rígido por P6.** Cada tela é uma entrega independente.

Ordem sugerida para maximizar valor para operador em campo:
1. Lista e detalhe de **motos** (status, manutenção, foto)
2. Lista e detalhe de **clientes** (busca, WhatsApp)
3. **Cobranças** vencidas (operador resolve pendências em campo)
4. **Checklists** de entrega/devolução (com upload de foto e assinatura)
5. **Fila** de espera (chamar próximo, oferecer contrato)
6. Demais telas conforme demanda

- [ ] Cada tela vira PR independente que: atualiza `docs/Telas/<Nome>.md`, garante reuso de `packages/core` e `packages/data`, adiciona teste E2E mobile (Maestro recomendado).

### Fase 8 — Skills e CI para IA (1–2 dias)

- [ ] Criar skill `domain-modeler` no Claude Code.
- [ ] Criar skill `screen-generator` (web + mobile).
- [ ] CI verifica wiki-links e drift doc↔código.
- [ ] CI verifica que toda nova tabela tem `tenant_id` e RLS por tenant.

### Resumo de timeline (estimativa, NÃO compromisso)

| Fase | Esforço estimado | Web em prod? | Mobile? |
|---|---|---|---|
| 0 | 1–2 dias | ✅ | — |
| 0.1 (Supabase local) | 1 dia *(dentro da Fase 0)* | ✅ | — |
| 1 | 1 dia | ✅ | — |
| 2 | 2–3 dias | ✅ | — |
| 3 | 3–5 dias | ✅ | — |
| 4 | 3–4 dias | ✅ | — |
| 4-bis | 2–3 dias *(paralelo)* | ✅ | 🛠️ base interna |
| 5 | 3–5 dias | ✅ | 🛠️ ainda interno |
| 6 | paralelo à 5 | ✅ | 🛠️ |
| 7 | contínuo | ✅ | 🚀 produção tela a tela |
| 8 | 1–2 dias | ✅ | 🚀 |
| **Marco "mobile pronto para produção externa"** | **~4–5 semanas após início** | ✅ | 🚀 |
| **Total do refactor + base mobile** | **~3–4 semanas focadas** | sem freeze | — |

### Critérios de "pronto" para cada fase

- Build verde.
- Testes verdes.
- `docs/` correspondente atualizada.
- ADR escrita se a fase tomou decisão arquitetural significativa.

---

## 14. Justificativa final consolidada

Esta recomendação foi escolhida porque, **dentre todas as alternativas avaliadas**:

1. **Preserva 100% do investimento atual** em Next.js + Supabase + documentação Obsidian.
2. **É a única que escala para mobile Android/iOS sem reescrever a web** (P1 + Alternativa E descartada).
3. **Tem caminho direto para multi-tenancy completa** (P2): Fase 5 do plano entrega tenants, RLS por `auth.uid()` e isolamento testado, **antes** do mobile sair da distribuição interna.
4. **Coloca a documentação Obsidian no centro do processo de desenvolvimento com IA** (P5), transformando o que hoje é "documentação que humanos leem" em "contexto operacional para agentes autônomos com acesso pleno ao repo".
5. **Tem curva de aprendizado baixa o suficiente** para a equipe enxuta (P3) + agentes manterem produtividade desde o dia 1 da migração.
6. **Não introduz backend dedicado prematuramente** (P4): Supabase + Edge Functions cobrem todo o cenário previsto; a porta fica aberta sem construir nada.
7. **Atende ao desejo de mobile incremental** (P6): Fase 4-bis dá o "projeto base inicial" cedo (paralela ao refactor), e Fase 7 entrega telas continuamente sem prazo rígido.

A decisão sustenta o projeto pelos próximos anos porque os pontos de inflexão (mobile externo, novos tenants, IA in-product) foram **explicitamente antecipados** na estrutura, sem violar YAGNI: cada pré-requisito é uma adição **barata e isolada** (uma nova função em `packages/core`, uma nova Edge Function, um novo tenant em `tenants`) — não um refactor massivo.

---

## Tags

`#projeto/arquitetura` `#projeto/proposta` `#stack/monorepo` `#stack/turborepo` `#stack/expo`

## Notas relacionadas

- [[GoMoto]] — visão geral
- [[Arquitetura]] — estado atual
- [[Estado Atual]] — snapshot operacional
- [[Roadmap]] — backlog atual
- [[Banco de Dados]] — modelo de dados
- [[Fluxos de Negócio]] — domínio
- [[Guia de Desenvolvimento]] — convenções atuais
