---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-07-19
prd: "[[PRDs/0008-modulo-financeiro]]"
adr:
  - "[[decisions/0013-revisao-modelo-dados-financeiro]]"
  - "[[decisions/0014-estrategia-inadimplencia-trigger]]"
related:
  - "[[Arquitetura Proposta]]"
  - "[[Banco de Dados]]"
  - "[[Telas/Cobranças]]"
  - "[[Telas/Locações]]"
tags:
  - spec
  - modulo-financeiro
  - financeiro
  - caucao
  - encargos
  - inadimplencia
  - roi
modo: completo
---

# Spec 0008 — Módulo Financeiro

---

## 1. Visão Geral Técnica

### 1.1 Escopo técnico

Esta Spec implementa o módulo financeiro completo do GoMoto, cobrindo revisão do modelo de dados, novas regras de domínio, Server Actions, hooks de leitura e UI em duas plataformas (web e mobile). O sistema não está em produção — não há restrições de compatibilidade retroativa.

### 1.2 Camadas afetadas

| Camada | O que muda |
|---|---|
| **Banco de dados** | `billings` estendida; `incomes` removida; `payments` criada; `deposits`, `customer_credits`, `credit_applications`, `late_charges`, `rental_adjustments`, `delinquency_blocks` criadas; `vehicles` + `rentals` + `settings` + `customers` recebem novos campos |
| **`@gomoto/core`** | Novos schemas Zod + tipos + funções puras: cálculo de encargos, ROI, classificação de inadimplência, aplicação de crédito, resumo da locação |
| **`@gomoto/data`** | Novos hooks TanStack Query: painel financeiro, histórico do veículo, crédito do cliente, resumo da locação |
| **`apps/web`** | 3 telas novas (`/financeiro`, `/financeiro/veiculos/[id]`, `/locacoes/[id]/financeiro`); 7 telas modificadas; `actions.ts` para cada tela afetada |
| **`apps/mobile`** | Tela de detalhe de cobrança estendida com encargos (RF-047, RF-048) |

### 1.3 Decisões arquiteturais tomadas

| Decisão | Escolha | Justificativa |
|---|---|---|
| **Modelo de pagamento** | Tabela `payments` — `incomes` descontinuada | `incomes` é tabela livre sem FK; `payments` é o recibo rastreável vinculado a `billings`. Elimina o double-entry (RF-049). |
| **Cálculo de encargos** | On-the-fly em `@gomoto/core` — não persistido até o pagamento | Evita dado derivado redundante; captura o snapshot no momento da baixa via `late_charges` por cobrança. |
| **Persistência de encargo na baixa** | Tabela `late_charges` preenchida no momento do pagamento (ou dispensa) | Garante RNF-009: histórico reconstruível sem depender de recálculo externo. |
| **Inadimplência** | Coluna `delinquency_status` em `customers` + trigger em `billings` | Atende RNF-004 (≤60s); sem job externo; disparo em INSERT/UPDATE de status. |
| **Encargos na fórmula (QA-08)** | `total_due = (amount - discount) + late_fee + interest - credit_applied` — encargos sobre `(amount - discount)` | Crédito reduz o que o cliente paga, mas não compensa encargos já devidos; mais conservador e auditável. |
| **Configuração de encargos** | JSONB `late_charge_config` embutido em `billings` (snapshot) + linha na `settings` (padrão global) | Satisfaz RN-013: taxas fixadas por cobrança, independentes de mudança posterior no padrão. |

### 1.4 ADRs a criar (antes da implementação)

| ADR | Título sugerido | Decisão já tomada |
|---|---|---|
| `0013-revisao-modelo-dados-financeiro.md` | Substituição de `incomes` por `payments` e reestruturação de `billings` | Sim |
| `0014-estrategia-inadimplencia-trigger.md` | Coluna materializada + trigger vs. view vs. pg_cron | Sim — trigger em `billings` |

### 1.5 Premissas e restrições

- Nenhum dado financeiro de produção a migrar (sistema pré-lançamento).
- Pagamento sempre quita 100% da cobrança em V1 (QA-01 — sem pagamento parcial).
- Crédito não expira em V1 (RN-023).
- Encargos dispensados são irreversíveis (RN-014).
- ROI de veículo requer `acquisition_value` cadastrado; campo adicionado à tabela `vehicles` nesta Spec.
- `purchase_date` já existe em `vehicles` desde o schema inicial; RF-041 acrescenta apenas `acquisition_value`.

---

## 2. Arquitetura

### 2.1 Diagrama de contexto

```
┌─────────────────────────────────────────────────────────────────┐
│                        GoMoto Monorepo                           │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │  apps/web    │    │  apps/mobile │    │  packages/core     │  │
│  │  (Next.js)   │    │  (Expo)      │    │  schemas Zod       │  │
│  │              │    │              │    │  tipos TS          │  │
│  │  Server      │    │  Supabase    │    │  regras puras      │  │
│  │  Actions     │    │  client      │    │  (sem I/O)         │  │
│  └──────┬───────┘    └──────┬───────┘    └────────────────────┘  │
│         │                   │                      ▲              │
│         └──────────┬────────┘                      │              │
│                    ▼                     ┌──────────────────────┐ │
│             ┌────────────┐               │  packages/data       │ │
│             │  Supabase  │◄──────────────│  TanStack hooks      │ │
│             │  Postgres  │               │  repositórios        │ │
│             │  Auth      │               └──────────────────────┘ │
│             └────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Componentes do módulo financeiro

#### `@gomoto/core` — Regras e schemas

| Arquivo | Responsabilidade |
|---|---|
| `schemas/financial.ts` | Schemas Zod base: `CreatePaymentSchema`, `CreateDepositSchema`, `CloseDepositSchema`, `CreateCreditSchema`, `ApplyCreditSchema`, `CreateRentalAdjustmentSchema`, `WaiveChargesSchema`, `LateChargeConfigSchema`, `FinancialSettingsSchema`, `DelinquencySettingsSchema`, `RegisterVehicleSaleSchema` |
| `types/financial.ts` | Tipos TS derivados dos schemas + tipos de leitura |
| `rules/charges.ts` | `calculateLateCharges(config, amount, discount, dueDate, now)` → `{ fee, interest, total, gracePeriodActive }` |
| `rules/roi.ts` | `calculateVehicleROI(acquisitionValue, revenues, costs, saleValue?)` → `{ netResult, roi }` |
| `rules/delinquency.ts` | `classifyDelinquency(overdueBillings, thresholds)` → `DelinquencyLevel` |
| `rules/credit.ts` | `validateCreditApplication(creditBalance, billingAmountDue, requested)` → `ValidationResult` |

#### `@gomoto/data` — Hooks de leitura

| Hook | Rota consumidora |
|---|---|
| `useFinancialDashboard(tenantId, month)` | `/financeiro` |
| `useVehicleFinancialHistory(vehicleId)` | `/financeiro/veiculos/[id]` |
| `useRentalFinancialSummary(rentalId)` | `/locacoes/[id]/financeiro` |
| `useCustomerCredits(customerId)` | `/clientes/[id]` |
| `useDepositHistory(rentalId)` | `/locacoes/[id]/financeiro` |
| `useBillingDetail(billingId)` | `/cobrancas/[id]`, mobile |

#### `apps/web` — Server Actions por rota

| `actions.ts` | Actions adicionadas |
|---|---|
| `/locacoes/` | `createRentalWithDeposit`, `closeRentalFinancial`, `adjustRental` |
| `/cobrancas/[id]` | `registerPayment`, `waiveCharges`, `applyCredit` |
| `/clientes/[id]` | `createCustomerCredit`, `blockCustomer`, `unblockCustomer` |
| `/manutencao/[id]` | `confirmMaintenanceBilling` |
| `/multas/[id]` | `confirmFineBilling` |
| `/despesas/[id]` | `confirmExpenseBilling` |
| `/financeiro/veiculos/[id]` | `registerVehicleSale` |
| `/configuracoes/` | `saveFinancialSettings`, `saveDelinquencySettings` |

#### `apps/mobile` — Extensão

`BillingDetailScreen` estendida: exibe `amount_base`, `late_fee`, `interest`, `total_due` em destaque; oculta encargos se `charges_waived = true`.

#### Triggers de banco

| Trigger | Tabela | Evento | Efeito |
|---|---|---|---|
| `trg_billings_delinquency` | `billings` | INSERT / UPDATE de `status` | Recalcula `customers.delinquency_status` |
| `trg_billings_auto_credit` | `billings` | INSERT | Aplica crédito automático se configurado |

---

## 3. Fluxos Técnicos

> **Eventos assíncronos:** feature inteiramente síncrona em V1 — sem workers, queues ou webhooks.

### FT-01 — Configuração global de encargos e inadimplência (PRD F1, F12-setup)

```
Operador submete form
  → POST Server Action saveFinancialSettings / saveDelinquencySettings
      → getCurrentTenantId(supabase)
      → Zod: FinancialSettingsSchema / DelinquencySettingsSchema
      → UPSERT settings WHERE key IN ('late_charge_defaults', 'delinquency_thresholds', 'auto_apply_credit')
      → logAction('update_settings', ...)
      → revalidatePath('/configuracoes')
      → { ok: true }
