# 🔑 Tela: Locações — [[GoMoto]]

Rota base: `/locacoes` | Tipo: mistura de Server Component (leitura/SSR) + Client Component (formulários)

> Nota criada em 2026-07-24 para cobrir a família de rotas de locação — referenciada pela Spec 0008 (`related: [[Telas/Locações]]`) mas nunca escrita até então.

## Rotas

| Rota | Arquivo | Responsabilidade |
|---|---|---|
| `/locacoes` | `page.tsx` | Listagem de contratos (ativos/encerrados) |
| `/locacoes/fila` | `fila/page.tsx` | Fila de espera |
| `/locacoes/nova` | `nova/page.tsx` + `_components/RentalForm.tsx` (modo criação) | Criação de locação com preview de cobranças + geração opcional de contrato (PDF) + vínculos de Perfil de Vistoria (Spec 0009) |
| `/locacoes/[id]` | `[id]/(tabs)/layout.tsx` + `[id]/(tabs)/page.tsx` | Detalhe — abas (ver seção própria abaixo). Aba **Principal**: cards de totais + vínculo cliente/veículo — somente leitura |
| `/locacoes/[id]/contrato` | `[id]/(tabs)/contrato/page.tsx` | Aba **Contrato**: dados do contrato, preview/download do PDF, anexo do assinado — somente leitura |
| `/locacoes/[id]/vistorias` | `[id]/(tabs)/vistorias/page.tsx` | Aba **Vistorias**: status check-in/check-out + comparação + agendamento periódico (Spec 0009) — somente leitura |
| `/locacoes/[id]/manutencoes` | `[id]/(tabs)/manutencoes/page.tsx` | Aba **Manutenções**: manutenções do veículo cujo período cai dentro da locação — somente leitura |
| `/locacoes/[id]/financeiro` | `[id]/(tabs)/financeiro/page.tsx` | Aba **Financeiro**: extrato completo — cobranças, caução, histórico de reajustes |
| `/locacoes/[id]/editar` | `[id]/editar/page.tsx` + `_components/RentalForm.tsx` (modo edição) | **Só** caução + observações — fora do group de abas, sem barra de abas |
| `/locacoes/[id]/renovar` | `_components/RenewForm.tsx` | Estender prazo (`renewRental`) — fora do group de abas |
| `/locacoes/[id]/encerrar` | `_components/TerminateForm.tsx` | Antecipar fim (`terminateRental`) — fora do group de abas |
| `/locacoes/[id]/reajustar` | `_components/AdjustRentalForm.tsx` | Reajustar valor do ciclo + encargos (`adjustRental`, PRD 0008 F11) — fora do group de abas |
| `/locacoes/[id]/cobranca-avulsa` | — | Cobrança avulsa fora do ciclo — fora do group de abas |

## Detalhe da locação em abas (2026-08-01)

`/locacoes/[id]` deixou de ser uma página única (contrato + vínculo + vistoria + prévia de cobranças tudo empilhado) e virou 5 abas via **rotas aninhadas** — não um componente de Tabs client-side. Ver [[decisions/0017-rotas-aninhadas-para-abas-de-locacao]] para a análise completa da decisão (trade-off contra Tabs client-side/shadcn).

