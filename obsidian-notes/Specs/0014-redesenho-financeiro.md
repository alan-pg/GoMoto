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

**Job de emissão:** consequência direta da reversão da ADR 0009. Converte linha de cronograma em cobrança quando o período chega.

Migrou do Vercel Cron para **pg_cron** (migration 20, `billing_emission_in_database`) por um motivo que não é latência: **atomicidade**. Na versão anterior a emissão eram duas transações — a RPC criava a cobrança e marcava a linha como `issued`, e o Route Handler lançava no ledger numa segunda chamada. Falha entre as duas deixava a cobrança existindo, visível na tela e pagável, **sem nunca ter entrado em contas a receber**; e a execução seguinte não corrigia, porque a linha já estava consumida. Dentro do banco, documento e lançamento são a mesma transação e o modo de falha deixa de ser expressável.

A tradução evento → contas continua em `@gomoto/core` para os demais eventos. Aqui ela não é replicada: as pernas saem mecanicamente de `charge_items.credit_account_code`, que a própria cobrança já declara.

`billing_runs` registra cada execução por tenant, com contagem e erro. Existe para tornar visível a **ausência** de execução — "não rodou" e "rodou e não havia nada a fazer" eram indistinguíveis, que é como um segredo de ambiente ausente derrubaria o faturamento em silêncio.

A rota `/api/cron/issue-charges` permanece como **disparo manual** autenticado, chamando a mesma função: botão do operador e agendamento com uma implementação só.

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
| ~~P-9~~ | ~~Tabelas especulativas e derivação em coluna~~ | Auditoria 2026-08-14 | ✅ **Resolvida** — `branches`, `cost_centers` e `fiscal_documents` removidas (inertes: zero linhas, zero uso, dimensões 100% NULL); `charges.status` guarda só decisão e a view deriva `paid`; `acquisition_cost`/`accumulated_depreciation` saíram da view por retornarem zero por construção |
| ~~P-1~~ | ~~`payment_provider_accounts.credentials` em texto puro~~ | §6 | ✅ **Resolvida** — token vai para o Supabase Vault; a tabela guarda só a referência, e a leitura passa por função com checagem de tenant |
| ~~P-4~~ | ~~Invariante do ledger não tem teste automatizado~~ | §7, linha "Invariante (SQL)" | ✅ **Resolvida** em `tests/ledger-invariants.spec.ts` (5 casos) |
| ~~P-5~~ | ~~Webhook sem teste automatizado~~ | §7 | ✅ **Parcial, deliberadamente** — `tests/webhook-pagamento.spec.ts` cobre as duas garantias de que o webhook depende e que vivem fora dele: idempotência pelo `UNIQUE(provider, provider_event_id)` e estorno que marca em vez de apagar. A Edge Function em si consulta a API do Mercado Pago para confirmar o pagamento; testá-la ponta a ponta exigiria simular um serviço externo, e o que se provaria seria a qualidade do simulador. Fica descoberto o parsing do payload e a chamada externa — a casca fina |
| P-8 | `blockCustomer`/`unblockCustomer` sem chamador na UI | Achado testando as telas (2026-08-13) | As actions existem e estão corretas, mas não há botão. Foi por isso que um bug nelas sobreviveu meses sem ninguém notar. Construir a UI é escopo de produto — onde fica o botão, quem pode usar — e ficou para decisão |
| ~~P-6~~ | ~~Sem teste de isolamento por tenant nas tabelas novas~~ | §6 chamava de obrigatório | ✅ **Resolvida** em `tests/tenant-isolation-financeiro.spec.ts` (24 casos) |
| ~~P-2~~ | ~~Sem emissão manual pelo operador~~ | §4.3 | ✅ **Resolvida** — a rota virou disparo manual da mesma função |
| ~~P-3~~ | ~~Sem alerta de linha `scheduled` vencida~~ | §4.3 | ✅ **Resolvida** — `billing_runs` registra cada execução e a tela financeira exibe faixa vermelha quando passa de 26h sem rodar |
| ~~P-7~~ | ~~Reconciliação testada só no escopo da spec E2E~~ | §7 pedia 100% das transações | ✅ **Resolvida** — `reconciliacao.spec.ts` varre o banco inteiro. Ver §10.5 |

