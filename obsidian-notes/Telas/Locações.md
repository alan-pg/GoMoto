# 🔑 Tela: Locações — [[GoMoto]]

Rota base: `/locacoes` | Tipo: mistura de Server Component (leitura/SSR) + Client Component (formulários)

> Nota criada em 2026-07-24 para cobrir a família de rotas de locação — referenciada pela Spec 0008 (`related: [[Telas/Locações]]`) mas nunca escrita até então.

## Rotas

| Rota | Arquivo | Responsabilidade |
|---|---|---|
| `/locacoes` | `page.tsx` | Listagem de contratos (ativos/encerrados) |
| `/locacoes/fila` | `fila/page.tsx` | Fila de espera |
| `/locacoes/nova` | `nova/page.tsx` + `_components/RentalForm.tsx` (modo criação) | Criação de locação com preview de cobranças |
| `/locacoes/[id]` | `[id]/page.tsx` | Detalhe — resumo financeiro, contrato, vínculo, prévia de cobranças (somente leitura) |
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

## Reajustar locação (F11) — detalhes de implementação

- RPC `adjust_rental` (migration `20260724232232_adjust_rental_rpc.sql`): lock na locação, `UPDATE billings` em lote só para `status='pending'`, insere histórico em `rental_adjustments`, atualiza `rentals.cycle_amount`/`late_charge_config`. Atômico (RNF-006).
- Recálculo proporcional (RN-027) via `calculateAdjustedBillingAmount` em `packages/core/src/rules/rentals.ts` — cobrança pro rata mantém a mesma fração do novo valor, não vira o valor cheio.
- Prévia de impacto (RF-029) via `previewRentalAdjustment` (mesmo arquivo), consumida tanto pela UI quanto potencialmente por outras integrações.
- `renew_rental` corrigido na mesma migration: cobranças de renovação agora saem com `source='rental_cycle'` (antes caíam no default `'manual'`).

## Tags
`#projeto/tela` `#gomoto/locacoes` `#gomoto/financeiro`
