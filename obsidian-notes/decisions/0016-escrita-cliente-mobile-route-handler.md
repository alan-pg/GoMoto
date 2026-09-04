# ADR 0016 — Escrita do cliente mobile: Route Handler com service role (extensão da ADR 0003)

- **Status:** Aceita
- **Data:** 2026-07-30
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Estende:** [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] — formaliza a seção "Quando reavaliar" daquela ADR ("Cliente precisa escrever... reabrir §5")
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action, do qual este é o equivalente para o app mobile), [[PRDs/0009-modulo-vistoria|PRD 0009]], [[Specs/0009-modulo-vistoria|Spec 0009]] §1, §2.3, §6

## Contexto

A [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] fixou o cliente do `apps/mobile` como **somente-leitura**: todas as policies RLS de INSERT/UPDATE/DELETE permanecem exclusivas de `tenant_members`, e o cliente só recebe policies de `SELECT`. Essa mesma ADR já antecipava o fim dessa restrição, na seção "Quando reavaliar":

> "Cliente precisa escrever (pagar cobrança, abrir chamado, atualizar dados): reabrir §5 e portar o padrão `actions.ts` da ADR 0002 pra mobile (provavelmente via HTTP em API route Next, não Server Action direto)."

O PRD 0009 (RF-016, RN-011) é o primeiro caso concreto: o cliente precisa submeter uma vistoria periódica (checklist + fotos) pelo app mobile — a primeira escrita do cliente no sistema.

Esse caminho **já foi pavimentado uma vez, informalmente**: `apps/web/src/app/api/billings/[id]/pix/route.ts` resolve exatamente esse problema para a geração de Pix — Bearer token, `supabase.auth.getUser(token)`, resolução de `customers` via client admin (service role, porque a requisição do mobile não carrega cookie de sessão e o client SSR rodaria como `anon`, bloqueado por RLS). Mas isso foi implementado ad hoc para um único endpoint, sem nunca ter sido escrito como decisão arquitetural — não há garantia de que o próximo desenvolvedor (humano ou agente) repita o padrão em vez de inventar um novo.

## Decisão

Adotar formalmente a **Opção A — Route Handler + Bearer token + client admin (service role)** como o padrão único para qualquer escrita do cliente mobile, generalizando o precedente de `pix/route.ts`.

Estrutura obrigatória para todo Route Handler de escrita do cliente:

1. Localização: `apps/web/src/app/api/<recurso>/.../route.ts`.
2. Autenticação via header `Authorization: Bearer <token>` — nunca cookie (o app mobile não tem cookie de sessão Next.js).
3. `supabase.auth.getUser(token)` identifica o usuário autenticado.
4. Resolução de `customers`/`tenant_id` via **client admin** (`SUPABASE_SERVICE_ROLE_KEY`) — obrigatório porque o client SSR sem cookie roda como `anon` e RLS bloquearia a leitura.
5. **Checagem de posse explícita no handler** — como o service role ignora RLS, a autorização não pode depender só da política de banco; o handler precisa reconferir que o recurso pertence ao `customer_id` resolvido no passo 4 antes de escrever.
6. Validação de payload com o **mesmo schema Zod de `@gomoto/core`** usado pela Server Action equivalente do lado administrativo, quando uma existir — nunca duplicar validação.
7. Persistência via client admin.
8. Registro manual em `audit_logs` — `logAction()` (`apps/web/src/lib/audit.ts`) depende de `createClient()` com cookie e de `getCurrentTenantId(supabase)`, nenhum dos dois disponível numa requisição Bearer-token; o handler insere diretamente na tabela com os dados já resolvidos nos passos 3–4.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **B — Server Action invocada pelo mobile** | Server Actions são acopladas ao boundary do Next.js (endpoint interno gerado pelo framework, com proteção CSRF por origem); não há um jeito suportado de invocá-las de fora de uma página Next.js renderizada pelo próprio app — chamar de React Native exigiria contornar esse mecanismo, essencialmente reimplementando um Route Handler por baixo. |
| **C — Client Supabase direto no app mobile + nova policy RLS de INSERT para o cliente** | Mais simples de implementar (sem endpoint dedicado), mas move toda a validação de negócio (Zod de `@gomoto/core`, checagem de fotos obrigatórias, regras de RN-011/RN-013) para dentro de `CHECK`s e triggers em SQL — duplica em PL/pgSQL o que já existe em TypeScript, quebra a convenção "schema Zod único" (`gomoto-conventions.md`) e é sensivelmente mais difícil de testar (a suíte de Unit tests em `packages/core` deixaria de cobrir a validação real). |
| **D — Supabase Edge Function como endpoint de escrita** | Resolveria o mesmo problema, mas introduz um **segundo runtime serverless** no projeto (`supabase/functions/`) que hoje só existe para migrations — nenhuma Edge Function de aplicação está implantada. O Route Handler já resolve o caso dentro do deploy único do Vercel que o projeto já usa; adotar Edge Functions para isso seria infraestrutura nova sem necessidade demonstrada (mesmo raciocínio de "sem nova infra" da [[decisions/0009-geracao-cobracas-upfront-vs-cron|ADR 0009]]). |

