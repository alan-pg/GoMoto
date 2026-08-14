---
status: aprovado
versão: 1.0
modo: completo
autor: Alan (com agente IA)
data: 2026-08-12
prd: —
adr:
  - "[[decisions/0024-ledger-financeiro-com-contrapartida]]"
related:
  - "[[Banco de Dados]]"
  - "[[Fluxos de Negócio]]"
  - "[[decisions/0002-padrao-canonico-pagina-server-actions]]"
  - "[[decisions/0016-escrita-cliente-mobile-route-handler]]"
tags:
  - spec
  - financeiro
  - ledger
  - multi-tenant
---

# Spec 0014 — Redesenho do sistema financeiro

> ✅ **Status: aprovado.** Versão 1.0 — 2026-08-12. Spec técnica derivada de [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]]. Sem PRD de origem: é redesenho técnico sem superfície de produto nova, seguindo o precedente da ADR 0019. Ordem de implementação: migrations → `@gomoto/core` → `@gomoto/data` → Server Actions → telas → mobile → Edge Function.

---

## 1. Visão Geral Técnica

Substituição do domínio financeiro por um ledger de movimentos com contrapartida. Duas camadas:

1. **Núcleo imutável** — `financial_transactions` + `financial_entries`, invariante `SUM(amount_signed) = 0` por transação. Toda movimentação de dinheiro passa por aqui.
2. **Documentos de negócio** — `charges` (a receber), `payables` (a pagar), `payments`, `deposits`, `customer_credits`. Emitem lançamentos; nunca guardam saldo.

Uma terceira camada, por tenant e versionada, define a **classificação** para relatório: `report_lines` + `tenant_account_mappings`. A estrutura do registro é fixa; o DRE é política da empresa (ADR 0024, Princípio 6).

**Raio de impacto medido:** 54 arquivos em `apps/` e `packages/` referenciam tabelas financeiras.

**Tabelas removidas:** `billings`, `late_charges`, `credit_applications`, `expenses`, `billing_pix`, `payment_connections`, `deposit_movements`, views `vehicle_cost_summary` e `vehicle_financial_events`, funções `fn_auto_apply_credit` e `fn_recalculate_delinquency`.

**Tabelas que permanecem, perdendo colunas de dinheiro:** `fines`, `maintenances`, `vehicle_obligations` (ganham `payable_id`); `customers` (perde `delinquency_status`); `rentals` (perde `late_charge_config`).

---

## 2. Arquitetura

### 2.1 Camadas

| Camada | Responsabilidade | Onde vive |
|---|---|---|
| Plano de contas | Identidade econômica da conta | `financial_accounts` (global, sem `tenant_id`) |
| Ledger | Fatos financeiros balanceados e imutáveis | `financial_transactions`, `financial_entries` |
| Documentos | Ordens de pagamento e recibos | `charges`, `charge_items`, `payables`, `payments`, `payment_allocations` |
| Cronograma | Plano de cobrança da locação (mutável) | `rental_billing_schedules` |
| Política | Encargo, inadimplência, crédito — tipadas e versionadas | `late_charge_policies`, `delinquency_policies`, `credit_policies` |
| Classificação | Linha de DRE e base fiscal por tenant | `report_lines` + default na conta, `tenant_account_mappings` como override |
| Gateway | Provedor como dado | `payment_provider_accounts`, `payment_intents`, `gateway_events` |
| Derivação | Saldos e estados calculados | Views |

### 2.2 Regras invioláveis preservadas

- Toda tabela com dado de tenant: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, RLS habilitada, política `tenant_isolation_*` via `get_user_tenants()`, trigger `update_updated_at_column`.
- Exceções declaradas (catálogos globais, precedente `permissions`/`permission_modules`): `financial_accounts`, `report_lines`.
- Identificadores em inglês; rótulos e mensagens em português.
- Schemas Zod e regras puras em `@gomoto/core`; hooks de leitura em `@gomoto/data`; mutações só via Server Action com `getCurrentTenantId()`, `logAction()` e `revalidatePath()` (ADR 0002).
- Views com `WITH (security_invoker = true)`.