- **Estrutura**: route group `[id]/(tabs)/` (não aparece na URL) contendo `layout.tsx` (header + nav de abas) e uma pasta por aba (`page.tsx` = Principal, `contrato/`, `vistorias/`, `manutencoes/`, `financeiro/`). Cada aba é um Server Component independente que busca só os dados que usa — trocar de aba é uma navegação real (round-trip ao servidor), não troca de estado local.
- **`renovar`/`encerrar`/`reajustar`/`cobranca-avulsa`/`editar` ficam fora do group**, de propósito — são formulários full-page com header próprio, não abas de visualização.
- **`_lib/get-rental-core.ts`**: fetch base de `rentals` (+ customer/vehicle/contract_template, mesmo `.select()` literal de sempre) envolto em `React.cache()` — dedupe por request entre `layout.tsx` e a aba ativa, um único round-trip a `rentals` mesmo com dois Server Components pedindo os mesmos dados. `warnMissingContractFields` roda na aba Contrato, que é quem de fato consome os campos de contrato.
- **`_lib/shared.ts`**: labels/badges (`STATUS_BADGE`, `CYCLE_LABEL`, `SCHEDULE_STATUS_BADGE`, `INSPECTION_STATUS_BADGE`, `MAINTENANCE_STATUS_BADGE`, `MAINTENANCE_TYPE_LABEL`) e o helper `fmt()` compartilhados entre abas — evita reimportar de `/financeiro` como antes.
- **`InspectionStatusCard`** saiu de dentro do antigo `page.tsx` monolítico para `(tabs)/_components/InspectionStatusCard.tsx` — só usado pela aba Vistorias.
- **Aba Manutenções é funcionalidade nova, não só extração**: não existe FK `maintenances → rentals` (a tabela só referencia `vehicle_id`, ver `supabase/migrations/20260611002632_initial_schema.sql`). A associação com a locação é inferida por `filterMaintenancesInRentalPeriod()` (`packages/core/src/rules/maintenance.ts`) — mesmo veículo + `scheduled_date` ou `completed_date` dentro de `[start_date, end_date]` da locação. Testado em `maintenance.test.ts`.

## Decisão de escopo: "Editar" não mexe em nada que afeta cobranças

Decisão tomada em 2026-07-24 (não estava em nenhum PRD antes disso — `RentalForm` foi originalmente construído reaproveitando o form de criação, sem spec própria para o modo edição).

Cada campo que impacta cobranças tem **um dono só**, nunca "Editar":

| Campo | Dono | Reprocessa cobranças? |
|---|---|---|
| Cliente, veículo | — (imutável após criação) | — |
| Valor do ciclo, encargos por atraso | **Reajustar** (`adjustRental`) | Sim — RN-025/026/027: só `pending`, pro rata recalculada proporcionalmente |
| Prazo (fim) — estender | **Renovar** (`renewRental`) | Sim — recalcula última cobrança pro rata + gera novas |
| Prazo (fim) — antecipar | **Encerrar** (`terminate_rental` RPC) | Sim — cancela `pending` com `due_date > data_encerramento` |
| Tipo, ciclo, dia de vencimento, início, pro rata | — (imutável após criação) | — nenhum fluxo cobre mudança pós-criação; a orientação na UI é encerrar e criar uma nova locação |
| Caução, observações | **Editar** (`updateRental`) | Observações não. Caução sim, **se ainda pendente** — cascata pra cobrança vinculada (ver seção abaixo); se já paga, só `deposits` muda (cobrança paga é imutável, RNF-007) |

`RentalForm.tsx` é compartilhado entre criação e edição: em modo edição, a seção "Condições do contrato" fica somente-leitura com links diretos para Reajustar/Renovar/Encerrar, e o formulário vira single-step (sem o wizard de preview, que só faz sentido na criação).

## Caução gera cobrança própria (2026-07-26)

Caução deixou de ser só bookkeeping em `deposits` — ver detalhes completos em [[Specs/0008-modulo-financeiro]] (nota na FT-02). Resumo para quem só mexe em tela:

- Criação: checkbox "Caução já foi paga" em `RentalForm` (marcado por padrão) decide se a cobrança de caução (`billing_type='deposit'`) nasce `paid` ou `pending`.
- `/locacoes/[id]/editar` e `/locacoes/[id]/financeiro` buscam o deposit com `.in('status', ['pending', 'received'])` — **não** só `'received'`. Se algum código novo voltar a filtrar só `'received'`, o valor da caução pendente some do formulário de edição silenciosamente (bug já encontrado e corrigido uma vez).
- Labels de `billing_type`/`source` para `'deposit'` existem em 5 lugares diferentes (`lib/billing-status.ts` + mapas locais em `cobrancas/[id]/page.tsx`, `locacoes/[id]/financeiro/page.tsx`, `financeiro/page.tsx`) — todos duplicados, nenhum compartilhado. Adicionar um novo `billing_type`/`source` exige lembrar de todos eles.

## Modelo de contrato + PDF assinado (2026-07-26)

Ver [[Telas/Contratos]] para o catálogo de variáveis e a mecânica de geração. Resumo do lado de locação:

- **Seletor opcional** em `RentalForm.tsx` (Step 1, só na criação): "Modelo (opcional)", alimentado por `useContractTemplates()`. Sem modelo selecionado, nada muda — dá pra anexar um PDF assinado avulso depois de qualquer forma.
- **Geração roda inteiramente no client**, no Step 2 ("Resumo do contrato"): `resolveContractVariables` (`@gomoto/core`) resolve as variáveis a partir do cliente/veículo já carregados nas listas do form (sem fetch adicional) + dos valores já digitados; `renderContractTemplateHtml`/`printHtmlDocument` (`apps/web/src/lib/`) reaproveitam o mesmo mecanismo de impressão do navegador já usado em `/contratos/modelos/[id]`. Não depende da locação existir no banco ainda.
- **Vínculo persistido**: `rentals.contract_template_id` é gravado via `update` best-effort logo após a RPC `create_rental_with_charges` (metadado informativo, sem necessidade de atomicidade com a criação das cobranças).
- **Anexo do PDF assinado**: `rentals.signed_contract_path`/`signed_contract_file_name`/`signed_contract_uploaded_at` (colunas flat, migration `20260727003144_rental_contract_documents.sql`) + bucket privado `rental-documents`. Upload direto no Storage via `SignedContractUpload.tsx` (client, mesmo padrão de `CustomerForm.tsx`), depois `attachSignedContract` (Server Action) grava o path. Visualização via signed URL computada em `[id]/page.tsx` (mesmo padrão de `clientes/[id]/page.tsx`).
- **Decisão: colunas flat em `rentals`, não uma tabela `rental_documents` genérica.** O pedido é um PDF assinado por locação (1:1), não N documentos. Evidência concreta contra a tabela genérica: `clients_documents` (o padrão análogo já existente para clientes) está órfã na prática — só é escrita por uma Server Action que nenhuma tela chama, nunca é lida em lugar nenhum; o padrão que de fato está em produção para documentos de cliente é coluna flat (`drivers_license_photo_url` etc.) + upload direto + signed URL local. Se surgir necessidade real de múltiplos anexos por locação no futuro, isso vira uma extração justificada depois — não construída antecipadamente.
- `rentals.pdf_url` (coluna morta desde a migration inicial, nunca lida/escrita por nenhum código) foi **renomeada** para `signed_contract_path` na mesma migration, em vez de deixar morta + criar 3 colunas do zero.

**Visualizar/baixar o contrato em `/locacoes/[id]` (2026-07-27), trocar o modelo só em `/locacoes/[id]/editar`:** `ContractPreviewPanel.tsx` (client, na seção "Contrato" da tela de detalhe) substitui o antigo link estático pro modelo. Mesmo padrão de resolução de variáveis do Step 2 da criação, mas alimentado com os dados **persistidos** da locação (props vindas do `page.tsx`, que faz um `select` explícito de `customer`/`vehicle` — só na criação o form usa `select('*')` via `@gomoto/data`, então lá qualquer coluna nova já chega de graça).

**Sincronia catálogo ↔ resolver ↔ select explícito (2026-07-27, ver [[Telas/Contratos]]):** `resolveContractVariables` agora retorna `Record<TemplateVariableKey, string>` (tipo derivado de `TEMPLATE_VARIABLES`) — esquecer de resolver uma chave nova do catálogo quebra o `typecheck`, não só um teste. Para as colunas de `customers`/`vehicles`, a fonte única é `CONTRACT_CUSTOMER_FIELDS`/`CONTRACT_VEHICLE_FIELDS` (`@gomoto/core`) — mas **não dá pra montar o `.select()` do Supabase a partir desses arrays em runtime** (`.join(',')` quebra a inferência de tipos do client tipado, que exige string literal). Por isso o `select` explícito de `/locacoes/[id]/page.tsx` continua copiado à mão, e `warnMissingContractFields(label, record, fields)` roda logo após o fetch (dev only) pra acusar em log se uma coluna nova em `CONTRACT_VEHICLE_FIELDS`/`CONTRACT_CUSTOMER_FIELDS` não foi replicada no `.select()` desta página.