Nenhuma bloqueia o uso do sistema.

**P-4 e P-6 foram executadas em 2026-08-13**, por serem as que protegiam
invariantes que só existiam como acordo:

- **P-4 — `tests/ledger-invariants.spec.ts`.** As duas guardas de
  `trg_entries_balanced` são distintas e ambas ficam cobertas: perna sem
  contrapartida (`< 2 pernas`) e soma diferente de zero com duas pernas — esta
  última é o erro que um bug no serviço produziria, e a contagem não pega.
  Mais imutabilidade: `UPDATE` e `DELETE` em lançamento levantam exceção
  (diferente de `audit_logs`, onde a RLS devolve 0 linhas em silêncio), e
  transação com lançamento não pode ser apagada. Roda com `service_role` de
  propósito: se o invariante resiste a quem ignora RLS, resiste a qualquer
  caminho do app.

- **P-6 — `tests/tenant-isolation-financeiro.spec.ts`.** As 20 tabelas do
  redesenho, uma linha real semeada no tenant 2 em cada, e o cliente do tenant 1
  tentando ler por id, varrer por `tenant_id`, atualizar e apagar. Inclui as 7
  views (prova o `security_invoker`) e o INSERT com `tenant_id` forjado.
  Tem **caso de controle**: o mesmo cliente precisa enxergar a linha do próprio
  tenant — sem ele, uma sessão morta faria os 20 casos passarem lendo vazio.
  O cleanup é best-effort por construção: cobrança emitida e lançamento não são
  apagáveis, e prendem junto cliente, veículo e locação.

---

## 10.2 Achados do teste no navegador (2026-08-13)

Percorrer as telas com o plugin do Chrome encontrou seis defeitos que nenhum
portão pegou — os três níveis de teste passavam verdes com todos eles no lugar.
Cinco foram corrigidos na mesma sessão.

| Achado | Natureza |
|---|---|
| **Bloqueio por inadimplência não era aplicado.** A trava vivia em `createRentalWithDeposit`, que nenhum componente chama; o `RentalForm` usa `createRental` direto. Cliente bloqueado abria locação nova pela tela — reproduzido ao vivo | F-04 estava só de lugar trocado. Trava movida para `createRental` |
| **Ciclo inteiro não faturado.** Com ponta no início E no fim, os períodos são um a mais que os vencimentos; a última cobrança recebia o valor da ponta final e o ciclo cheio sumia. 01/09→01/12 a R$600 gerava 3 cobranças e R$1.200 em vez de 4 e R$1.800 | Pré-existente. `generateCycleCharges` passa a gerar por **período**, não por vencimento, no caminho pro rata |
| Enum `charge_status` novo com mapas de rótulo antigos: lista imprimia `open` cru, detalhe exibia cobrança **baixada** como "Pendente" | Drift da própria ADR 0024 |
| Cobrança baixada exibia "R$ 300,00 a pagar" | `open_amount` é a aritmética do documento e segue devolvendo o saldo de uma baixada — certo para registrar a perda, errado como valor cobrável |
| Painel: coluna "Origem" exibia dias de atraso; card "Pendente no mês" somava as vencidas enquanto a contagem as excluía | Rótulo e dupla contagem com o card "Vencidas" |
| `blockCustomer`/`unblockCustomer` sem chamador na UI | Registrado como P-8 |

A lição que fica: os portões deste repo medem compilação, regra pura e fluxo
automatizado — nenhum deles percorre a tela como um operador. Uma trava colocada
numa função que ninguém chama passa por todos os três.

---

## 10.3 Fechamento da cobertura (2026-08-15)

Sete fluxos do redesenho não tinham teste nenhum. Percorridos um a um, **cinco
revelaram defeito real** — proporção que diz mais sobre o valor do teste de
fluxo do que qualquer argumento.