---

## 3. Modelo de Dados

### 3.1 Enums

```sql
CREATE TYPE entry_direction     AS ENUM ('debit','credit');
CREATE TYPE account_kind        AS ENUM ('asset','liability','equity','revenue','expense','reimbursement');
CREATE TYPE schedule_status     AS ENUM ('scheduled','issued','cancelled','superseded');
CREATE TYPE charge_status       AS ENUM ('open','paid','cancelled','written_off');
CREATE TYPE responsibility_type AS ENUM ('company','customer','shared');
CREATE TYPE payable_status      AS ENUM ('open','paid','cancelled');
CREATE TYPE reimbursement_mode  AS ENUM ('none','charge','credit');
```

`payment_method_type` e `late_fee_type` já existem e são preservados. Removidos: `billing_source`, `billing_pix_status`, `deposit_movement_type`, `deposit_status`, `credit_origin`, `delinquency_level`.

### 3.2 Plano de contas

Catálogo global, 20 contas. `is_configurable = true` marca as que o tenant pode remapear no DRE.

| Código | Conta | `kind` | Normal | Config. |
|---|---|---|---|---|
| 1.1.1 | caixa_e_bancos | asset | débito | |
| 1.1.2 | contas_a_receber | asset | débito | |
| 1.2.1 | frota_veiculos | asset | débito | ✓ |
| 1.2.2 | depreciacao_acumulada | asset | crédito | ✓ |
| 2.1.1 | caucoes_a_devolver | liability | crédito | |
| 2.1.2 | creditos_de_clientes | liability | crédito | |
| 2.1.3 | contas_a_pagar | liability | crédito | |
| 3.1.1 | receita_locacao | revenue | crédito | |
| 3.1.2 | receita_encargos_atraso | revenue | crédito | ✓ |
| 3.1.3 | receita_venda_ativo | revenue | crédito | ✓ |
| 4.1.1 | despesa_manutencao | expense | débito | |
| 4.1.2 | despesa_multa | expense | débito | |
| 4.1.3 | despesa_documentacao | expense | débito | |
| 4.1.4 | despesa_seguro | expense | débito | |
| 4.1.5 | despesa_operacional | expense | débito | |
| 4.1.6 | despesa_depreciacao | expense | débito | |
| 4.2.1 | perda_inadimplencia | expense | débito | |
| 4.9.1 | repasse_manutencao | reimbursement | crédito | ✓ |
| 4.9.2 | repasse_multa | reimbursement | crédito | ✓ |
| 4.9.3 | repasse_operacional | reimbursement | crédito | ✓ |

### 3.3 Matriz de eventos → lançamentos

Especificação executável: cada linha é um caso de teste em `packages/core/src/rules/ledger.spec.ts`.

| Evento (`event_type`) | Débito | Crédito |
|---|---|---|
| `charge_issued` (aluguel) | contas_a_receber | receita_locacao |
| `payment_received` | caixa_e_bancos | contas_a_receber |
| `deposit_received` | caixa_e_bancos | caucoes_a_devolver |
| `deposit_retained` | caucoes_a_devolver | contas_a_receber |
| `deposit_returned` | caucoes_a_devolver | caixa_e_bancos |
| `payable_created` (multa da empresa) | despesa_multa | contas_a_pagar |
| `charge_issued` (repasse de multa) | contas_a_receber | repasse_multa |
| `payable_created` (manutenção) | despesa_manutencao | contas_a_pagar |
| `charge_issued` (rateio ao cliente) | contas_a_receber | repasse_manutencao |
| `credit_granted` | despesa_manutencao | creditos_de_clientes |
| `credit_applied` | creditos_de_clientes | contas_a_receber |
| `late_charge_realized` | contas_a_receber | receita_encargos_atraso |
| `charge_written_off` | perda_inadimplencia | contas_a_receber |
| `payment_reversed` | contas_a_receber | caixa_e_bancos |
| `charge_issuance_reversed` | conta de crédito original | contas_a_receber |
| `payable_paid` | contas_a_pagar | caixa_e_bancos |
| `vehicle_acquired` | frota_veiculos | contas_a_pagar |
| `depreciation_posted` | despesa_depreciacao | depreciacao_acumulada |
| `vehicle_sold` | caixa_e_bancos | receita_venda_ativo |