```

### FT-02 — Criação de locação com caução e encargos (PRD F2)

```
Operador submete formulário de nova locação
  → POST Server Action createRentalWithDeposit
      → getCurrentTenantId(supabase)
      → Zod: CreateRentalWithDepositSchema
      → Valida: customer.delinquency_status ≠ 'blocked'
      → BEGIN TRANSACTION
          INSERT rentals (..., late_charge_config JSONB)
          IF deposit_amount IS NOT NULL:
            INSERT deposits (rental_id, tenant_id, customer_id, amount, balance, status='received', received_at)
          INSERT billings[] via create_rental_with_charges RPC (extendida p/ late_charge_config)
      → COMMIT
      → logAction x2
      → revalidatePath('/locacoes')
      → { ok: true, data: { rentalId } }
```

> ✅ **Implementado em 2026-07-26, com redesenho em relação ao pseudocódigo
> acima.** A action real é `createRental` (`createRentalWithDeposit` nunca foi
> ligada a nenhuma tela — permanece morta). A mudança de fundo: caução deixou
> de ser só bookkeeping em `deposits` e passa a gerar uma cobrança de verdade
> (`billings.billing_type = 'deposit'`, `source = 'deposit'`), paga ou pendente
> conforme o operador indica na criação (checkbox "Caução já foi paga",
> marcado por padrão — preserva o comportamento de quem recebe em dinheiro na
> assinatura):
> - Marcado → cobrança nasce `paid`, `deposits.status = 'received'`, saldo
>   disponível imediatamente (equivalente ao fluxo antigo).
> - Desmarcado → cobrança nasce `pending`; o pagamento dela pelo fluxo normal
>   de `/cobrancas/[id]` (`registerPayment`) é o gatilho que libera o saldo
>   (`deposits.status → 'received'`, `balance = amount`, `received_at = paid_at`).
>
> `deposit_status` ganhou o valor `'pending'`; `deposits.billing_id` referencia
> a cobrança que originou a caução; `deposits.received_at` deixou de ser
> `NOT NULL` (fica `null` enquanto pendente). RPC `create_rental_with_charges`
> ganhou `p_deposit_paid BOOLEAN DEFAULT true` (migration
> `20260726005100_deposit_billing.sql`) — exigiu `DROP FUNCTION` explícito da
> assinatura anterior antes do `CREATE OR REPLACE` (mesma armadilha de
> sobrecarga já documentada na migration de reajuste).
>
> Editar o valor de uma caução ainda pendente atualiza a cobrança vinculada
> junto (`updateRental`); editar uma já paga só ajusta `deposits` — a cobrança
> paga permanece imutável (RNF-007). Destino da caução ao encerrar a locação
> (`closeRentalFinancial`) continua fora do escopo desta leva — gap
> pré-existente, não coberto por esta mudança.
>
> **Ajuste em 2026-07-26:** o formulário de criação passou a pedir a data
> certa conforme o estado do checkbox, em vez de assumir `now()`/`start_date`
> — marcado → "Data do pagamento" (default hoje); desmarcado → "Data de
> vencimento" (default `start_date`). Migration `20260726021857_deposit_dates.sql`
> adicionou `p_deposit_payment_date`/`p_deposit_due_date` (ambos `DATE
> DEFAULT NULL`) a `create_rental_with_charges` — mesmo padrão de `DROP
> FUNCTION` explícito antes do `CREATE OR REPLACE` para não duplicar
> sobrecarga. Quando paga, `due_date` da cobrança passa a ser a própria data
> do pagamento (não faz sentido uma cobrança já quitada vencer no futuro).
>
> **Decisão confirmada com o usuário:** os totais agregados de faturamento
> (painel `/financeiro`, ROI por veículo em `/financeiro/veiculos/[id]`, e os
> KPIs do `/dashboard` — total a receber, em atraso, recebido no mês,
> inadimplência) passaram a **excluir** `billing_type = 'deposit'` (via
> `.neq('billing_type', 'deposit')` nas queries, ou `.neq('source', 'deposit')`
> onde só `source` estava selecionado). Caução é garantia/depósito, não
> receita operacional — antes não existia esse risco porque caução nunca
> gerava `billing`. **`/cobrancas` (lista operacional de cobranças) foi
> deixado de fora de propósito**: lá o objetivo é gerenciar qualquer cobrança
> pendente de ação, caução incluída, então ela deve continuar aparecendo nos
> totais dessa tela.
>
> **Bug pré-existente encontrado e corrigido de passagem:** as duas queries de
> `/financeiro/page.tsx` tentavam `vehicle:vehicles(id,license_plate)`
> diretamente a partir de `billings` — mas `billings` não tem `vehicle_id`,
> só `lease_id → rentals.vehicle_id`. Isso fazia PostgREST retornar erro
> (`PGRST200`, relacionamento inexistente) silenciosamente engolido por
> `?? []`, então **a seção "Cobranças do mês" do painel financeiro sempre
> mostrou zero**, para qualquer tenant, desde que o módulo foi construído —
> não tinha relação com caução, só foi descoberto ao verificar o filtro acima.
> Corrigido trocando o embed para `rental:rentals(vehicle:vehicles(...))`.

### FT-03 — Ciclo de vida de cobrança (PRD F5)

**3a — Exibição de encargos (leitura):**
```
useBillingDetail(billingId)
  → SELECT billing + late_charge_config + charges_waived + credit_applications
  → Se status = 'overdue' AND charges_waived = false:
      calculateLateCharges(config, amount - discount, due_date, now())
  → Retorna: { billing, charges: { fee, interest, total }, amount_due }
```

**3b — Registro de pagamento:**
```
  → POST Server Action registerPayment
      → Zod: CreatePaymentSchema
      → BEGIN TRANSACTION
          Se status = 'overdue' e charges não dispensados:
            INSERT late_charges (billing_id, fee, interest, days_overdue, snapshot_config, captured_at)
          INSERT payments (billing_id, tenant_id, customer_id, amount, payment_method, paid_at)
          UPDATE billings SET status = 'paid', payment_date = paid_at
      → COMMIT
      → trigger trg_billings_delinquency dispara
      → logAction + revalidatePath
```

**3c — Dispensa de encargos:**
```
  → POST Server Action waiveCharges
      → Zod: WaiveChargesSchema
      → UPDATE billings SET charges_waived = true, waiver_reason, waiver_by, waiver_at
      → logAction + revalidatePath
```

### FT-04 — Geração automática de cobrança (PRD F4)

```
Operador confirma ConfirmAutoBillingPanel
  → POST Server Action confirmMaintenanceBilling (ou Fine / Expense)
      → Zod: ConfirmAutoBillingSchema
      → Busca locação ativa do veículo SE rental_id não informado
          Se não encontrada → { ok: false, error: { code: 'NO_ACTIVE_RENTAL' } }
      → INSERT billings (source, source_id, late_charge_config, ...)
      → UPDATE maintenances/fines/expenses SET billing_id = novo id
      → logAction + revalidatePath

Ao recusar:
  → logAction('billing_creation_refused') + { ok: true }
```

`source` enum: `'rental_cycle' | 'maintenance' | 'fine' | 'expense' | 'manual'`

### FT-05 — Encerramento financeiro de locação com caução (PRD F3)

```
  → POST Server Action closeRentalFinancial
      → Zod: CloseRentalFinancialSchema (discriminatedUnion)
      → Valida: returned_amount ≤ deposit.balance; retention exige motivo
      → BEGIN TRANSACTION
          UPDATE rentals SET status = 'closed'
          UPDATE deposits SET status = deposit_action, closed_at = now()
          Se partial_return:
            INSERT deposit_movements x2 (return + retention)
          Se saldo retido < cobranças pendentes:
            Retorna aviso sem bloquear
      → COMMIT
      → logAction x2 + revalidatePath
      → { ok: true, data: { complementary_billing_needed, shortfall_amount } }
```

### FT-06 — Crédito do cliente (PRD F6)

**6a — Criar:** `createCustomerCredit` → INSERT `customer_credits`

**6b — Aplicar manualmente:** `applyCredit` → `validateCreditApplication` (core) → INSERT `credit_applications` + UPDATE `customer_credits.available_balance` + UPDATE `billings.credit_applied`

**6c — Aplicação automática:** trigger `trg_billings_auto_credit` após INSERT em `billings`

### FT-07 — Reajuste de locação (PRD F11)

```
  → POST Server Action adjustRental
      → Zod: CreateRentalAdjustmentSchema
      → Valida: rental.status = 'active'
      → BEGIN TRANSACTION
          SELECT billings WHERE status = 'pending' FOR UPDATE
          INSERT rental_adjustments (previous_amount, new_amount, previous_config, new_config, justification, ...)
          UPDATE billings SET amount = new_amount, late_charge_config = new_config WHERE status = 'pending'
          UPDATE rentals SET cycle_amount, late_charge_config
      → COMMIT
      → logAction + revalidatePath
      → { ok: true, data: { updated_billings_count } }
