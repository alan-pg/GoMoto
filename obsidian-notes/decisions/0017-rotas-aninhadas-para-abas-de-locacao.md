# ADR 0017 — Abas de `/locacoes/[id]` via rotas aninhadas, não Tabs client-side

- **Status:** Aceita
- **Data:** 2026-08-01
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão canônico de tela: leituras via Server Component), [[Telas/Locações]] §"Detalhe da locação em abas"

## Contexto

`/locacoes/[id]/page.tsx` cresceu ao longo de várias specs (contrato + PDF, vínculo cliente/veículo, vistoria com comparação, prévia de cobranças) até virar uma única página muito longa, empilhando seções que servem propósitos distintos do operador (ver contrato vs. conferir financeiro vs. executar vistoria). O pedido era separar em abas: Principal, Contrato, Vistorias, Manutenções (nova), Financeiro.

O projeto não tinha, até este momento, nenhum componente de Tabs (nem Radix/shadcn, nem custom) que trocasse **conteúdo de página** — só filtros pill client-side que reordenam/filtram uma lista já carregada (`multas/page.tsx`, `despesas/page.tsx`), o que é um problema diferente.

## Decisão

Implementar as abas como **rotas aninhadas reais** dentro de um route group `[id]/(tabs)/` (não aparece na URL):

```
locacoes/[id]/(tabs)/
  layout.tsx          — header (breadcrumb, status, botões de ação) + nav de abas
  page.tsx             — aba Principal
  contrato/page.tsx
  vistorias/page.tsx
  manutencoes/page.tsx
  financeiro/page.tsx
```

Cada aba é um Server Component independente (ADR 0002) que busca só os dados que usa. `renovar`/`encerrar`/`reajustar`/`cobranca-avulsa`/`editar` ficam **fora** do group, de propósito — são formulários full-page com fluxo próprio, não abas de visualização.

Dedupe de fetch entre `layout.tsx` e a aba ativa via `React.cache()` em `_lib/get-rental-core.ts` — evita round-trip duplicado a `rentals` no mesmo request.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **B — Tabs client-side (ex.: shadcn/ui `Tabs` sobre Radix)** | Exigiria buscar de uma vez, no primeiro carregamento, todos os dados de todas as 5 abas (contrato + vínculo + vistoria + manutenção + as 5 queries hoje em `/financeiro`) — mesmo que o operador nunca abra Financeiro naquela visita. Introduziria a primeira dependência de Tabs do projeto sem necessidade, já que `/locacoes/[id]/financeiro` já existia como rota Server Component completa e autossuficiente — a migração natural era ela virar uma aba, não o inverso. |
| **C — Continuar como página única, só com âncoras/scroll** | Não resolve o problema relatado (tela "exibe tudo em um único lugar") — âncoras ainda carregam e renderizam tudo de uma vez, só mudam o scroll inicial. |

## Justificativa

**`/locacoes/[id]/financeiro` já era uma rota Server Component completa antes desta mudança** — migrá-la para dentro do group é só remover o header próprio; ela não precisou de nenhuma reestruturação de dados. Isso favorece fortemente rotas aninhadas sobre reconstruir tudo como Tabs client-side.

**Fetch escopado por aba é o comportamento certo dado o padrão de dados da tela.** As 5 queries de Financeiro (billings, deposits, deposit_movements, rental_adjustments) são caras de se justificar rodar em toda visita à tela quando o operador só quer ver o Vínculo ou a Vistoria.

**Zero dependência nova.** Rotas aninhadas usam só primitivas do App Router já em uso no resto do projeto (`layout.tsx`, route groups — o padrão `(dashboard)` já existe na raiz de `apps/web/src/app/`).

**Consistente com ADR 0002.** Leituras continuam em Server Component por rota; nenhuma mutação nova foi introduzida por esta mudança.

## Consequências

### Positivas

- Cada aba só paga o custo das queries que usa — sem overfetch nas 4 abas que o operador não abriu.
- URLs reais e compartilháveis por aba (`/locacoes/[id]/financeiro`, `/locacoes/[id]/vistorias`, etc.) — deep link, back/forward do navegador funcionam nativamente.
- Nenhuma dependência nova adicionada ao projeto.

### Negativas / riscos aceitos

- **Trocar de aba é uma navegação real, não uma troca de estado local** — cada clique dispara um round-trip ao servidor (mitigado por prefetch automático de `<Link>` em viewport, padrão do App Router, mas ainda não é instantâneo como um Tabs client-side seria).
- **Mais arquivos por tela** — 1 `layout.tsx` + 5 `page.tsx` + `_lib`/`_components` locais, contra 1 arquivo monolítico antes. Aceito como o custo direto de separar responsabilidades que o próprio pedido original exigia.
- **`React.cache()` dedupe é só por-request** — não evita round-trips ao Supabase entre navegações diferentes (cada troca de aba é um request novo).

### Neutras

- O padrão de labels/badges compartilhados (`_lib/shared.ts`) e o `get-rental-core.ts` cacheado são específicos desta tela — não foram promovidos a um padrão de projeto genérico (ex.: um "tela em abas" reutilizável) porque esta é a primeira tela do projeto com esse formato; generalizar antes de um segundo caso real seria abstração prematura.

## Quando reavaliar

- Se uma segunda tela do projeto precisar do mesmo padrão de abas, considerar extrair o esqueleto (`layout.tsx` + `RentalTabNav`) para um padrão documentado/reutilizável.
- Se o round-trip de navegação entre abas se mostrar perceptível o suficiente para incomodar o operador em uso real (não só em teoria), reavaliar um híbrido: abas "leves" (Principal, Contrato, Vistorias, Manutenções) client-side com um único fetch, mantendo só Financeiro como rota separada por causa do peso das suas queries.

## Referências

- [[Telas/Locações]] — seção "Detalhe da locação em abas (2026-08-01)", tabela de rotas atualizada.
- [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] — padrão canônico de leitura via Server Component que esta decisão preserva.