Dois eventos nasceram na implementação, não no desenho:

- **`charge_issuance_reversed`** — cancelar cobrança emitida precisa desfazer a
  emissão creditando **contas_a_receber** contra a conta que a emissão creditou.
  A primeira versão reusou `payable_created`, que credita `contas_a_pagar`:
  cancelar uma cobrança transformava dívida de cliente em dívida com fornecedor.
- **`payable_paid`** — pagar conta a pagar é fato distinto de criá-la; sem ele o
  passivo nascia e nunca era liquidado.

### 3.4 DDL

O DDL completo de cada tabela está nas migrations (§5). Pontos que carregam decisão:

**`financial_entries.amount_signed`** — coluna gerada `GENERATED ALWAYS AS (CASE WHEN direction='debit' THEN amount ELSE -amount END) STORED`. Base da invariante e de toda agregação.

**Invariante de balanço** — `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` chamando `fn_assert_transaction_balanced()`, que verifica `SUM(amount_signed) = 0` por `transaction_id` no commit. `DEFERRABLE` permite inserir as pernas em qualquer ordem dentro da mesma transação de banco.

**Imutabilidade** — trigger `BEFORE UPDATE OR DELETE` chamando `fn_reject_mutation()`, que levanta exceção. Vale para `financial_entries` e `financial_transactions`.

**`charges` sem `total_amount`/`paid_amount`** — derivados em `charge_balances`. Princípio 2.

**`payables` com rateio em valores** — `customer_amount NUMERIC`, nunca percentual, com quatro `CHECK` que tornam rateio incoerente ingravável:

```sql
CHECK (customer_amount <= amount),
CHECK (responsibility <> 'company'  OR customer_amount = 0),
CHECK (responsibility <> 'customer' OR customer_amount = amount),
CHECK (customer_amount = 0 OR customer_id IS NOT NULL),
CHECK (customer_amount = 0 OR reimbursement <> 'none')
```

**`gateway_events` com `UNIQUE (provider, provider_event_id)`** — idempotência como propriedade do banco.

**Classificação por default global + override** — decidido na implementação da migration 03, ajustando o desenho original. Semear mapeamento por tenant criaria a classe de falha "tenant novo sem mapeamento gera DRE vazio". Em vez disso, `financial_accounts.default_report_line_code` carrega o default conservador (repasse como recuperação de despesa, fora da base fiscal) e `tenant_account_mappings` é override opcional. `fn_resolve_report_line(tenant, conta, data)` faz o `COALESCE`, resolvendo o override vigente na data do fato. Trigger `fn_assert_account_configurable()` impede remapear conta estrutural — um tenant não consegue reclassificar caução ou caixa.

**Tabelas do ledger não têm `updated_at`** — são append-only; um `updated_at` que nunca muda é ruído. Precedente: `vehicle_status_history` (ADR 0011), que também não tem.

**`charges.late_charge_policy_id`** — ponteiro para a política vigente na emissão, não cópia de JSON.

### 3.5 Views

| View | Entrega |
|---|---|
| `charge_balances` | total, pago, em aberto, `is_overdue`, `days_overdue` por cobrança |
| `customer_delinquency` | contagem de vencidas, dias máximos, valor em aberto por cliente |
| `deposit_balances` | saldo de caução por locação |
| `customer_credit_balances` | saldo de crédito por cliente |
| `vehicle_financial_position` | receita, custo bruto, repassado, `net_result` por veículo |
| `income_statement` | DRE por período e linha, resolvido pelo mapeamento vigente na data do fato |