```

> ✅ **Implementado em 2026-07-24.** Diferença em relação ao pseudocódigo acima: a
> atomicidade (RNF-006) é garantida por uma RPC PostgreSQL `adjust_rental`
> (migration `20260724232232_adjust_rental_rpc.sql`), não uma transação aberta
> direto no Server Action — mesmo padrão já usado por `renew_rental`/
> `create_rental_with_charges`. O TypeScript calcula os valores por cobrança
> (via `calculateAdjustedBillingAmount`, RN-027 — recálculo proporcional para
> pro rata) e a RPC só escreve atomicamente. Tela em `/locacoes/[id]/reajustar`
> (ver [[Telas/Locações]]). Ligado a isso, `renew_rental` também foi corrigido
> na mesma migration: cobranças de renovação agora saem com `source =
> 'rental_cycle'` em vez do default `'manual'`.

### FT-08 — Classificação automática de inadimplência (PRD F12-runtime)

```
Trigger trg_billings_delinquency — AFTER INSERT OR UPDATE OF status ON billings:
  → Para o customer_id afetado:
      Não sobrescreve status 'blocked' (bloqueio manual)
      SELECT overdue billings + max dias de atraso
      classifyDelinquency(data, tenant_thresholds) → status
      UPDATE customers SET delinquency_status = novo_status

blockCustomer / unblockCustomer:
  → INSERT delinquency_blocks + UPDATE customers.delinquency_status
```

### FT-09 — Painéis de leitura (PRD F7, F8, F9)

Hooks executam queries agregadas via Supabase client em `@gomoto/data`. Todas com índices compostos. Para painel financeiro: `Promise.all` de 5 queries independentes (§8.1). Para ROI: 2 queries agregadas → `calculateVehicleROI` em `@gomoto/core`.

### FT-10 — Mobile: detalhe de cobrança com encargos (PRD F10)

```
BillingDetailScreen:
  → SELECT billing (RLS: customer_read_own_billings)
  → Se charges_waived = false E status = 'overdue':
      calculateLateCharges(config, amount - discount, due_date, now())
      Exibe: valor base / multa / juros / total em destaque
  → Se charges_waived = true: exibe apenas valor base (RF-048)
```

### Fluxos de erro

| Situação | Código | Tratamento |
|---|---|---|
| Fechar locação sem destino da caução | `VALIDATION_ERROR` | Frontend bloqueia; action valida novamente |
| Crédito > saldo disponível | `CONFLICT` | `validateCreditApplication` retorna erro |
| Reajuste com locação não-ativa | `FORBIDDEN` | Validação na action |
| Cobrança automática sem locação ativa | `NO_ACTIVE_RENTAL` | Frontend exibe seletor de locação |
| Falha em transação atômica | `INTERNAL` | Rollback total; nenhum registro parcial |
| Locação para cliente bloqueado | `FORBIDDEN` | Guard em `createRentalWithDeposit` |

---

## 4. Modelo de Dados

### 4.1 Visão geral das mudanças

| Operação | Tabela / Tipo |
|---|---|
| **Criar ENUMs** | `payment_method_type`, `billing_source`, `late_fee_type`, `deposit_status`, `deposit_movement_type`, `credit_origin`, `delinquency_level`, `block_action` |
| **Criar tabelas** | `payments`, `deposits`, `deposit_movements`, `customer_credits`, `credit_applications`, `late_charges`, `rental_adjustments`, `delinquency_blocks` |
| **Alterar** | `billings` (+7 colunas), `rentals` (+1 coluna, −2 colunas), `vehicles` (+3 colunas), `customers` (+1 coluna) |
| **Remover** | `incomes` |

### 4.2 ENUMs

```sql
CREATE TYPE late_fee_type         AS ENUM ('fixed', 'percentage');
CREATE TYPE billing_source        AS ENUM ('rental_cycle', 'maintenance', 'fine', 'expense', 'manual');
CREATE TYPE deposit_status        AS ENUM ('received', 'fully_returned', 'partially_returned', 'fully_retained');
CREATE TYPE deposit_movement_type AS ENUM ('return', 'retention');
CREATE TYPE credit_origin         AS ENUM ('maintenance_refund', 'reversal', 'manual_adjustment');
CREATE TYPE delinquency_level     AS ENUM ('current', 'late', 'delinquent', 'blocked');
CREATE TYPE payment_method_type   AS ENUM ('pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other');
CREATE TYPE block_action          AS ENUM ('block', 'unblock');
```

### 4.3 DDL — tabelas novas

#### `payments`

```sql
CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id     UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method_type NOT NULL,
  paid_at        TIMESTAMPTZ NOT NULL,
  received_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_billing_id_unique UNIQUE (billing_id)
);
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_payments" ON payments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_payments_tenant_billing ON payments(tenant_id, billing_id);
CREATE INDEX idx_payments_tenant_paid_at ON payments(tenant_id, paid_at);
```

#### `deposits`

```sql
CREATE TABLE deposits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id     UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  balance       NUMERIC(10,2) NOT NULL CHECK (balance >= 0),
  status        deposit_status NOT NULL DEFAULT 'received',
  received_at   DATE NOT NULL,
  closed_at     DATE,
  registered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposits_balance_lte_amount CHECK (balance <= amount)
);
CREATE TRIGGER update_deposits_updated_at
  BEFORE UPDATE ON deposits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_deposits" ON deposits
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_deposits_tenant_rental ON deposits(tenant_id, rental_id);
-- Uma locação tem no máximo uma caução ativa (RN-003)
CREATE UNIQUE INDEX idx_deposits_rental_unique ON deposits(rental_id) WHERE status = 'received';
```

#### `deposit_movements`

```sql
CREATE TABLE deposit_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deposit_id    UUID NOT NULL REFERENCES deposits(id) ON DELETE RESTRICT,
  type          deposit_movement_type NOT NULL,
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  reason        TEXT,
  movement_date DATE NOT NULL,
  registered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_deposit_movements_updated_at
  BEFORE UPDATE ON deposit_movements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE deposit_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_deposit_movements" ON deposit_movements
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_deposit_movements_deposit ON deposit_movements(deposit_id);
```

#### `customer_credits`

```sql
CREATE TABLE customer_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  available_balance NUMERIC(10,2) NOT NULL CHECK (available_balance >= 0),
  origin            credit_origin NOT NULL,
  reason            TEXT NOT NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_customer_credits_updated_at
  BEFORE UPDATE ON customer_credits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_customer_credits" ON customer_credits
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_customer_credits_tenant_customer ON customer_credits(tenant_id, customer_id);
CREATE INDEX idx_customer_credits_balance ON customer_credits(tenant_id, customer_id) WHERE available_balance > 0;
```

#### `credit_applications`

```sql
CREATE TABLE credit_applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credit_id   UUID NOT NULL REFERENCES customer_credits(id) ON DELETE RESTRICT,
  billing_id  UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_auto     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_credit_applications_updated_at
  BEFORE UPDATE ON credit_applications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_credit_applications" ON credit_applications
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_credit_applications_credit  ON credit_applications(credit_id);
CREATE INDEX idx_credit_applications_billing ON credit_applications(billing_id);
```

#### `late_charges`

```sql
CREATE TABLE late_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id      UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  fee_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  days_overdue    INTEGER NOT NULL,
  snapshot_config JSONB NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT late_charges_billing_unique UNIQUE (billing_id)
);
CREATE TRIGGER update_late_charges_updated_at
  BEFORE UPDATE ON late_charges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE late_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_late_charges" ON late_charges
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_late_charges_billing ON late_charges(billing_id);
```

#### `rental_adjustments`

```sql
CREATE TABLE rental_adjustments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id             UUID NOT NULL REFERENCES rentals(id) ON DELETE RESTRICT,
  previous_cycle_amount NUMERIC(10,2) NOT NULL,
  new_cycle_amount      NUMERIC(10,2) NOT NULL,
  previous_config       JSONB,
  new_config            JSONB,
  updated_billings_count INTEGER NOT NULL DEFAULT 0,
  justification         TEXT NOT NULL,
  adjusted_by           UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  adjusted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_rental_adjustments_updated_at
  BEFORE UPDATE ON rental_adjustments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE rental_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_rental_adjustments" ON rental_adjustments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_rental_adjustments_rental ON rental_adjustments(rental_id);
```

#### `delinquency_blocks`

```sql
CREATE TABLE delinquency_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  action      block_action NOT NULL,
  reason      TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_delinquency_blocks_updated_at
  BEFORE UPDATE ON delinquency_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE delinquency_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_delinquency_blocks" ON delinquency_blocks
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE INDEX idx_delinquency_blocks_customer ON delinquency_blocks(tenant_id, customer_id);
```

### 4.4 DDL — tabelas modificadas

#### `billings` — novos campos

```sql
ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS source             billing_source NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS maintenance_id     UUID REFERENCES maintenances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS late_charge_config JSONB,
  ADD COLUMN IF NOT EXISTS credit_applied     NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_waived     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_reason      TEXT,
  ADD COLUMN IF NOT EXISTS waiver_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waiver_at          TIMESTAMPTZ;

-- Migrar payment_method para enum (pré-produção: sem dado histórico)
ALTER TABLE billings DROP CONSTRAINT IF EXISTS billings_payment_method_check;
ALTER TABLE billings ALTER COLUMN payment_method TYPE payment_method_type
  USING payment_method::payment_method_type;

CREATE INDEX IF NOT EXISTS idx_billings_tenant_customer_status
  ON billings(tenant_id, customer_id, status);
```

#### `rentals` — late_charge_config + remoção de security_deposit

```sql
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS late_charge_config JSONB;

