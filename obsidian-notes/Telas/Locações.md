# 🔑 Tela: Locações — [[GoMoto]]

Rota base: `/locacoes` | Tipo: mistura de Server Component (leitura/SSR) + Client Component (formulários)

> Nota criada em 2026-07-24 para cobrir a família de rotas de locação — referenciada pela Spec 0008 (`related: [[Telas/Locações]]`) mas nunca escrita até então.

## Rotas

| Rota | Arquivo | Responsabilidade |
|---|---|---|
| `/locacoes` | `page.tsx` | Listagem de contratos (ativos/encerrados) |
| `/locacoes/fila` | `fila/page.tsx` | Fila de espera |
| `/locacoes/nova` | `nova/page.tsx` + `_components/RentalForm.tsx` (modo criação) | Criação de locação com preview de cobranças + geração opcional de contrato (PDF) |
| `/locacoes/[id]` | `[id]/page.tsx` | Detalhe — resumo financeiro, contrato (+ anexo do PDF assinado), vínculo, prévia de cobranças (somente leitura) |
| `/locacoes/[id]/editar` | `[id]/editar/page.tsx` + `_components/RentalForm.tsx` (modo edição) | **Só** caução + observações |
| `/locacoes/[id]/renovar` | `_components/RenewForm.tsx` | Estender prazo (`renewRental`) |
| `/locacoes/[id]/encerrar` | `_components/TerminateForm.tsx` | Antecipar fim (`terminateRental`) |
| `/locacoes/[id]/reajustar` | `_components/AdjustRentalForm.tsx` | Reajustar valor do ciclo + encargos (`adjustRental`, PRD 0008 F11) |
| `/locacoes/[id]/cobranca-avulsa` | — | Cobrança avulsa fora do ciclo |
| `/locacoes/[id]/financeiro` | `[id]/financeiro/page.tsx` | Extrato completo: cobranças, caução, histórico de reajustes |

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

**Visualizar/baixar o contrato em `/locacoes/[id]` (2026-07-27), trocar o modelo só em `/locacoes/[id]/editar`:** `ContractPreviewPanel.tsx` (client, na seção "Contrato" da tela de detalhe) substitui o antigo link estático pro modelo. Mesmo padrão de resolução de variáveis do Step 2 da criação, mas alimentado com os dados **persistidos** da locação (props vindas do `page.tsx`, que agora expande os `select` de `customer`/`vehicle` pra trazer todos os campos que `resolveContractVariables` precisa, e busca `tenants.legal_name`/`name` em paralelo).

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

## Tags
`#projeto/tela` `#gomoto/locacoes` `#gomoto/financeiro`