Todas usam `LEFT JOIN LATERAL` com subconsulta agregada, nunca `JOIN` irmão seguido de `SUM` — é a forma que torna o fan-out de F-01 inexpressável.

---

## 4. Serviços e regras puras

### 4.1 `@gomoto/core`

| Função | Responsabilidade |
|---|---|
| `buildLedgerEntries(event)` | Traduz evento de domínio em pernas de débito/crédito. Cobre as 19 linhas de §3.3 |
| `calculateAmountDue(charge, policy, asOf)` | Total + encargo acumulado − crédito. **Fonte única** — consumida por web, Route Handler do mobile e criação de intent |
| `calculateAccruedCharges(policy, principal, dueDate, asOf)` | Encargo projetado; não vira lançamento até ser realizado |
| `allocatePayment(payment, openCharges)` | Aloca por vencimento mais antigo |
| `applyCredits(credits, charges, policy)` | Todos os créditos não expirados, cobrança mais antiga, só recebível operacional |
| `splitResponsibility(amount, responsibility, customerAmount)` | Valida rateio; percentual é entrada de UI |
| `classifyDelinquency(facts, policy)` | `current`/`late`/`delinquent`/`blocked` sobre a view |
| `generateSchedule(rental)` | Linhas de cronograma; mesma função usada no preview |

### 4.2 Server Actions

`ChargeService`, `PaymentService`, `PayableService` — cada mutação resolve tenant server-side, valida Zod, escreve documento **e** lançamentos na mesma transação, chama `logAction()` e `revalidatePath()`.

Remove a lógica duplicada de sincronização de cobrança hoje em `multas/actions.ts`, `despesas/actions.ts` e no fluxo de manutenção.

### 4.3 Job de emissão

Vercel Cron → Route Handler idempotente, emitindo linhas com `period_start <= hoje + lead_days`. Idempotente por `UNIQUE (rental_id, sequence_number)` + transição `scheduled → issued`. Ação manual equivalente disponível ao operador. Alerta quando há linhas `scheduled` vencidas não emitidas.

---

## 5. Plano de migrations

| # | Nome | Conteúdo |
|---|---|---|
| 01 | `financial_enums` | Novos enums; drop dos obsoletos |
| 02 | `financial_accounts_seed` | Catálogo global + 20 contas |
| 03 | `report_lines_and_mappings` | `report_lines`, `tenant_account_mappings`, `fn_resolve_report_line()` |
| 04 | `org_dimensions` | `branches`, `cost_centers` |
| 05 | `financial_policies` | Três tabelas de política tipada + seed default |
| 06 | `ledger_core` | Transações, lançamentos, invariante, imutabilidade |
| 07 | `rental_schedules` | `rental_billing_schedules` |
| 08 | `charges_and_items` | `charges`, `charge_items`, sequência de `charge_number` |
| 09 | `payments_and_allocations` | Drop e recriação sem `UNIQUE(billing_id)` |
| 10 | `payables` | Contas a pagar com rateio em valores |
| 11 | `deposits_credits_rewrite` | Sem colunas de saldo |
| 12 | `gateway_abstraction` | Intents, contas de provedor, inbox. **Também dropa** `billing_pix` e `payment_connections` — agrupar substituto e substituído deixa a mudança legível de uma vez |
| 13 | `fiscal_documents` | Documentos fiscais |
| 14 | `financial_views` | Todas as views de §3.5 |
| 15 | `drop_legacy_financial` | Drop das tabelas, views e funções listadas em §1 (o gateway legado saiu na 12) |
| 16 | `operational_cleanup` | `fines`/`maintenances`/`vehicle_obligations` ganham `payable_id`; `customers` perde `delinquency_status` |
| 17 | `rpc_rewrite` | `create_rental_with_schedule`, `issue_due_charges`, `terminate_rental` com apuração, `adjust_rental_schedule` sobre cronograma |
| 18 | `post_financial_transaction` | Escrita atômica no ledger. Sem ela, transação e pernas iriam em statements separados e uma falha deixaria transação órfã |
| 19 | `fix_financial_views_null_aggregates` | `COALESCE` nos agregados: `SUM(...) FILTER` devolve NULL sem linhas, e um veículo com receita e sem despesa mostrava resultado vazio |