| Fluxo | O que estava errado |
|---|---|
| Aplicar crédito do cliente | Só lançava no razão. Sem `payments` + `payment_allocations`, `charge_balances` não via nada e a dívida ficava intacta na tela. O enum `payment_method_type` nem tinha `credit` |
| Conceder crédito | Não lançava no razão, então o saldo em `customer_credit_balances` nascia zerado — o crédito não podia ser usado |
| Consolidar encargo por atraso | Botão inalcançável: a página passava `accruedCharges={0}` e `isOverdue={false}` fixos. `isActionable` ainda escondia todas as ações justamente nas vencidas. E o total somava o encargo duas vezes |
| Criar/editar cliente | Quebrado desde 12/08: o form ainda enviava `customers.payment_status`, coluna que a limpeza derrubou |
| Obrigação do veículo | O INSERT enviava `amount`/`status`/`paid_at`, também removidas, e o erro caía num `warnings.push` — o veículo salvava e o IPVA sumia em silêncio. O `upsert` também nunca funcionou: o índice único é **parcial** e o `ON CONFLICT` do PostgREST não repete o predicado. Virou select + insert/update, e o valor agora vira payable |
| Reajuste do cronograma | Correto. Só alcança linha `scheduled`; documento emitido não se move |
| Renovação | Correta. Acrescenta linhas como plano, sem tocar no emitido e sem emitir nada |

Cobertura nova: `credito-e-encargo.spec.ts`, `cadastro-colunas-removidas.spec.ts`,
`reajuste-e-renovacao.spec.ts`, `dre.spec.ts`.

**DRE.** As três garantias que sustentam um demonstrativo auditável estão
provadas: sinal (receita positiva, despesa negativa, conta patrimonial fora),
competência pela data do fato, e — a que importa — **política nova não
reclassifica o passado**. O teste verifica os dois lados: que a política vale
para o fato novo e que não vale para o antigo; sem o primeiro lado ele passaria
com a resolução por data completamente quebrada.

As asserções são por **delta** (antes/depois), não por total absoluto: o razão é
imutável por trigger, lançamento de teste não sai de lá, e asserção absoluta
passaria só na primeira execução.

### Pendências que esta sessão abriu

| # | Pendência | Impacto |
|---|---|---|
| ~~P-10~~ | ~~DRE sem tela~~ | ✅ **Resolvida** — `/financeiro/dre`. Ver §10.4 |
| P-11 | Obrigação já lançada não reajusta | Mudar o valor de uma obrigação que já virou payable é estorno, não sobrescrita, e isso pertence à tela de contas a pagar. Hoje o segundo save simplesmente ignora o valor novo |

### As oito specs vermelhas fora do escopo — resolvidas

Nenhuma delas tocava o banco: falhavam no primeiro clique, então não protegiam
nada. Reescritas contra a UI atual, e o caminho revelou mais dois defeitos.

| Spec | Causa | Achado no caminho |
|---|---|---|
| `veiculos` | O wizard em modal virou página; a edição virou rota | `createVehicle` devolvia "Erro ao cadastrar veículo" sem o motivo do banco |
| `clientes` | A edição virou rota | `createCustomer`/`updateCustomer` diziam só "Dados inválidos"; o `details` vinha no retorno e a tela nunca exibiu |
| `manutencao` | `getModal` pegava o primeiro de **cinco** modais montados | **Agendar manutenção estava quebrado**: o payload enviava `cost`, removida pela ADR 0024. O erro ia para um `alert()`, que o Playwright dispensa em silêncio |
| `document-extraction` (5) | O dev server precisa de `DOCUMENT_EXTRACTION_MOCK=1`; sem ela o Server Action chama o Gemini de verdade | — |
| `document-extraction-multa` (3) | "Responsável pelo pagamento" virou obrigatório na PRD 0013 (11/08); a suíte é de 09/08 | `<select>` obrigatório vazio bloqueia o submit **sem renderizar nada** |

Duas correções de fixture que valem além destas specs: o CPF do cliente de
teste passou a ter dígito verificador válido (gravava `${ts}00`, que entra pelo
service_role mas não passa no schema — qualquer edição pela tela morria num erro
do próprio fixture), e `uniqueSuffix` ganhou ruído aleatório, porque o contador
é por processo e dois workers no mesmo milissegundo colidiam no RENAVAM.

O `Field` do formulário de veículo passou a **envolver** o controle com o
`<label>`. Eram irmãos sem `htmlFor`: leitor de tela anunciava input sem nome, e
nenhum teste conseguia usar `getByLabel` — foi por isso que as specs antigas
acabaram presas a placeholder e posição.