-- Backfill: converter security_deposit existente em deposits
INSERT INTO deposits (tenant_id, rental_id, customer_id, amount, balance, status, received_at)
SELECT r.tenant_id, r.id, r.customer_id,
       r.security_deposit,
       CASE WHEN r.security_deposit_returned_at IS NOT NULL THEN 0 ELSE r.security_deposit END,
       CASE WHEN r.security_deposit_returned_at IS NOT NULL
            THEN 'fully_returned'::deposit_status ELSE 'received'::deposit_status END,
       r.start_date
FROM rentals r WHERE r.security_deposit IS NOT NULL;

ALTER TABLE rentals
  DROP COLUMN IF EXISTS security_deposit,
  DROP COLUMN IF EXISTS security_deposit_returned_at;
```

#### `vehicles` — aquisição e alienação (RF-041, RF-043)

```sql
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS acquisition_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sold_at           DATE,
  ADD COLUMN IF NOT EXISTS sale_value        NUMERIC(10,2);
```

#### `customers` — status de inadimplência (RF-033)

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS delinquency_status delinquency_level NOT NULL DEFAULT 'current';

CREATE INDEX IF NOT EXISTS idx_customers_tenant_delinquency
  ON customers(tenant_id, delinquency_status);
```

#### `incomes` — descontinuação

```sql
DROP TABLE IF EXISTS incomes;
```

### 4.5 Triggers de negócio

#### `trg_billings_delinquency`

```sql
CREATE OR REPLACE FUNCTION fn_recalculate_delinquency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id UUID := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_customer_id UUID := COALESCE(NEW.customer_id, OLD.customer_id);
  v_thresholds JSONB;
  v_overdue_count INTEGER;
  v_max_days_overdue INTEGER;
  v_new_status delinquency_level;
BEGIN
  IF (SELECT delinquency_status FROM customers WHERE id = v_customer_id) = 'blocked' THEN
    RETURN NEW;
  END IF;
  SELECT value INTO v_thresholds FROM settings
    WHERE tenant_id = v_tenant_id AND key = 'delinquency_thresholds';
  SELECT COUNT(*), COALESCE(MAX(CURRENT_DATE - due_date), 0)
    INTO v_overdue_count, v_max_days_overdue
    FROM billings
   WHERE tenant_id = v_tenant_id AND customer_id = v_customer_id AND status = 'overdue';
  v_new_status := 'current';
  IF v_overdue_count > 0 THEN
    v_new_status := 'late';
    IF v_overdue_count >= COALESCE((v_thresholds->>'delinquent_count')::int, 3)
    OR v_max_days_overdue >= COALESCE((v_thresholds->>'delinquent_days')::int, 30) THEN
      v_new_status := 'delinquent';
    END IF;
    IF (v_thresholds->>'auto_block')::boolean = true
       AND (v_overdue_count >= COALESCE((v_thresholds->>'blocked_count')::int, 5)
            OR v_max_days_overdue >= COALESCE((v_thresholds->>'blocked_days')::int, 60)) THEN
      v_new_status := 'blocked';
    END IF;
  END IF;
  UPDATE customers SET delinquency_status = v_new_status WHERE id = v_customer_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[financial-trigger] delinquency customer_id=% error=%', v_customer_id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billings_delinquency
  AFTER INSERT OR UPDATE OF status ON billings
  FOR EACH ROW EXECUTE FUNCTION fn_recalculate_delinquency();
```

#### `trg_billings_auto_credit`

```sql
CREATE OR REPLACE FUNCTION fn_auto_apply_credit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_auto_apply BOOLEAN;
  v_credit     RECORD;
  v_apply_amt  NUMERIC(10,2);
BEGIN
  SELECT (value->>'enabled')::boolean INTO v_auto_apply
    FROM settings WHERE tenant_id = NEW.tenant_id AND key = 'auto_apply_credit';
  IF NOT COALESCE(v_auto_apply, false) THEN RETURN NEW; END IF;
  SELECT * INTO v_credit FROM customer_credits
   WHERE tenant_id = NEW.tenant_id AND customer_id = NEW.customer_id AND available_balance > 0
   ORDER BY created_at ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_apply_amt := LEAST(v_credit.available_balance, NEW.original_amount);
  INSERT INTO credit_applications (tenant_id, credit_id, billing_id, amount, applied_by, is_auto)
    VALUES (NEW.tenant_id, v_credit.id, NEW.id, v_apply_amt, NULL, true);
  UPDATE customer_credits SET available_balance = available_balance - v_apply_amt WHERE id = v_credit.id;
  UPDATE billings SET credit_applied = v_apply_amt WHERE id = NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[financial-trigger] auto_credit billing_id=% error=%', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billings_auto_credit
  AFTER INSERT ON billings
  FOR EACH ROW EXECUTE FUNCTION fn_auto_apply_credit();
```

### 4.6 `late_charge_config` — estrutura JSONB

```json
{
  "late_fee_type":       "fixed" | "percentage",
  "late_fee_value":      30.00,
  "daily_interest_rate": 0.005,
  "grace_period_days":   5
}
```

### 4.7 Plano de migrations (ordem obrigatória)

| # | Arquivo | Operação |
|---|---|---|
| 1 | `YYYYMMDD_create_financial_enums.sql` | 8 ENUMs |
| 2 | `YYYYMMDD_extend_customers_delinquency.sql` | ALTER customers |
| 3 | `YYYYMMDD_create_payments.sql` | CREATE payments |
| 4 | `YYYYMMDD_create_deposits.sql` | CREATE deposits + deposit_movements |
| 5 | `YYYYMMDD_create_customer_credits.sql` | CREATE customer_credits + credit_applications |
| 6 | `YYYYMMDD_create_late_charges.sql` | CREATE late_charges |
| 7 | `YYYYMMDD_create_rental_adjustments.sql` | CREATE rental_adjustments |
| 8 | `YYYYMMDD_create_delinquency_blocks.sql` | CREATE delinquency_blocks |
| 9 | `YYYYMMDD_extend_billings_financial.sql` | ALTER billings |
| 10 | `YYYYMMDD_extend_rentals_financial.sql` | ALTER rentals + backfill deposits + DROP colunas |
| 11 | `YYYYMMDD_extend_vehicles_financial.sql` | ALTER vehicles |
| 12 | `YYYYMMDD_create_financial_triggers.sql` | fn + triggers |
| 13 | `YYYYMMDD_drop_incomes.sql` | DROP TABLE incomes |

---

## 5. APIs

### 5.1 Schemas Zod — `packages/core/src/schemas/financial.ts`

```ts
export const LateChargeConfigSchema = z.object({
  late_fee_type:        z.enum(['fixed', 'percentage']),
  late_fee_value:       z.number().min(0),
  daily_interest_rate:  z.number().min(0).max(1),
  grace_period_days:    z.number().int().min(0),
});

export const FinancialSettingsSchema = z.object({
  late_charge_defaults: LateChargeConfigSchema,
  auto_apply_credit:    z.boolean().default(false),
});

export const DelinquencySettingsSchema = z.object({
  late_threshold_days:        z.number().int().min(1),
  late_threshold_count:       z.number().int().min(1),
  delinquent_threshold_days:  z.number().int().min(1),
  delinquent_threshold_count: z.number().int().min(1),
  blocked_threshold_days:     z.number().int().min(1),
  blocked_threshold_count:    z.number().int().min(1),
  auto_block:                 z.boolean().default(false),
});

export const CreateRentalWithDepositSchema = z.object({
  deposit_amount:      z.number().positive().optional(),
  deposit_received_at: z.string().date().optional(),
  late_charge_config:  LateChargeConfigSchema,
}).refine(
  (d) => !d.deposit_amount || !!d.deposit_received_at,
  { message: 'deposit_received_at obrigatório quando deposit_amount informado', path: ['deposit_received_at'] }
);

export const CloseRentalFinancialSchema = z.discriminatedUnion('deposit_action', [
  z.object({ rental_id: z.string().uuid(), deposit_action: z.literal('full_return'), return_date: z.string().date() }),
  z.object({ rental_id: z.string().uuid(), deposit_action: z.literal('partial_return'), returned_amount: z.number().positive(), retained_amount: z.number().positive(), retention_reason: z.string().min(5), return_date: z.string().date() }),
  z.object({ rental_id: z.string().uuid(), deposit_action: z.literal('full_retention'), retention_reason: z.string().min(5) }),
  z.object({ rental_id: z.string().uuid(), deposit_action: z.literal('none') }),
]);

export const CreateRentalAdjustmentSchema = z.object({
  rental_id:              z.string().uuid(),
  new_cycle_amount:       z.number().positive(),
  new_late_charge_config: LateChargeConfigSchema.optional(),
  justification:          z.string().min(5),
});

export const CreatePaymentSchema = z.object({
  billing_id:     z.string().uuid(),
  amount:         z.number().positive(),
  payment_method: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other']),
  paid_at:        z.string().datetime(),
  notes:          z.string().optional(),
});

export const WaiveChargesSchema = z.object({
  billing_id: z.string().uuid(),
  reason:     z.string().min(5),
});

export const CreateCreditSchema = z.object({
  customer_id: z.string().uuid(),
  amount:      z.number().positive(),
  origin:      z.enum(['maintenance_refund', 'reversal', 'manual_adjustment']),
  reason:      z.string().min(5),
});

export const ApplyCreditSchema = z.object({
  billing_id: z.string().uuid(),
  credit_id:  z.string().uuid(),
  amount:     z.number().positive(),
});

export const ConfirmAutoBillingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), source_id: z.string().uuid(), source_type: z.enum(['maintenance', 'fine', 'expense']), amount: z.number().positive(), due_date: z.string().date(), rental_id: z.string().uuid().optional(), late_charge_config: LateChargeConfigSchema }),
  z.object({ action: z.literal('refuse'), source_id: z.string().uuid(), source_type: z.enum(['maintenance', 'fine', 'expense']) }),
]);

export const BlockCustomerSchema = z.object({ customer_id: z.string().uuid(), reason: z.string().min(5) });
export const UnblockCustomerSchema = z.object({ customer_id: z.string().uuid(), justification: z.string().min(5) });
export const RegisterVehicleSaleSchema = z.object({ vehicle_id: z.string().uuid(), sale_value: z.number().positive(), sold_at: z.string().date() });
```