## Justificativa para a Opção A

**Já é código em produção.** `pix/route.ts` resolve o mesmo problema (mobile, sem cookie, precisa de escrita privilegiada e auditável) há mais tempo do que esta ADR existe — formalizar é reconhecer uma decisão já tomada na prática, não propor algo hipotético.

**Sem nova infraestrutura.** Roda no mesmo deploy Vercel de `apps/web`, sem novo runtime, sem novo processo de deploy.

**Mantém RLS como a política de leitura, isolando a escrita num ponto único e auditável.** A superfície de risco (service role) fica concentrada em Route Handlers específicos, cada um com checagem de posse explícita — mais fácil de revisar em conjunto do que uma policy RLS de INSERT genérica que precisaria replicar toda a lógica de negócio em SQL.

**Reaproveita o schema Zod único.** Como o handler importa o mesmo schema de `@gomoto/core` usado pela Server Action equivalente, a paridade de validação entre os dois pontos de escrita é estrutural (compartilham arquivo), não uma convenção a lembrar manualmente.

## Consequências

### Positivas

- Padrão único e documentado para toda futura escrita do cliente mobile — os casos que a própria ADR 0003 já previu ("pagar cobrança, abrir chamado, atualizar dados") têm agora um caminho claro a seguir, em vez de reabrir a discussão a cada novo caso.
- Nenhuma infraestrutura nova; reaproveita 100% do que já existe (Vercel, Supabase service role, `@gomoto/core`).
- RLS do cliente continua exclusivamente de leitura (ADR 0003 não é revertida, apenas complementada) — a superfície de escrita fica restrita e auditável, não geral.

### Negativas / riscos aceitos

- **`logAction()` não é reaproveitável como está** — cada Route Handler de escrita duplica um pequeno `INSERT` em `audit_logs` em vez de chamar o helper. Documentado como dívida técnica pequena (Spec 0009 §6.3); se um terceiro Route Handler de escrita aparecer, extrair um helper compartilhado passa a valer a pena.
- **Service role em Route Handler é alto risco por natureza** — um bug na checagem de posse (passo 5) é uma vulnerabilidade real, não uma degradação de UX. Mitigação: checagem de posse é passo obrigatório e explícito no padrão (não opcional), reforçado por testes de Integration cobrindo os casos `FORBIDDEN` (Spec 0009 §9.3).
- **Duplicação pontual da checagem de posse por handler** — cada Route Handler reimplementa seus próprios passos 4–5; não há um middleware genérico. Aceitável enquanto o número de endpoints for pequeno (ver "Quando reavaliar").

### Neutras

- Esta ADR não altera nenhuma policy RLS existente — o cliente continua sem qualquer policy de INSERT/UPDATE/DELETE. A escrita acontece inteiramente fora do alcance de RLS (service role), por design.

## Quando reavaliar

- **Terceiro Route Handler de escrita do cliente aparecer** — nesse ponto, extrair um helper compartilhado (resolução de auth + client admin + insert em `audit_logs`) em vez de continuar duplicando por rota.
- **Volume de escrita do cliente crescer a ponto de o round-trip com client admin por requisição virar gargalo** — reavaliar um provider de dados dedicado ao mobile em `packages/data`.
- **Adoção de Supabase Edge Functions por outro motivo no projeto** — ponto natural para reconsiderar se escritas do cliente mobile deveriam migrar para lá em vez de Route Handlers Next.js.
- **Cross-membership ou outro cenário do "Estado atual" da ADR 0003 mudar** (ex.: trigger de bloqueio admin/cliente for adicionado) — reconferir se os passos 3–5 deste padrão continuam suficientes.

## Referências

- [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] — decisão original de cliente somente-leitura; seção "Quando reavaliar" que esta ADR resolve.
- [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] — padrão de mutação via Server Action (equivalente administrativo deste padrão).
- `apps/web/src/app/api/billings/[id]/pix/route.ts` — implementação de referência (precedente formalizado por esta ADR).
- [[PRDs/0009-modulo-vistoria]] — RF-016, RF-021, RN-011.
- [[Specs/0009-modulo-vistoria]] — §1 (Visão Geral Técnica), §2.3 (Responsabilidades), §6 (Segurança, autenticação/autorização/auditoria do Route Handler).
