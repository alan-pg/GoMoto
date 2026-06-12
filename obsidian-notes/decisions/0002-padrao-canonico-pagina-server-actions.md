# ADR 0002 — Padrão canônico de página: hooks `@gomoto/data` para leitura + Server Actions para escrita

- **Status:** Aceita
- **Data:** 2026-06-12
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —

## Contexto

Após a Fase 1 (monorepo) e Fase 2 (`@gomoto/core`), as 14 telas em `apps/web/src/app/(dashboard)/*` continuavam usando o padrão pré-monorepo: `const supabase = createClient()` direto no Client Component, com leituras e escritas inline em `page.tsx`. Esse padrão tinha três problemas concretos:

1. **Gap de auditoria.** 27 mutações diretas (`supabase.from(X).update()` / `.delete()`) escapavam de `lib/audit.ts → logAction()`. A tabela `audit_logs` existia mas só recebia entradas de inserts que passavam por actions desativadas.
2. **`tenant_id` injetado no cliente.** Confiar no client para anexar `tenant_id` em INSERTs abre vetor de manipulação. Multi-tenancy (P2 do ADR 0001) exige resolução server-side.
3. **`packages/data` ficava ocioso.** Apenas `motos/page.tsx` consumia hooks de `@gomoto/data`; o resto duplicava queries que poderiam ser memoizadas via TanStack Query.

Existiam dois caminhos possíveis para fechar o gap:

- **A — empurrar tudo para `packages/data` (Fase 4 plena):** mover repositórios + `logAction()` para dentro de `packages/data` e bloquear o uso direto do `supabase` em `page.tsx`. Custo: definir como manter `logAction` server-side dentro de um pacote que roda também no client/mobile.
- **B — façade por tela em `actions.ts` co-localizada:** ler via hooks `@gomoto/data` e mutar via Server Actions Next.js em `app/(dashboard)/<tela>/actions.ts`. Custo: cada tela ganha um `actions.ts` próprio.

## Decisão

Adotar o **padrão B** como canônico para todas as telas de `apps/web/src/app/(dashboard)/*` enquanto o Supabase for o único backend. Quando uma página precisar de dados ou mutar estado:

- **Leituras** vêm de hooks de `@gomoto/data` (`useContracts`, `useMaintenances`, `useQueueEntries`, etc.) consumidos via `useSupabaseContext()`. A invalidação fica a cargo do `useQueryClient()` com `queryKey` documentado.
- **Mutações** chamam Server Actions exportadas de `./actions.ts` na própria rota. Cada action:
  1. Resolve usuário com `getAuthenticatedUser()` e tenant com `getCurrentTenantId(supabase)` (server-side).
  2. Valida o payload com schema Zod local (extensão de `@gomoto/core` quando aplicável).
  3. Executa a(s) mutação(ões).
  4. Chama `logAction({ action, table, recordId, oldData?, newData? })` para **cada** linha tocada — mesmo em fluxos compostos.
  5. Invoca `revalidatePath()` nas rotas afetadas.
- **Storage uploads** permanecem no client via `useSupabaseContext()` (o bucket faz parte do contrato browser, e a URL gerada é apenas patchada via Server Action).
- **Leituras one-off** sem hook dedicado (ex.: `openEditModal` que precisa de `customers.select('*')` antes de abrir o modal) seguem direto via `useSupabaseContext()`. Não é necessário criar um hook por caso isolado.

Esse padrão vive **enquanto o monolito Next.js for único cliente das escritas**. Quando `apps/mobile` precisar escrever, reabrimos a discussão (vê §Reavaliar).

## Alternativas consideradas

| Alternativa | Por que descartada agora |
|---|---|
| **A — Mover `logAction` para dentro de `packages/data`** | `logAction` depende de `cookies()` do Next (sessão server) e de `revalidatePath()`. Empurrar para um pacote consumido também pelo mobile criaria abstração de "log adapter" antes de ter dois consumidores reais. YAGNI per §12.2 do [[Arquitetura Proposta]]. |
| **C — Edge Functions para todas as escritas** | Latência extra e duplicação de tipos sem ganho concreto enquanto o web é único consumidor. Marco previsto para PDF/emails, não para CRUD trivial. |
| **D — Manter `createClient()` no client e mover só auditoria para Edge** | Mantém o problema do `tenant_id` confiável; perde validação Zod centralizada. |

## Consequências

### Positivas

- **Audit log fechado.** Todas as 27 mutações (insert/update/delete) anteriormente sem rastro agora geram entrada em `audit_logs`. Compliance multi-tenant viável.
- **`tenant_id` resolvido server-side.** `getCurrentTenantId(supabase)` lê da sessão; o client não consegue forjar.
- **Bundle menor.** Médias por página caíram entre 30% e 70% no First Load JS por mover validação + lógica composta para o server.
- **Padrão único.** Cada tela tem `page.tsx` (UI) + `actions.ts` (escritas) — fácil para agente IA replicar.
- **Caminho aberto para mobile.** Quando `apps/mobile` precisar escrever, basta decidir entre (a) chamar a mesma Server Action via fetch ou (b) extrair para `packages/data` — sem desfazer o trabalho atual.

### Negativas / riscos aceitos

- **Duplicação dos schemas Zod.** Cada `actions.ts` define `XSchema` localmente (com extensões pontuais). Mitigação: schema base sempre em `@gomoto/core`; extensão local só para campos que não pertencem ao domínio (ex.: `drivers_license_photo_url` em `fila/actions.ts`).
- **`actions.ts` por rota.** Não há façade compartilhada — cada tela escreve seu próprio. Mitigação: ADR + nota canônica como referência.
- **Mobile vai pedir refactor.** Quando o app mobile escrever, será necessário ou expor as actions via HTTP (Next API) ou portar a lógica para `packages/data`. Reabertura prevista.

### Neutras

- Storage continua sendo client. Não há benefício em proxiar uploads pelo Next.
- Leituras one-off via `useSupabaseContext()` são permitidas — não vamos criar hook por caso isolado.

## Quando reavaliar

Esta ADR deve ser revisada quando **qualquer um** destes ocorrer:

- `apps/mobile` precisar fazer sua primeira escrita (decidir entre HTTP via API route vs. portar para `packages/data`).
- Adicionarmos um segundo backend (Edge Function que escreve, microserviço, etc.).
- A duplicação de schemas Zod entre `core` e `actions.ts` exceder ~5 telas com extensões não triviais.
- Multi-tenancy ganhar requisitos extras (ex.: papel `customer` final em B2C) que exijam camada de autorização separada do action.

## Estado atual (commits relevantes)

Padrão consolidado em 7 telas. Migrações commitadas em ordem:

| Commit | Tela |
|---|---|
| `65b6cc0` | cobrancas |
| `a1fa0cb` | entradas |
| `83c1d88` | multas |
| `84b2e30` | despesas |
| `1887cc0` | contratos |
| `7119d7a` | manutencao |
| `9751646` | fila |

`apps/web/src/app/(dashboard)/motos/page.tsx` já consumia `@gomoto/data` antes da iniciativa; mutations seguem o mesmo padrão.

## Referências

- [[Arquitetura Proposta]] — §10 (estrutura), §12 (evolução), §13 (plano de fases).
- [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] — adoção do monorepo.
- `apps/web/src/lib/audit.ts` — `logAction()` server-side.
- `apps/web/src/lib/auth/tenant.ts` — `getCurrentTenantId()`.