### 5.2 Tipos TS — `packages/core/src/types/financial.ts`

```ts
export type LateChargeConfig = z.infer<typeof LateChargeConfigSchema>;

export interface LateChargesCalculation {
  grace_period_active: boolean;
  fee: number; interest: number; total: number;
  days_since_due: number; days_overdue: number;
}

export interface BillingWithCharges {
  id: string; original_amount: number; discount_amount: number;
  credit_applied: number; charges_waived: boolean;
  late_charge_config: LateChargeConfig | null;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'prejudice';
  due_date: string;
  charges: LateChargesCalculation | null;
  amount_due: number;
}

export interface RentalFinancialSummary {
  rental_id: string; total_billed: number; total_received: number;
  pending_balance: number; accumulated_charges: number;
  deposit: { amount: number; balance: number; status: string } | null;
  credits_applied: number; adjustments: RentalAdjustment[];
}

export interface VehicleROI {
  vehicle_id: string; acquisition_value: number | null;
  revenues: number;
  costs_by_category: { maintenance: number; insurance: number; documentation: number; other: number };
  total_costs: number; sale_value: number | null;
  net_result: number | null; roi: number | null;
}

export interface FinancialDashboard {
  overdue_billings: OverdueBillingSummary[];
  month_receivable: number; month_received: number;
  month_revenue: number; month_expenses: number; month_result: number;
}
```

### 5.3 Server Actions — assinaturas

```ts
// /configuracoes/actions.ts
saveFinancialSettings(input: unknown): Promise<ActionResult<void>>
saveDelinquencySettings(input: unknown): Promise<ActionResult<void>>

// /locacoes/actions.ts
createRentalWithDeposit(input: unknown): Promise<ActionResult<{ rentalId: string }>>
closeRentalFinancial(input: unknown): Promise<ActionResult<{ complementary_billing_needed: boolean; shortfall_amount?: number }>>
adjustRental(input: unknown): Promise<ActionResult<{ updated_billings_count: number }>>

// /cobrancas/[id]/actions.ts
registerPayment(input: unknown): Promise<ActionResult<{ payment_id: string }>>
waiveCharges(input: unknown): Promise<ActionResult<void>>
applyCredit(input: unknown): Promise<ActionResult<{ new_amount_due: number }>>

// /manutencao/[id]/actions.ts  (idem para /multas e /despesas)
confirmMaintenanceBilling(input: unknown): Promise<ActionResult<{ confirmed: true; billing_id: string } | { confirmed: false } | { no_active_rental: true }>>

// /clientes/[id]/actions.ts
createCustomerCredit(input: unknown): Promise<ActionResult<{ credit_id: string }>>
blockCustomer(input: unknown): Promise<ActionResult<void>>
unblockCustomer(input: unknown): Promise<ActionResult<void>>

// /financeiro/veiculos/[id]/actions.ts
registerVehicleSale(input: unknown): Promise<ActionResult<void>>
```

### 5.4 Hooks — `packages/data/src/hooks/financial.ts`

```ts
useFinancialDashboard(month: string): UseQueryResult<FinancialDashboard>
useVehicleFinancialHistory(vehicleId: string): UseQueryResult<VehicleROI>
useRentalFinancialSummary(rentalId: string): UseQueryResult<RentalFinancialSummary>
useCustomerCredits(customerId: string): UseQueryResult<CustomerCredit[]>
useDepositHistory(rentalId: string): UseQueryResult<(Deposit & { movements: DepositMovement[] }) | null>
useBillingDetail(billingId: string): UseQueryResult<BillingWithCharges>
```

### 5.5 Tabela de erros

| Código | Condição | Ação no cliente |
|---|---|---|
| `VALIDATION_ERROR` | Zod parse falhou | Exibe campo inválido |
| `UNAUTHORIZED` | Sessão expirada | Redireciona para login |
| `FORBIDDEN` | Tenant/cliente bloqueado | Toast "Acesso negado" / alerta de bloqueio |
| `NOT_FOUND` | Recurso não encontrado | Toast + volta à listagem |
| `CONFLICT` | Billing já pago; crédito insuficiente | Toast com mensagem específica |
| `NO_ACTIVE_RENTAL` | Sem locação ativa para cobrança automática | Exibe seletor de locação |
| `INTERNAL` | Falha transacional | Toast "Erro interno, tente novamente" |

---

## 6. Segurança

### 6.1 Autenticação

Supabase Auth (JWT). Toda action verifica sessão + resolve `tenant_id` server-side via `getCurrentTenantId(supabase)` antes de qualquer operação.

### 6.2 Autorização

| Operação | Operador | Cliente mobile |
|---|---|---|
| Operações financeiras (pagamento, caução, crédito, reajuste, inadimplência, configuração, ROI) | ✅ | ❌ |
| Ver detalhe de cobrança com encargos | ✅ | ✅ (só suas cobranças — RLS `customer_read_own_billings`) |

Verificação de posse adicional em toda action: `.eq('tenant_id', tenantId)` além da RLS.

Bloqueio de locação para cliente inadimplente na action `createRentalWithDeposit`:
```ts
if (customer.delinquency_status === 'blocked')
  return { ok: false, error: { code: 'FORBIDDEN', message: 'Cliente bloqueado.', field: 'customer_id' } };
```

### 6.3 Auditoria (RNF-008)

`logAction` chamado após cada operação financeira bem-sucedida, com `old_data` e `new_data`. Operações cobertas: pagamento, dispensa de encargo, criação e aplicação de crédito, caução (criação e encerramento), reajuste, bloqueio/desbloqueio, alienação de veículo, cobrança automática (confirmação e recusa).

---

## 7. Observabilidade

### 7.1 Logs essenciais

Prefixo `[financial:<nome-da-action>]` em `console.error` para erros internos. Triggers PL/pgSQL com `RAISE WARNING` em bloco `EXCEPTION` — falha silenciosa não bloqueia operação principal.

Falhas críticas a logar: rollback de transação atômica, exceção nos triggers `fn_recalculate_delinquency` e `fn_auto_apply_credit`, falha ao resolver `tenant_id`.

> §7.2 Métricas/Alertas: N/A — sistema pré-produção.

---

## 8. Performance e Escalabilidade

### 8.1 RNF-001 — Painel financeiro < 3s

`Promise.all` de 5 queries independentes no hook. Índices: `idx_billings_tenant_status`, `idx_billings_due_date`, `idx_payments_tenant_paid_at`.

### 8.2 RNF-002 — ROI do veículo < 3s

Duas queries agregadas no banco → `calculateVehicleROI` em `@gomoto/core`. Índice: `idx_rentals_tenant_vehicle ON rentals(tenant_id, vehicle_id)`.

### 8.3 RNF-003 — Resumo da locação < 2s

Queries separadas por `lease_id`/`rental_id` com índices existentes. Para locação com 104 cobranças (ciclo semanal 2 anos): index scan eficiente.

### 8.4 RNF-004 — Inadimplência ≤ 60s

Trigger `trg_billings_delinquency` síncrono na mesma transação → latência efetiva < 1s. Índice `idx_billings_tenant_customer_status` garante O(log n) no recalculo.

---

## 9. Test Strategy

### 9.1 Unit tests — `packages/core/src/rules/`

#### `charges.spec.ts`

- Taxa fixa: R$500, multa R$25, 0,5%/dia, 0 carência, 10 dias vencida → fee=25, interest=25, total=50 (CA-017)
- Carência ativa: 5 dias carência, vencida há 3 → grace=true, total=0 (CA-018)
- Carência expirada: 5 dias carência, vencida há 6 → multa 1x + juros 1 dia (CA-019)
- Taxa percentual, encargos zerados, base = amount − discount (RN-012)

#### `roi.spec.ts`

- Aquisição R$8k, receitas R$12k, custos R$3k, sem venda → result=1000, roi=12.5% (CA-050)
- Com venda R$5k → result=6000, roi=75% (CA-051)
- `acquisition_value=null` → result=null, roi=null (CA-052, RN-044)

#### `delinquency.spec.ts`

- 0 vencidas → `current` (CA-040, RN-030)
- 1 vencida → `late` (RN-031)
- Excede limiar → `delinquent` (CA-039, RN-032)
- `auto_block=true` + threshold → `blocked` (RN-033)