- **`/locacoes/[id]` é só leitura pro modelo**: mostra o nome do modelo vinculado (link pra `/contratos/modelos/[id]`) + link "Trocar modelo (Editar) →". Decisão do usuário: a tela de detalhe não é o lugar pra alterar o quê está vinculado — isso é papel da tela de Editar, mesma regra de escopo que já vale pra caução/observações (ver seção acima).
- **Visualizar**: `openHtmlDocument` (`apps/web/src/lib/contract-print.ts`) abre o HTML já substituído numa aba nova via `window.open('', '_blank') + document.write` — não dispara impressão.
- **Baixar (PDF)**: reaproveita `printHtmlDocument` (mesmo mecanismo do Step 2 da criação e de `/contratos/modelos/[id]`).
- Botões desabilitados quando nenhum modelo está vinculado.
- **`/locacoes/[id]/editar`**: a seção "Modelo de contrato" do `RentalForm.tsx`, antes só na criação (`!isEditMode`), agora também aparece em modo edição — mesmo `<select>`, texto de ajuda diferente. `handleSubmit` em modo edição chama `updateRental` (caução/observações) e depois `updateContractTemplate` (novo modelo) em sequência.

## Reajustar locação (F11) — detalhes de implementação

- RPC `adjust_rental` (migration `20260724232232_adjust_rental_rpc.sql`): lock na locação, `UPDATE billings` em lote só para `status='pending'`, insere histórico em `rental_adjustments`, atualiza `rentals.cycle_amount`/`late_charge_config`. Atômico (RNF-006).
- Recálculo proporcional (RN-027) via `calculateAdjustedBillingAmount` em `packages/core/src/rules/rentals.ts` — cobrança pro rata mantém a mesma fração do novo valor, não vira o valor cheio.
- Prévia de impacto (RF-029) via `previewRentalAdjustment` (mesmo arquivo), consumida tanto pela UI quanto potencialmente por outras integrações.
- `renew_rental` corrigido na mesma migration: cobranças de renovação agora saem com `source='rental_cycle'` (antes caíam no default `'manual'`).

## Vistoria (Spec 0009, 2026-07-30)

- **`/locacoes/nova`**: `RentalForm.tsx` ganha a seção "Vistoria" (só criação, `!isEditMode` — mesmo padrão de escopo da seção acima): dois seletores de Perfil de Vistoria (`useInspectionProfiles()`, filtrado a `archived_at === null`) — Check-in/Check-out e Periódica + frequência (dias, obrigatória sse o perfil periódico for selecionado, RN-005). Os três campos vão direto no payload de `createRental` → RPC `create_rental_with_charges` estendida, que insere `inspections` (check-in/check-out `pending`) e `inspection_schedules` (upfront) na mesma transação.
- **`/locacoes/[id]/vistorias`** (aba Vistorias, ver seção "Detalhe da locação em abas" acima): cards de status de check-in/check-out (link para `/vistorias/execute/[id]`, mesmo componente de execução usado na lista central de pendências, RF-018), comparação lado a lado quando ambos `completed` (`InspectionComparisonPanel.tsx`), e tabela de agendamentos periódicos com status derivado na leitura (`deriveInspectionScheduleStatus` de `@gomoto/core` — nunca de `@gomoto/data`, ver nota abaixo).
- **Vínculos são imutáveis após a criação** — mesma decisão de escopo de tipo/ciclo/dia de vencimento (tabela acima): não há fluxo de "editar vistoria" numa locação já criada.
- **Armadilha de bundling: Server Component não pode importar de `@gomoto/data`.** `packages/data`'s `index.ts` reexporta hooks (`createContext`/`useEffect` sem `'use client'` no próprio arquivo) — importar qualquer símbolo do pacote (mesmo um repositório "puro") num Server Component quebra o build do Next ("You're importing a component that needs createContext"). Todas as abas de `/locacoes/[id]/(tabs)/` e `/veiculos/[id]/page.tsx` fazem `select()` inline via `createClient()` (nunca chamam repositórios de `@gomoto/data`); a lógica de derivação de status (`deriveInspectionScheduleStatus`, `pickLatestInspectionBySchedule`, `filterMaintenancesInRentalPeriod`) fica em `@gomoto/core` justamente para ser importável dos dois lados (Server Component e hook de Client Component).

## Tags
`#projeto/tela` `#gomoto/locacoes` `#gomoto/financeiro`