**Suíte completa verde: 106 E2E e 603 unit.**

---

## 10.4 A tela do DRE (P-10)

O demonstrativo existia inteiro — view, repositório, hook — e nenhuma tela o
consumia. Mesmo padrão do P-8 e da trava de inadimplência: a peça certa, sem
chamador. `/financeiro/dre` fecha isso.

**Linhas nas colunas, meses nas colunas.** Uma linha por conceito contábil
(`report_lines`, na ordem que a tabela define), uma coluna por mês, mais total.
O demonstrativo se lê na horizontal: a pergunta é sempre "isto está crescendo
ou encolhendo?". Intervalo de 3, 6 ou 12 meses por query param.

**A view passou a carregar o rótulo e a ordem.** Devolvia só `report_line_code`;
cada consumidor teria de manter a própria tradução e a própria ordenação, e o
mesmo relatório sairia diferente na web e no mobile. Agora `report_line_name` e
`sort_order` vêm de `report_lines` na própria view. O número não mudou — só o
que o acompanha. `security_invoker` preservado.

**Base de cálculo ao lado do resultado.** São somas diferentes (`in_tax_base`
marca quais linhas entram) e ficavam a uma conta de cabeça de distância. Juntas,
não tem como errar.

**Zero número digitado.** Todo valor é soma de lançamento. A tela não reinverte
sinal: a view já entrega receita positiva e despesa negativa, então um sinal
errado na tela é sinal errado no lançamento — que é o que se quer ver.

Cobertura em dois níveis: `dre.spec.ts` prova que o número está certo (sinal,
competência, política que não reclassifica o passado); `dre-tela.spec.ts` prova
que ele chega ao operador com o nome e o sinal certos — o elo que faltava.

---

## 10.5 Reconciliação e o buraco que ela achou (P-7, 2026-08-15)

A §7 pedia `SUM = 0` em 100% das transações e só havia validação dentro do
escopo de cada spec. Ao escrever a varredura, a pergunta útil mostrou-se ser
**outra**, e mais importante:

| Garantia | Quem protege |
|---|---|
| Toda transação fecha em zero | `trg_entries_balanced`, no banco. Não depende de teste |
| **Todo documento vira lançamento** | **Ninguém.** Não há trigger possível: o documento é legítimo antes do lançamento existir |

A segunda é a que decide se o relatório pode ser lido sem conferir a operação
por fora, e é a que já falhou **quatro vezes** neste redesenho: conceder crédito
não lançava, custo de manutenção era descartado, valor da obrigação do veículo
era descartado, e a quarta apareceu agora.

### `issue_due_charges` estava aberta ao cliente

`issue_due_charges` emite o DOCUMENTO e só; quem lança no razão é
`fn_issue_charges_for_tenant`, que a envolve e faz as duas coisas na mesma
transação. As duas — e `fn_run_billing_emission` — estavam com `EXECUTE` para
`anon` e `authenticated`.

O caminho de produção sempre usou a de fora, então **nunca houve dado errado**.
Mas qualquer sessão com a chave pública podia chamar a de dentro e emitir
cobrança que nunca chegaria ao DRE. Revogado: só `service_role`, e o disparo
manual já exige `CRON_SECRET`.

### O que a varredura cobre

`reconciliacao.spec.ts` roda com `service_role` sobre o banco **inteiro**, não
sobre o que ela cria: toda transação fecha em zero e tem ao menos duas pernas;
nenhuma cobrança, conta a pagar ou crédito sem lançamento; e a emissão que não
lança não é alcançável por usuário autenticado. Semeia um documento de cada tipo
pelo caminho de produção para não passar vazio em banco recém-resetado.

### Cinco fixtures que ela obrigou a corrigir

Sozinha, a varredura acusou 18 cobranças órfãs — todas de **teste**, nenhuma do
produto. Corrigi-las melhorou os testes:

- `emissao-cobrancas` e `reajuste-e-renovacao` chamavam `issue_due_charges`.
  Agora chamam `fn_issue_charges_for_tenant`, que é o que o `pg_cron` chama —
  passaram a exercitar emissão **e** lançamento, atomicamente.