#### `credit.spec.ts`

- Abatimento válido → `{ ok: true }` (CA-030)
- Abatimento > saldo → `OVER_BALANCE` (CA-031, RN-020)
- Abatimento > cobrança → `OVER_BILLING` (CA-032, RN-021)
- Valor base imutável após crédito (RNF-007, RN-022)

#### `schemas/financial.spec.ts`

- `CloseRentalFinancialSchema` partial_return sem motivo → erro (CA-011)
- `CreateRentalAdjustmentSchema` justificativa vazia → erro (CA-035)
- `LateChargeConfigSchema` `daily_interest_rate > 1` → erro

### 9.2 E2E tests — `apps/web/tests/e2e/`

| Arquivo | Cenários principais | CAs cobertas |
|---|---|---|
| `financial-deposit.spec.ts` | Criar locação com/sem caução; encerrar com devolução/retenção; caução insuficiente; histórico | CA-003 a CA-013 |
| `financial-charges.spec.ts` | Ver breakdown de encargos; dispensar; alterar padrão não afeta existente | CA-014 a CA-022 |
| `financial-auto-billing.spec.ts` | Confirmar/recusar cobrança automática para manutenção/multa/despesa; sem locação ativa | CA-015, CA-023 a CA-027 |
| `financial-credit.spec.ts` | Criar crédito; banner; aplicar manual; aplicação automática; histórico | CA-028 a CA-034 |
| `financial-adjustment.spec.ts` | Reajustar; justificativa; prévia; preserva pagas/vencidas; histórico; pro rata | CA-035 a CA-038, CA-054 |
| `financial-delinquency.spec.ts` | Classificação automática; bloqueio/desbloqueio; impede locação | CA-039 a CA-045 |
| `financial-dashboard.spec.ts` | Visão diária; visão mensal; navegar meses | CA-046 a CA-048 |
| `financial-vehicle-roi.spec.ts` | Cadastrar aquisição; ROI; alienação; indisponível | CA-049 a CA-052 |
| `financial-rental-summary.spec.ts` | Resumo; pagamento quita em única operação | CA-053, CA-057 |
| `financial-settings.spec.ts` | Salvar encargos; pré-preenchimento | CA-001, CA-002, CA-014 |

### 9.3 Integration tests — `packages/data/tests/integration/`

- `registerPayment` em billing vencida → `payments` + `late_charges` + `billing.status='paid'` + recalculo de inadimplência — tudo em transação (RNF-004, RNF-006, RNF-009)
- `adjustRental` com 5 pendentes + 2 pagas → 5 atualizadas, 2 intactas (RN-025, RN-026, RNF-006)

> §9.4 Contract tests: N/A — sem sistema externo neste módulo.

**Cobertura total: 57/57 CAs endereçadas (100%).**

---

## 10. Deploy e Rollback

### 10.1 Pré-requisitos

```bash
pnpm build
pnpm --filter @gomoto/core test
pnpm db:reset
```

### 10.2 Divisão em PRs

| PR | Conteúdo | Dependência |
|---|---|---|
| **PR-A** | 13 migrations + seed atualizado + ADRs 0013 e 0014 | Nenhuma |
| **PR-B** | `@gomoto/core`: schemas + tipos + funções puras + unit tests | PR-A |
| **PR-C** | Server Actions + hooks `@gomoto/data` + integration tests | PR-B |
| **PR-D** | UI (telas novas + modificadas) + E2E tests + mobile | PR-C |

### 10.3 Rollback

Sistema pré-produção → `pnpm db:reset`. Para migration quebrada: `supabase migration repair --status reverted <timestamp>` + `pnpm db:reset`.

### 10.4 Seed — adições

```sql
-- Caução, crédito de exemplo, configurações de encargos e inadimplência
-- (detalhes em §10.5 do draft)
```

---

## 11. Riscos Técnicos e Questões Abertas

### 11.1 Riscos técnicos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| RT-01 | Regressão nas telas existentes ao alterar `billings` | Média | Alto | Colunas novas com DEFAULT; E2E completo antes de cada merge |
| RT-02 | `fn_recalculate_delinquency` lenta com volume alto | Baixa | Médio | `idx_billings_tenant_customer_status` mitiga; adicionar `WHEN` clause se necessário |
| RT-03 | `fn_auto_apply_credit` LIMIT 1 — sub-aplicação com múltiplos créditos | Baixa | Baixo | Comportamento FIFO documentado; operador aplica restante manualmente |
| RT-04 | `adjustRental` com 100+ cobranças pendentes — transação pesada | Baixa | Médio | `FOR UPDATE` + batch UPDATE eficiente; timeout 30s; testar com seed de volume |
| RT-05 | Payload inválido em `CloseRentalFinancialSchema` discriminatedUnion | Baixa | Médio | Zod rejeit com `VALIDATION_ERROR`; sem risco de corrupção |
| RT-06 | `late_charge_config = NULL` em billings antigas | Alta | Baixo | `calculateLateCharges` retorna zero para config null; coberto por unit test |
| RT-07 | Compatibilidade com PRD 0005 (Mercado Pago) | Baixa | Alto | Revisado: `payments` e `billing_pix` coexistem sem conflito |
| RT-08 | CAs mobile sem cobertura E2E automatizada | Certeza | Baixo | Cobertos por unit tests; validação manual na primeira versão |

### 11.2 Questões abertas

| ID | Decisão |
|---|---|
| QA-08 | **Resolvido:** encargos sobre `(amount - discount)`; crédito reduz `amount_due` separadamente |
| QA-09 | **Resolvido:** `purchase_date` já existe; RF-041 adiciona `acquisition_value` |
| QA-10 | **Adiado para V2:** `fn_auto_apply_credit` consome um crédito por INSERT (FIFO) |
| QA-11 | **Adiado para V2:** expiração de crédito; coluna `expires_at DATE NULL` pode ser adicionada sem breaking change |

---

## 12. Matriz de Rastreabilidade