**Job de emissão:** consequência direta da reversão da ADR 0009. Vercel Cron diário (`/api/cron/issue-charges`, 06:00) converte linha de cronograma em cobrança quando o período chega. Fail-closed sem `CRON_SECRET`.

---

## 6. Segurança

- RLS em toda tabela nova com dado de tenant, política via `get_user_tenants()`.
- `financial_accounts` e `report_lines` são catálogos globais: `SELECT` para `authenticated`, escrita só por migration.
- Views com `security_invoker = true` — isolamento herdado das tabelas base.
- `payment_provider_accounts.credentials` em JSONB: cifrar com `pgcrypto` (já habilitado). Hoje `access_token` está em texto puro — não regride, mas é a oportunidade de corrigir.
- Teste de isolamento por tenant obrigatório para cada tabela nova.

---

## 7. Test Strategy

| Nível | Cobertura |
|---|---|
| Unit (Vitest) | As 19 linhas de §3.3 via `buildLedgerEntries`; `calculateAmountDue` com crédito e encargo; `allocatePayment` parcial e múltiplo; `splitResponsibility` com centavo ímpar; `classifyDelinquency` por limiar |
| Invariante (SQL) | Inserir perna solta e esperar falha no commit; tentar `UPDATE`/`DELETE` em lançamento e esperar exceção |
| Reconciliação | `SUM(amount_signed) = 0` em 100% das transações do seed; `charge_balances.paid_amount` = soma das alocações |
| Integração | Webhook: evento duplicado não gera segundo pagamento; refund gera estorno |
| E2E (Playwright) | Specs financeiras reescritas para o domínio novo: pagamento parcial, rateio em valores, encerramento com apuração, ausência de editar/excluir. `entradas.spec.ts` removida — testava a rota `/entradas` e a tabela `incomes`, ambas inexistentes desde a ADR 0013 |

**Portões:** `pnpm db:reset` → `pnpm typecheck` → `pnpm test` → `pnpm build` (com dev server parado) → `pnpm --filter web test:e2e`.

---

## 8. Performance e Escalabilidade

Estimativa: locação mensal gera ~4 lançamentos/mês; 500 locações ativas ≈ 24 mil lançamentos/ano — três ordens de grandeza abaixo de qualquer limite do Postgres.

| Pressão | Gatilho | Resposta |
|---|---|---|
| Agregação de saldos | > ~1M lançamentos/tenant | Snapshot mensal por conta e dimensão |
| Volume de `financial_entries` | > ~50M linhas | Particionamento por `occurred_at` |
| `charge_balances` em listagem | centenas de cobranças | Índices em `charge_items(charge_id)` e `payment_allocations(charge_id)`; paginação server-side |
| `gateway_events` | alto volume | Retenção: arquivar processados > N meses |

Nenhuma dessas otimizações deve ser feita antes de medir. Todas são invisíveis às consultas de negócio, porque tudo passa pelas views.

---

## 9. Riscos Técnicos

| Risco | Mitigação |
|---|---|
| Janela longa de app quebrado (54 arquivos) | Commits por camada com typecheck verde e `db:reset` funcional em cada |
| Job de emissão falhar e cobranças não saírem | Idempotente e retomável; alerta de `scheduled` vencido; ação manual |
| `DEFERRABLE` mal empregada permitir transação desbalanceada | Teste dedicado inserindo perna solta |
| Serviço financeiro único como ponto de falha | Funções puras testadas por evento; invariante do banco como segunda barreira |
| Tenant configurar mapeamento incoerente | Só contas `is_configurable`; seed conservador; UI restrita a admin com pré-visualização |
| Mudança de política reescrever período anterior | Mapeamento resolvido por `effective_from` contra a data do fato |