- `billings-rentals` inseria cobrança direto na tabela em dois pontos. Agora usa
  `createCharge`. Isso revelou que o fixture antigo **escondia** a exigência de
  destino da caução no encerramento: sem lançamento, `deposit_balances` era zero
  e a seção nem aparecia.
- `ledger-invariants` cria documento cru de propósito (o alvo é a trigger de
  coerência do item). Item de cobrança é imutável, então não dá para apagar:
  fecha-se o razão ao final.
- `tenant-isolation-financeiro` semeava lançamento sem `charge_id`.

Uma asserção minha estava errada e passava por acidente: eu ligava payable ao
razão por `transactions.source_id`, quando o vínculo é `entries.payable_id` — a
origem da transação é o FATO (a manutenção, a multa), não o documento.

### Risco residual, declarado

No caminho do banco (`pg_cron`), documento e lançamento nascem na mesma
transação SQL. **No caminho do app não**: `createCharge` faz o INSERT e depois
chama `postTransaction` — duas chamadas separadas, porque o cliente JS não abre
transação multi-statement. Se o processo morrer entre as duas, sobra órfão. O
código devolve erro ao operador quando a segunda falha; contra queda de processo
não há proteção, e a varredura é o detector.

**Suíte: 111 E2E e 603 unit, em banco recém-resetado.**

---

## 10.6 Auditoria da geração de cobranças (2026-08-15)

Varredura de todos os caminhos que geram cobrança e conta a pagar, atrás de
padronização, atomicidade, simetria de cancelamento e rastreabilidade.

### Padronização — duas portas, zero exceção

Nenhum INSERT cru em `charges` ou `payables` no app inteiro. Tudo passa por
`createCharge` ou `createPayable`; no banco, só `issue_due_charges`, envolvida
por `fn_issue_charges_for_tenant`.

**Uma assimetria achada:** só a multa da EMPRESA criava o payable. A multa do
CLIENTE creditava `repasse_multa` sem `despesa_multa` do outro lado — o DRE
mostrava LUCRO no valor da multa. Recuperação sem custo contradiz o nome da
conta e divergia de manutenção e despesa, que sempre lançam custo bruto e
repasse. O auto é lavrado contra o veículo: quem responde ao órgão é a
proprietária, e ser "do cliente" muda apenas que existe recuperação depois.
Decisão do Alan, registrada. A despesa passa a ser criada nos dois casos.

### Atomicidade — era o buraco estrutural

| Caminho | Antes | Agora |
|---|---|---|
| `fn_issue_charges_for_tenant` (job) | Atômico | Atômico |
| `createCharge` | **3 chamadas** ao PostgREST | `fn_create_charge` — uma transação |
| `createPayable` | **até 6 chamadas** | `fn_create_payable` — uma transação |

Cada chamada era a sua própria transação. Queda de processo entre duas deixava
documento sem lançamento — o único estado que o modelo não consegue proibir por
trigger, porque o documento é legítimo no instante anterior ao lançamento
existir. No rateio era pior: a empresa registrava o custo e nunca cobrava o
cliente.

As duas viraram funções SQL. Os wrappers TS mantiveram a assinatura, então os
doze chamadores não mudaram. Um efeito colateral bem-vindo: a emissão passou a
abrir **uma** transação com um débito e um crédito por natureza, em vez de uma
transação por conta creditada — um documento emitido é um fato.

`cancelamento-e-rateio.spec.ts` prova por falha injetada: conta inexistente no
item e cliente inexistente no rateio. Nada sobra em nenhuma das duas tabelas.

### Cancelamento — a simetria estava quebrada de um lado

`cancelExpenseAction` marcava `payables.status` e ia embora. O lançamento de
`payable_created` ficava: custo eterno no DRE e passivo inexistente. No rateio,
a cobrança do cliente sobrevivia — cobrando por um custo que a empresa acabara
de negar.

Novo evento `payable_cancelled` e `cancelPayable`, que estorna o razão E cancela
o repasse. Se o cliente já pagou o repasse, o cancelamento é recusado inteiro.

### Rateio — já estava sólido