### 12.1 Matriz RF

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RF-001 | Tenant configura padrão global de encargos | §3 FT-01, §4.4 `settings`, §5.1 `FinancialSettingsSchema`, §5.3 `saveFinancialSettings` | E2E: `financial-settings.spec.ts::salvar-encargos-padrão` |
| RF-002 | Padrão global pré-preenche formulários | §3 FT-01, §5.1, §5.3 | E2E: `financial-settings.spec.ts::pre-preenche-formulario` |
| RF-003 | Campo opcional de caução no formulário de locação | §3 FT-02, §5.1 `CreateRentalWithDepositSchema`, §5.3 `createRentalWithDeposit` | E2E: `financial-deposit.spec.ts::criar-locacao-com-caucao` |
| RF-004 | Caução como passivo separado das receitas | §3 FT-02, §4.3 `deposits`, §3 FT-09 | E2E: `financial-deposit.spec.ts::caucao-nao-entra-na-receita` |
| RF-005 | Saldo e status da caução rastreados | §4.3 `deposits.balance/status`, §5.4 `useDepositHistory` | E2E: `financial-deposit.spec.ts::saldo-caucao-correto` |
| RF-006 | Exige destino da caução ao encerrar locação | §3 FT-05, §5.1 `CloseRentalFinancialSchema`, §5.3 `closeRentalFinancial` | E2E: `financial-deposit.spec.ts::bloqueia-encerramento-sem-destino` |
| RF-007 | Destinos: devolução integral, parcial, retenção integral | §3 FT-05, §5.1 discriminatedUnion | E2E: `financial-deposit.spec.ts::devolucao-integral`; `devolucao-parcial` |
| RF-008 | Retenção exige motivo obrigatório | §3 FT-05, §5.1 `retention_reason` | E2E: `financial-deposit.spec.ts::bloqueia-retencao-sem-motivo` |
| RF-009 | Alerta de cobrança complementar quando caução insuficiente | §3 FT-05, §5.3 retorna `complementary_billing_needed` | E2E: `financial-deposit.spec.ts::alerta-caucao-insuficiente` |
| RF-010 | Histórico completo da caução no resumo | §4.3 `deposit_movements`, §5.4 `useDepositHistory` | E2E: `financial-deposit.spec.ts::historico-caucao` |
| RF-011 | Encargos pré-preenchidos na criação de locação | §3 FT-02, §5.1 `CreateRentalWithDepositSchema.late_charge_config` | E2E: `financial-settings.spec.ts::pre-preenche-encargos-nova-locacao` |
| RF-012 | Painel de confirmação inclui encargos editáveis | §3 FT-04, §5.1 `ConfirmAutoBillingSchema.late_charge_config` | E2E: `financial-auto-billing.spec.ts::painel-confirmacao-com-encargos` |
| RF-013 | Taxas fixadas por cobrança no momento da criação | §4.4 `billings.late_charge_config JSONB`, §3 FT-04 | Unit: `charges.spec.ts::taxas-fixadas`; E2E: `financial-charges.spec.ts::padrao-nao-afeta-existente` |
| RF-014 | Breakdown de encargos em cobrança vencida | §3 FT-03a, §5.2 `BillingWithCharges`, §5.4 `useBillingDetail` | Unit: `charges.spec.ts::calcula-multa-juros`, `calcula-com-carencia`; E2E: `financial-charges.spec.ts::exibe-breakdown` |
| RF-015 | Operador dispensa encargos com motivo obrigatório | §3 FT-03c, §5.1 `WaiveChargesSchema`, §5.3 `waiveCharges` | E2E: `financial-charges.spec.ts::dispensar-encargos`; `bloqueia-sem-motivo` |
| RF-016 | Dispensa registrada com operador, data e motivo | §4.4 `billings.waiver_*`, §6.3 logAction | E2E: `financial-charges.spec.ts::historico-dispensa` |
| RF-017 | Painel de confirmação para cobrança de manutenção | §3 FT-04, §5.3 `confirmMaintenanceBilling` | E2E: `financial-auto-billing.spec.ts::painel-manutencao` |
| RF-018 | Painel de confirmação para multa de trânsito | §3 FT-04, §5.3 `confirmFineBilling` | E2E: `financial-auto-billing.spec.ts::painel-multa` |
| RF-019 | Painel de confirmação para despesa | §3 FT-04, §5.3 `confirmExpenseBilling` | E2E: `financial-auto-billing.spec.ts::painel-despesa` |
| RF-020 | Operador pode recusar geração automática | §3 FT-04, §5.1 `action='refuse'`, §5.3 | E2E: `financial-auto-billing.spec.ts::recusar-cobranca` |
| RF-021 | Seletor de locação quando sem locação ativa | §3 FT-04 `NO_ACTIVE_RENTAL`, §5.3 | E2E: `financial-auto-billing.spec.ts::sem-locacao-ativa` |
| RF-022 | Operador cria crédito para cliente | §3 FT-06a, §4.3 `customer_credits`, §5.1 `CreateCreditSchema`, §5.3 | E2E: `financial-credit.spec.ts::criar-credito` |
| RF-023 | Banner de crédito disponível ao abrir cobrança | §3 FT-06b, §5.4 `useBillingDetail` | E2E: `financial-credit.spec.ts::banner-credito` |
| RF-024 | Aplicação manual de crédito com validação | §3 FT-06b, §5.1 `ApplyCreditSchema`, §5.3 `applyCredit`, rules `validateCreditApplication` | Unit: `credit.spec.ts::valida-abatimento`; E2E: `financial-credit.spec.ts::aplicar-credito` |
| RF-025 | Aplicação automática de crédito configurável | §4.5 `trg_billings_auto_credit`, §5.1 `FinancialSettingsSchema.auto_apply_credit` | E2E: `financial-credit.spec.ts::aplicacao-automatica` |
| RF-026 | Histórico completo de cada crédito | §4.3 `credit_applications`, §5.4 `useCustomerCredits` | E2E: `financial-credit.spec.ts::historico-credito` |
| RF-027 | Reajuste de valor do ciclo e encargos | §3 FT-07, §5.1 `CreateRentalAdjustmentSchema`, §5.3 `adjustRental` | E2E: `financial-adjustment.spec.ts::reajustar` |
| RF-028 | Reajuste exige justificativa | §5.1 `justification min(5)` | E2E: `financial-adjustment.spec.ts::justificativa-obrigatoria` |
| RF-029 | Prévia de impacto antes de confirmar | §3 FT-07, §5.3 retorna `updated_billings_count` | E2E: `financial-adjustment.spec.ts::previa-impacto` |
| RF-030 | Reajuste afeta apenas cobranças pendentes | §3 FT-07, §4.3 `rental_adjustments` | Integration: `adjustRental-preserva-pagas-vencidas`; E2E: `financial-adjustment.spec.ts::preserva-status` |
| RF-031 | Histórico imutável de reajustes | §4.3 `rental_adjustments`, §5.4 `useRentalFinancialSummary` | E2E: `financial-adjustment.spec.ts::historico-reajustes` |
| RF-032 | Tenant configura limiares de inadimplência | §3 FT-01, §5.1 `DelinquencySettingsSchema`, §5.3 `saveDelinquencySettings` | E2E: `financial-delinquency.spec.ts::configurar-limiares` |
| RF-033 | Classificação automática de inadimplência | §4.5 `trg_billings_delinquency`, §3 FT-08, rules `classifyDelinquency` | Unit: `delinquency.spec.ts::classifica-niveis`; E2E: `financial-delinquency.spec.ts::inadimplencia-automatica` |
| RF-034 | Status visível na listagem e ficha do cliente | §4.4 `customers.delinquency_status`, §3 FT-08 | E2E: `financial-delinquency.spec.ts::status-visivel` |
| RF-035 | Bloqueio manual com motivo obrigatório | §3 FT-08, §5.1 `BlockCustomerSchema`, §5.3 `blockCustomer`, §4.3 `delinquency_blocks` | E2E: `financial-delinquency.spec.ts::bloquear-cliente` |
| RF-036 | Desbloqueio com justificativa obrigatória | §5.1 `UnblockCustomerSchema`, §5.3 `unblockCustomer` | E2E: `financial-delinquency.spec.ts::desbloquear-cliente` |
| RF-037 | Impede nova locação para cliente bloqueado | §6.2, §5.3 guard em `createRentalWithDeposit` | E2E: `financial-delinquency.spec.ts::impede-locacao-bloqueado` |
| RF-038 | Painel financeiro — visão diária | §3 FT-09, §5.4 `useFinancialDashboard`, §8.1 | E2E: `financial-dashboard.spec.ts::visao-diaria` |
| RF-039 | Painel financeiro — visão mensal | §3 FT-09, §5.4 `useFinancialDashboard`, §8.1 | E2E: `financial-dashboard.spec.ts::visao-mensal` |
| RF-040 | Navegação entre meses | §5.4 `useFinancialDashboard(month)` | E2E: `financial-dashboard.spec.ts::navegar-meses` |
| RF-041 | Campos de aquisição e data de compra no veículo | §4.4 `vehicles.acquisition_value` | E2E: `financial-vehicle-roi.spec.ts::cadastrar-aquisicao` |
| RF-042 | Histórico financeiro e ROI do veículo | §3 FT-09, §5.4 `useVehicleFinancialHistory`, rules `calculateVehicleROI`, §8.2 | Unit: `roi.spec.ts::roi-sem-venda`; E2E: `financial-vehicle-roi.spec.ts::historico-roi` |
| RF-043 | Registro de alienação e ROI final | §4.4 `vehicles.sale_value/sold_at`, §5.3 `registerVehicleSale` | Unit: `roi.spec.ts::roi-com-venda`; E2E: `financial-vehicle-roi.spec.ts::registrar-alienacao` |
| RF-044 | ROI "indisponível" sem valor de aquisição | §5.2 `VehicleROI.roi=null`, rules `calculateVehicleROI` | Unit: `roi.spec.ts::roi-null-sem-aquisicao`; E2E: `financial-vehicle-roi.spec.ts::roi-indisponivel` |
| RF-045 | Resumo financeiro por locação | §3 FT-09, §5.4 `useRentalFinancialSummary`, §5.2 `RentalFinancialSummary` | E2E: `financial-rental-summary.spec.ts::exibe-resumo` |
| RF-046 | Histórico de reajustes no resumo da locação | §4.3 `rental_adjustments`, §5.4 `useRentalFinancialSummary` | E2E: `financial-rental-summary.spec.ts::historico-reajustes` |
| RF-047 | Breakdown de cobrança vencida no mobile | §3 FT-10, §5.2 `BillingWithCharges`, rules `calculateLateCharges` | Unit: `charges.spec.ts::breakdown-mobile` |
| RF-048 | Encargo dispensado exibe só valor base no mobile | §3 FT-10, §4.4 `billings.charges_waived` | Unit: `charges.spec.ts::encargo-dispensado-zero` |
| RF-049 | Pagamento quita cobrança em única operação | §3 FT-03b, §4.3 `payments UNIQUE(billing_id)`, §5.3 `registerPayment` | Integration: `registerPayment-quita-billing-atomico`; E2E: `financial-rental-summary.spec.ts::pagamento-unica-operacao` |

### 12.2 Matriz RNF

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RNF-001 | Painel financeiro < 3s | §8.1, §4.3 índices `idx_billings_*`, `idx_payments_*` | N/A — garantido por índices compostos |
| RNF-002 | ROI do veículo < 3s | §8.2, §4.4 `idx_rentals_tenant_vehicle` | N/A — queries agregadas no banco |
| RNF-003 | Resumo da locação < 2s | §8.3, §4.3 índices por `rental_id` | N/A — queries direcionadas com índices |
| RNF-004 | Inadimplência ≤ 60s | §8.4, §4.5 `trg_billings_delinquency` | Integration: `registerPayment-dispara-delinquency` |
| RNF-005 | Sem exclusão física de registros financeiros | §4.1, §6.3 | N/A — RN arquitetural; verificado por code review |
| RNF-006 | Operações multi-registro atômicas | §3 FT-02, FT-05, FT-07 | Integration: `registerPayment-rollback`; `adjustRental-rollback` |
| RNF-007 | Valor base imutável após criação | §4.4 `billings.original_amount`, §3 FT-06b | Unit: `credit.spec.ts::valor-base-imutavel`; E2E: `financial-credit.spec.ts::base-intacta` |
| RNF-008 | Toda operação financeira auditada | §6.3 logAction | N/A — verificado via `audit_logs` |
| RNF-009 | Histórico reconstruível sem cálculo externo | §4.3 `late_charges`, `deposit_movements`, `credit_applications`, `rental_adjustments` | Integration: `registerPayment-late-charges-snapshot` |
| RNF-010 | Isolamento entre tenants | §6.2, §4.3 RLS em todas as tabelas novas | N/A — garantido por RLS |
| RNF-011 | Cliente mobile vê apenas suas cobranças | §6.2 `customer_read_own_billings`, §3 FT-10 | N/A — RLS existente |
| RNF-012 | Apenas autenticados do tenant acessam dados | §6.1, §6.2 | N/A — check de sessão em toda action |
| RNF-013 | Cobrança automática rastreia evento de origem | §4.4 `billings.source`, `.maintenance_id`, `.fine_id` | E2E: `financial-auto-billing.spec.ts::cobranca-vinculada-ao-evento` |
| RNF-014 | LGPD — dados não expostos a terceiros | §6.1, §6.2 | N/A — RN arquitetural/documental |