---

## 10. Rastreabilidade

| Achado / Princípio | Resolvido por |
|---|---|
| F-01 fan-out | `vehicle_financial_position` sobre tabela única; `LEFT JOIN LATERAL` nas views |
| F-02 receita do app invisível | `PaymentService` grava pagamento + alocação em todo caminho, inclusive webhook |
| F-03 três definições de receita | `kind='revenue'` sobre `financial_entries`; base fiscal separada por `in_tax_base` |
| F-04 inadimplência inerte | `customer_delinquency` + `classifyDelinquency` |
| F-05 valor divergente no gateway | `calculateAmountDue` como fonte única |
| F-06 trigger de crédito | `applyCredits` puro, sem `EXCEPTION WHEN OTHERS` |
| F-07 responsabilidade de despesa | `payables.responsibility` + `customer_amount` |
| F-08 encerramento sem apuração | `terminate_rental` reescrito (migration 17) |
| F-09 caução como receita | `caucoes_a_devolver` é passivo |
| F-10 "a receber" com contrato inteiro | Cronograma separado de documento |
| F-11 origem polimórfica | `(source_module, source_id)` uniforme |
| F-12 cobrança sem itens | `charge_items` |
| F-13/F-14 gateway acoplado | `payment_intents` + `gateway_events` |
| F-15 rateio ignorado no custo | Lançamentos separados por responsabilidade |
| F-16 baixa grava valor bruto | Alocação registra o efetivamente recebido |
| F-17 percentual inteiro | Rateio em valores |
| F-18 colunas nullable | `NOT NULL` + `CHECK` em todo valor monetário |
| F-19 `billing_type='fine'` morto | Enum eliminado |
| F-20 nota desatualizada | `Banco de Dados.md` reescrita nesta entrega |

---

## 10.1 Pendências após a implementação

Auditoria de 2026-08-13 conferindo o planejado contra o código. Os 20 achados
(F-01…F-20) e as 19 migrations estão entregues; o que segue aberto é secundário
e está registrado para não se perder:

| # | Pendência | Origem | Impacto |
|---|---|---|---|
| P-1 | `payment_provider_accounts.credentials` em texto puro | §6 previa cifrar com `pgcrypto` | Não regride (o legado também era texto puro), mas era a oportunidade de corrigir |
| P-2 | Sem emissão manual de cobrança pelo operador | §4.3 | Se o Cron falhar, só resta esperar o dia seguinte |
| P-3 | Sem alerta de linha `scheduled` vencida e não emitida | §4.3 | Falha silenciosa do job passa despercebida |
| P-4 | Invariante do ledger não tem teste automatizado | §7, linha "Invariante (SQL)" | Verificada à mão (perna solta rejeitada, `UPDATE`/`DELETE` bloqueados); sem teste, uma migration futura pode afrouxar sem ninguém notar |
| P-5 | Webhook sem teste automatizado | §7, linha "Integração" | Refund e idempotência estão **implementados** na Edge Function, mas nada os exercita |
| P-6 | Sem teste de isolamento por tenant nas tabelas novas | §6 chamava de obrigatório | RLS existe e está habilitada em 100% das tabelas com `tenant_id`; falta o teste que prova |
| P-7 | Reconciliação testada só no escopo da spec E2E | §7 pedia 100% das transações | `cobrancas.spec.ts` valida `SUM = 0` apenas nas transações que ela cria |

Nenhuma bloqueia o uso do sistema. P-4 e P-6 são as que mais deixam a entrega
exposta a regressão futura, porque protegem invariantes que hoje só existem
como acordo.

---

## 11. Aprovação

Aprovada em 2026-08-12 por Alan. Modalidade de execução: substituição total (big-bang), decisão registrada com o risco aceito na ADR 0024.