`splitResponsibility` trabalha em valores, nunca percentuais, e garante
`empresa + cliente = total` exato. O custo integral vira despesa da empresa e a
parte do cliente é recuperada em lançamento separado, nunca abatida por dentro —
é o que mantém custo bruto e repasse visíveis lado a lado.

### Rastreabilidade — faltava a visão por cliente

Todo lançamento carrega cliente, veículo, locação, cobrança e conta a pagar.
Havia `vehicle_financial_position` e `rental_financial_result`, mas nada por
cliente. `customer_financial_position` fecha isso, com a distinção que uma soma
ingênua erra:

- `attributed_cost` — custo BRUTO que passou pelo cliente. Num rateio é o valor
  cheio, porque o lançamento de custo carrega o cliente inteiro.
- `absorbed_cost` — bruto menos repasse. É este que responde "este cliente dá
  lucro?".

Somar `attributed_cost` entre clientes **não** dá o custo da empresa: despesa sem
cliente fica de fora e rateio aparece cheio em um só. Para o total existe o DRE.
Exposto na tela do cliente.

---

## 10.7 Teste ao vivo no navegador (2026-08-15)

Banco resetado, DRE em zero, telas percorridas como operador. **Dois defeitos
que a suíte inteira não pegava**, ambos no fluxo que eu acabara de auditar.

### Cancelar despesa avulsa não cancelava a cobrança do cliente

`cancelPayable` procurava a cobrança de repasse por `source_id` do payable,
guardado por `if (p.source_id)`. Mas despesa lançada pela tela **não tem
origem** — e `fn_create_payable` dá à cobrança `COALESCE(source_id, id)`, ou
seja, o id do próprio payable. A guarda pulava a busca justamente no caso mais
comum.

Meu teste passava porque injetava `sourceId`. O caminho real não injeta. O
sintoma no DRE ficou visível na tela: **R$ 99 de "Recuperação de despesas" com
R$ 0 de custo** — lucro fantasma de uma despesa cancelada. O spec passou a
omitir `sourceId`, como a tela faz.

### O rateio pedia percentual, e 1/3 era inalcançável

A tela pedia "Percentual do cliente (%)", inteiro de 1 a 99, e derivava o valor.
O modelo guardava valor — o Princípio 7 estava respeitado onde importa —, mas a
ENTRADA não conseguia expressar o exemplo que motivou o princípio: 33% de R$ 300
dá R$ 99, e nenhum inteiro dá R$ 100. O operador não conseguia dizer "o cliente
paga cem reais", que é a frase que ele tem na cabeça.

Virou "Parte do cliente (R$)", com prévia da divisão em reais. Confirmado ao
vivo: R$ 300 com R$ 100 do cliente → **empresa R$ 200, cliente R$ 100**, exato.

A lição repete a de §10.2, agora sobre a própria correção do dia: um teste que
monta o cenário com dados que a tela não produz valida um caminho que não
existe.

---

## 10.8 Segunda passada no navegador (2026-08-15)

Ciclo completo com banco zerado: locação com caução e entrada, emissão pelo job,
multa do cliente, DRE e resultado por cliente. **Três defeitos**, os três de
comunicação ou de dimensão — nenhum de valor errado no razão.

### O preview da locação mentia em dois lugares ao mesmo tempo

A lista dizia "5 cobranças · R$ 2.100,00" e o botão, na mesma tela, dizia
"Confirmar — 4 cobranças". O botão contava `previewCharges` (só os ciclos); o
cabeçalho somava os extras.

Pior: a **caução não tinha linha de preview**. O resumo exibia "Caução R$
800,00" e a lista abaixo a ignorava, inclusive no total. Quem confirmava via
R$ 2.100 e criava R$ 2.900 em documentos. Agora as garantias entram na mesma
lista, e o botão usa a mesma contagem: "6 cobranças · R$ 2.900,00".

### O custo da multa não tinha dono

`customer_financial_position`, criada horas antes, mostrou Ana Silva com
**resultado R$ 1.367,66 e custo absorvido −R$ 293,47** — a multa aparecia como
lucro dela.