### 12.3 Matriz RN

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RN-001 | Isolamento de dados por tenant | §6.2, §4 RLS | N/A — RN arquitetural |
| RN-002 | Caução é passivo, não receita | §3 FT-02 e FT-09, §4.3 | E2E: `financial-deposit.spec.ts::caucao-nao-entra-na-receita` |
| RN-003 | Máximo uma caução ativa por locação | §4.3 `UNIQUE INDEX WHERE status='received'` | N/A — constraint de banco |
| RN-004 | Saldo caução = valor − retenções | §4.3 `deposits.balance`, §5.4 | E2E: `financial-deposit.spec.ts::saldo-caucao` |
| RN-005 | Devolução ≤ saldo disponível | §3 FT-05, §5.1 | Unit: `schemas/financial.spec.ts::devolucao-nao-supera-saldo` |
| RN-006 | Retenção exige motivo | §5.1 `retention_reason`, §3 FT-05 | E2E: `financial-deposit.spec.ts::bloqueia-sem-motivo` |
| RN-007 | Caução deve ter destino no encerramento | §3 FT-05, §5.3 | E2E: `financial-deposit.spec.ts::bloqueia-sem-destino` |
| RN-008 | Encargos só em cobranças vencidas | §3 FT-03a, rules `calculateLateCharges` | Unit: `charges.spec.ts::sem-encargo-nao-vencida` |
| RN-009 | Carência a partir do dia seguinte | rules `calculateLateCharges` | Unit: `charges.spec.ts::carencia-dia-seguinte` |
| RN-010 | Multa aplicada uma única vez | rules `calculateLateCharges` | Unit: `charges.spec.ts::multa-uma-vez` |
| RN-011 | Juros acumulam diariamente após carência | rules `calculateLateCharges` | Unit: `charges.spec.ts::juros-diarios` |
| RN-012 | Encargos sobre valor líquido (base − desconto) | §3 FT-03a, rules | Unit: `charges.spec.ts::encargos-valor-liquido` |
| RN-013 | Taxas fixadas no momento da criação | §4.4 `billings.late_charge_config` | E2E: `financial-charges.spec.ts::padrao-nao-afeta-existente` |
| RN-014 | Dispensa irreversível com registro | §4.4 `billings.waiver_*`, §3 FT-03c | E2E: `financial-charges.spec.ts::dispensa-irreversivel` |
| RN-015 | Encargos dispensados não reaparecem | §3 FT-03a, §5.4 | E2E: `financial-charges.spec.ts::encargos-nao-reaparecem` |
| RN-016 | Cobrança automática só após confirmação | §3 FT-04 | E2E: `financial-auto-billing.spec.ts::confirmacao-exige-acao` |
| RN-017 | Recusa salva o evento sem cobrança | §3 FT-04, §5.3 | E2E: `financial-auto-billing.spec.ts::recusar-salva-evento` |
| RN-018 | Vínculo permanente cobrança ↔ evento | §4.4 `billings.source`, `maintenance_id`/`fine_id` | E2E: `financial-auto-billing.spec.ts::vínculo-rastreavel` |
| RN-019 | Saldo crédito = criados − abatimentos | §4.3 `customer_credits.available_balance` | Unit: `credit.spec.ts::saldo-credito` |
| RN-020 | Abatimento ≤ saldo disponível | rules `validateCreditApplication` | Unit: `credit.spec.ts::nao-supera-saldo` |
| RN-021 | Abatimento ≤ valor líquido da cobrança | rules `validateCreditApplication` | Unit: `credit.spec.ts::nao-supera-cobranca` |
| RN-022 | Abatimento reduz `amount_due`, base imutável | §4.4 `billings.credit_applied` | E2E: `financial-credit.spec.ts::base-intacta` |
| RN-023 | Crédito não expira em V1 | §4.3 sem `expires_at`, §11.2 QA-11 | N/A — RN documental |
| RN-024 | Só locações ativas podem ser reajustadas | §3 FT-07 validação, §5.3 | N/A — validado na action |
| RN-025 | Reajuste atualiza cobranças pendentes | §3 FT-07 | Integration: `adjustRental-atualiza-pendentes` |
| RN-026 | Cobranças pagas/vencidas não afetadas | §3 FT-07 | Integration: `adjustRental-preserva-pagas-vencidas` |
| RN-027 | Pro rata recalculada proporcionalmente | §3 FT-07 FA | E2E: `financial-adjustment.spec.ts::recalcula-pro-rata` |
| RN-028 | Reajuste gera registro histórico imutável | §4.3 `rental_adjustments` | E2E: `financial-adjustment.spec.ts::historico-imutavel` |
| RN-029 | Classificação por cobranças do tenant | §4.5 `fn_recalculate_delinquency` | Unit: `delinquency.spec.ts::classifica-por-tenant` |
| RN-030 | Adimplente = 0 vencidas | rules `classifyDelinquency` | Unit: `delinquency.spec.ts::zero-vencidas-current` |
| RN-031 | Em atraso = ≥1 vencida dentro do limiar | rules `classifyDelinquency` | Unit: `delinquency.spec.ts::uma-vencida-late` |
| RN-032 | Inadimplente = excede limiares | rules `classifyDelinquency` | Unit: `delinquency.spec.ts::excede-limiar-delinquent` |
| RN-033 | Bloqueado = automático ou manual | §4.5, §3 FT-08 | Unit: `delinquency.spec.ts::auto-block` |
| RN-034 | Bloqueado não pode ter nova locação | §6.2, §5.3 | E2E: `financial-delinquency.spec.ts::impede-locacao` |
| RN-035 | Desbloqueio exige justificativa, histórico preservado | §5.1, §4.3 `delinquency_blocks` | E2E: `financial-delinquency.spec.ts::desbloqueio-historico` |
| RN-036 | Classificação recalculada automaticamente | §4.5 `trg_billings_delinquency` | Integration: `registerPayment-dispara-recalculo` |
| RN-037 | Receita = pagamentos, excluindo caução e créditos | §3 FT-09, §4.3 `payments` separado | E2E: `financial-dashboard.spec.ts::receita-exclui-caucoes` |
| RN-038 | Despesa = expenses da empresa no período | §3 FT-09 | E2E: `financial-dashboard.spec.ts::visao-mensal` |
| RN-039 | Resultado = Receita − Despesa | §3 FT-09, §5.2 `FinancialDashboard.month_result` | E2E: `financial-dashboard.spec.ts::resultado-correto` |
| RN-040 | Receitas do veículo = payments de locações | §3 FT-09, rules `calculateVehicleROI` | Unit: `roi.spec.ts::receitas-somadas` |
| RN-041 | Custos = aquisição + manutenção + seguro + doc + outros | §3 FT-09, §5.2 | Unit: `roi.spec.ts::custos-por-categoria` |
| RN-042 | Resultado líquido = receitas + venda − custos | rules `calculateVehicleROI` | Unit: `roi.spec.ts::resultado-liquido` |
| RN-043 | ROI = resultado / aquisição × 100% | rules `calculateVehicleROI` | Unit: `roi.spec.ts::roi-percentual` |
| RN-044 | ROI só calculado com aquisição registrada | rules `calculateVehicleROI` | Unit: `roi.spec.ts::roi-null-sem-aquisicao` |
| RN-045 | ROI de veículo não alienado sem valor de venda | rules `calculateVehicleROI` | Unit: `roi.spec.ts::roi-parcial-sem-venda` |
| RN-046 | Sem exclusão física de registros financeiros | §4.1 | N/A — RN arquitetural |
| RN-047 | Pagamento é a única operação que quita cobrança | §3 FT-03b, §4.3 `UNIQUE(billing_id)` | Integration: `registerPayment-unica-operacao` |

### 12.4 Checklist de aprovação

- [ ] Placeholders: 0
- [ ] Cobertura da matriz: 110/110 itens (49 RF + 14 RNF + 47 RN)
- [ ] Toda tabela nova tem `tenant_id` + RLS + trigger `update_updated_at_column`
- [ ] Decisões arquiteturais não triviais referenciadas (ADR 0013, ADR 0014)
- [ ] Nenhum anti-padrão GoMoto adotado
- [ ] `pnpm build` passa (a validar na implementação)

**Aprovado por:** _(aguardando aprovação)_