A causa: `syncFineBilling` criava o payable sem `customerId`. O repasse levava a
dimensão do cliente, a despesa não. É o mesmo erro que a multa tinha no DRE
(§10.6), um nível abaixo: recuperação sem o custo do lado. O cliente entra agora
como dimensão, com `responsibility` seguindo `'company'` — não é rateio, e
nenhuma cobrança nasce daí.

Comparação ao vivo, mesma receita nos dois: Ana (antes) R$ 1.367,66; Bruno
(depois) R$ 1.074,19, com custo absorvido zero.

### O que estava certo

Cronograma pro rata por período (174,19 + 600 + 600 + 425,81 = 1.800 exatos);
emissão pelo início do período, não pelo vencimento; caução creditando passivo e
ficando fora da receita; DRE somando 2.148,38 sem a caução; multa com despesa e
repasse se anulando. O padrão "já foi paga" da caução e da entrada é deliberado,
com caixa visível e marcada — não é defeito.

**Suíte: 117 E2E e 603 unit.**

---

## 10.9 Terceira passada: pagamento, encargo e manutenção (2026-08-15)

### O aviso de consolidar encargo dizia o OPOSTO da ação

"Os encargos desta cobrança serão **zerados**. Essa ação é irreversível" —
herança do "Dispensar encargos" que existia antes da ADR 0024. Consolidar chama
`realizeLateCharge`: transforma o encargo do relógio em recebível. Quem lesse o
aviso clicaria para perdoar e acabaria cobrando o cliente.

O estado interno ainda se chamava `waiveOpen`/`handleWaive` — o nome mantinha a
leitura errada viva no código.

### O custo da manutenção "Já executada" era descartado

Dois caminhos levam a uma manutenção concluída, e só um lançava:

| Caminho | Custo |
|---|---|
| Agendar → "Registrar conclusão" | `registerMaintenanceCost` → payable ✓ |
| Nova Manutenção → **"Já executada"** | digitado e **descartado** ✗ |

`maintenances.cost` saiu na ADR 0024, o payload não o carrega, e o modo
executado não chamava nada no lugar. O campo "Custo (R$)" era decorativo.
Comprovado ao vivo: R$ 450 lançados na primeira tentativa não produziram
payable nenhum; depois da correção, `despesa_manutencao` recebeu os R$ 450 e o
resultado do veículo passou a fechar (1.074,19 − 645,23 + 195,23 = 624,19).

### O que estava certo

Pagamento parcial com encargo **recalculado sobre o saldo remanescente** (multa
1,48 e juros 0,12 sobre R$ 74,19, não sobre o valor original); consolidação
lançando `late_charge_realized` e elevando o total de 174,19 para 175,79; a
listagem separando principal e encargo (R$ 174,19 + R$ 3,77).

**Suíte: 118 E2E e 603 unit.**

### "Custo do Mês" da manutenção estava morto

O KPI somava `m.cost` — coluna removida na ADR 0024. Ficava em **R$ 0,00 para
sempre**, mesmo com "Concluídas mês: 2" logo ao lado. Passou a somar os payables
de origem `maintenance` pela COMPETÊNCIA (quando o serviço foi feito, não quando
a conta vence).

### Crédito ao cliente: mais um caso de regra sem chamador

`createCustomerCredit` existe, foi corrigida hoje para lançar no razão, e **não
tem botão**. Dá para APLICAR crédito (a cobrança tem a ação) mas não para
CONCEDER: a origem `manual_adjustment` é inalcançável, e crédito só nasce por
`createPayable` com `reimbursement: 'credit'`.

Terceira ocorrência do padrão, depois do P-8 e da trava de inadimplência.
Registrado como **P-12** — onde fica o botão e quem pode usar é decisão de
produto.

### Encerramento com caução: correto

Retenção parcial de R$ 300 sobre saldo de R$ 800: `deposit_retained` debitou
`caucoes_a_devolver` e creditou `contas_a_receber`; `deposit_returned` devolveu
R$ 500 do caixa. Passivo zerado, locação fechada. A tela avisa da multa
contratual, das cobranças que sobrevivem e das que serão canceladas.

---

## 11. Aprovação

Aprovada em 2026-08-12 por Alan. Modalidade de execução: substituição total (big-bang), decisão registrada com o risco aceito na ADR 0024.
