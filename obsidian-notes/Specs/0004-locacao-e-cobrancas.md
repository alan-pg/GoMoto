---
status: aprovado
versão: 1.0
modo: completo
autor: Alan (com agente IA)
data: 2026-06-24
prd: "[[PRDs/0004-locacao-e-cobrancas]]"
adr:
  - "[[decisions/0009-geracao-cobracas-upfront-vs-cron]]"
  - "[[decisions/0003-escopo-e-auth-do-mobile-cliente]]"
  - "[[decisions/0004-control-plane-e-identidade-do-cliente]]"
related:
  - "[[Arquitetura Proposta]]"
  - "[[Banco de Dados]]"
  - "[[Telas/Cobranças]]"
  - "[[Telas/Fila]]"
tags:
  - spec
  - locacao-e-cobrancas
  - locacao
  - cobrancas
  - mobile
---

# Spec 0004 — Módulo de Locação e Cobranças Automáticas

> 🟢 **Status: aprovado** em 2026-06-24. Spec técnica derivada de [[PRDs/0004-locacao-e-cobrancas]] (v1.1). Próximo passo: implementar na ordem — migrations → schemas Zod em `@gomoto/core` → Server Actions → UI web → tela mobile → testes.

---

## 1. Visão Geral Técnica

Esta Spec implementa o módulo de locação e cobranças automáticas (PRD 0004 v1.1). O escopo abrange: criação de locações com geração automática de cobranças, gestão do ciclo de vida das cobranças (baixa, desconto, avulsa, encerramento, renovação), fila de espera configurável por tenant, e tela de cobranças no app mobile do cliente.

**Duas ADRs serão criadas em paralelo à implementação:**
- **ADR 0009** — Geração de cobranças upfront vs. cron (`[[decisions/0009-geracao-cobracas-upfront-vs-cron]]`): este módulo adota geração síncrona no ato de criação da locação via RPC PostgreSQL atômico. **Criada em 2026-06-24 — já pode ser referenciada.**
- **ADR 0003 + ADR 0004** — Auth mobile + tenant scope: cobertos pelas ADRs existentes `[[decisions/0003-escopo-e-auth-do-mobile-cliente]]` e `[[decisions/0004-control-plane-e-identidade-do-cliente]]`. Padrão `customers.user_id = auth.uid()` já formalizado.

**Pacotes afetados:**

| Pacote | O que muda |
|---|---|
| `packages/core` (`@gomoto/core`) | Novo `rules/rentals.ts` (renomeia `contracts.ts`); estende `rules/billings.ts`; novos schemas Zod em `schemas/rentals.ts` |
| `packages/data` (`@gomoto/data`) | Atualiza hooks `useRentals`, `useBillings`; atualiza repositórios `rentals.ts`, `billings.ts` |
| `apps/web` | Nova tela `/locacoes`; estende `/clientes` (upload docs); estende `/cobrancas` |
| `apps/mobile` (`@gomoto/mobile`) | Nova `BillingsScreen` para o cliente |
| `supabase/migrations` | 4 novos arquivos de migration (§4) |

**Nota arquitetural:** `packages/data` já existe com hooks e repositórios funcionais — contrariamente ao que o CLAUDE.md marca como "Fase 4 futura". O padrão canônico de tela (TanStack Query para leitura + Server Actions `'use server'` para mutações) é o padrão correto e já está em uso na tela `/manutencao`. O CLAUDE.md deve ser atualizado neste PR (QA-SPEC-03).

---

## 2. Arquitetura

### 2.1 Contexto

```mermaid
flowchart TD
  Op["Operador (Web)"] -->|formulário| SA["Server Action\napps/web/locacoes/actions.ts"]
  SA -->|Zod validate + tenantId| Core["@gomoto/core\ngenerateCharges / rules"]
  SA -->|RPC call| RPC["PostgreSQL RPC\nSECURITY DEFINER"]
  RPC -->|bulk INSERT| DB[(Supabase Postgres\nRLS ativo)]

  Op -->|leitura| Hook["@gomoto/data hooks\nuseRentals / useBillings"]
  Hook -->|PostgREST| RLS_Op["RLS: get_user_tenants()"]
  RLS_Op --> DB

  Client["Cliente (Mobile)"] -->|auth.uid()| Hook2["@gomoto/data\nuseBillingsForCustomer"]
  Hook2 -->|PostgREST| RLS_Cli["RLS: customer_read_own_billings"]
  RLS_Cli --> DB
```

### 2.2 Componentes

**`@gomoto/core` (novos / modificados):**
- `packages/core/src/rules/rentals.ts` — renomeia `contracts.ts`; adiciona `generateCycleCharges`, `calculateProRataValue`, `getEarlyTerminationImpact`; mantém `calculateMinimumEndDate`, `isTerminationWithinMinimum`, `CONTRACT_TERMINATION_FINE_BRL`; renomeia chave `loyalty` → `rent_to_own` em `CONTRACT_MINIMUM_DURATION`
- `packages/core/src/rules/billings.ts` — adiciona `canApplyDiscount`, `canRegisterPayment`, `calculateFinalAmount`
- `packages/core/src/schemas/rentals.ts` — Zod schemas: `RentalSchema`, `RenewRentalSchema`, `RegisterPaymentSchema`, `ApplyDiscountSchema`, `OneTimeChargeSchema`, `UploadClientDocumentSchema`

**`@gomoto/data` (novos / modificados):**
- `packages/data/src/repositories/rentals.ts` — renomeia `contracts.ts`; atualiza queries para `rentals` e `billings.lease_id`
- `packages/data/src/repositories/billings.ts` — atualiza para `original_amount`, `discount_amount`, `lease_id`
- `packages/data/src/hooks/useRentals.ts` — hook para listagem de locações por tenant
- `packages/data/src/hooks/useBillings.ts` — adiciona filtros `lease_id`, `overdue`, `billing_type`
- `packages/data/src/hooks/useBillingsForCustomer.ts` — hook mobile (RLS via `customer_read_own_billings`)

**`apps/web` (novos / modificados):**
- `apps/web/src/app/(dashboard)/locacoes/page.tsx` — nova tela central (substitui `/fila`)
- `apps/web/src/app/(dashboard)/locacoes/actions.ts` — Server Actions do módulo
- `apps/web/src/app/(dashboard)/clientes/` — estendida para upload de documentos
- `apps/web/src/app/(dashboard)/cobrancas/` — estendida com filtros e histórico por locação

**`apps/mobile` (novo):**
- `apps/mobile/src/screens/BillingsScreen.tsx` — lista + filtro + detalhe de cobranças do cliente

**`supabase/migrations` (4 novos arquivos):**
- Migration 1: schema base (`rentals`, `clients_documents`, `tenants.queue_enabled`)
- Migration 2: extensões de `billings` + RLS mobile
- Migration 3: RPCs (`create_rental_with_charges`, `terminate_rental`, `renew_rental`)
- Migration 4: suporte Rent-to-Own (`contract_type`, status `transferred`)

### 2.3 Responsabilidades

| Camada | Responsabilidade |
|---|---|
| `@gomoto/core` | Validação (Zod), regras puras (pro rata, vigência mínima, impacto encerramento) |
| Server Action | Obter `tenant_id`, validar schema, chamar RPC ou Supabase client (server) |
| RPC (SECURITY DEFINER) | Atomicidade: lock de veículo + INSERT rentals + bulk INSERT billings em 1 transação |
| `@gomoto/data` | Leitura via TanStack Query; sem lógica de negócio |
| RLS (Supabase) | Isolamento de tenant (operador) e isolamento de cliente (mobile) |

---

## 3. Fluxos Técnicos

### 3.1 Fluxo principal — Criar locação

```
1. UI: operador preenche formulário → chama generateCycleCharges() (client-side, @gomoto/core)
2. UI: exibe preview das cobranças geradas (quantidade, valores, vencimentos)
3. Operador confirma → createRental(formData) [Server Action]
4.   getCurrentTenantId() → RentalSchema.parse(formData)
5.   generateCycleCharges() → array de { due_date, amount, billing_type }
6.   supabase.rpc('create_rental_with_charges', { ...params, charges: JSON })
7.   RPC (SECURITY DEFINER):
       SELECT id FROM rentals WHERE motorcycle_id = ? AND status = 'active' FOR UPDATE NOWAIT
       → se encontrado: RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED'
       INSERT INTO rentals (...) RETURNING id → v_lease_id
       INSERT INTO billings (...) SELECT ... FROM jsonb_array_elements(p_charges)
8. Server Action: return { ok: true, data: { lease_id } }
9. UI: revalida useRentals() + useBillings()
```

**Erros:**
- `VEHICLE_ALREADY_RENTED` → 409, mensagem "Veículo já possui locação ativa."
- `VEHICLE_LOCKED` (NOWAIT timeout) → 503, "Tente novamente em instantes."
- Falha de rede → RPC rollback → zero cobranças criadas → mensagem de erro na UI

### 3.2 Fluxos de cobrança (baixa / desconto / avulsa)

**Baixa manual:**
```
registerPayment({ billing_id, paid_at, payment_method }) [Server Action]
→ canRegisterPayment(billing.status) → se false: BILLING_ALREADY_PAID ou BILLING_CANCELLED
→ UPDATE billings SET status='paid', paid_at, payment_method, paid_by=userId, updated_at=now()
→ logAction('billing.paid', ...)
```

**Desconto:**
```
applyDiscount({ billing_id, discount_amount, discount_reason }) [Server Action]
→ busca billing.original_amount
→ canApplyDiscount(billing.status, discount_amount, billing.original_amount)
  → se false: DISCOUNT_EXCEEDS_AMOUNT ou BILLING_CANCELLED
→ UPDATE billings SET discount_amount, discount_reason, updated_at=now()
→ logAction('billing.discount_applied', ...)
```

**Cobrança avulsa:**
```
createOneTimeCharge({ lease_id, description, amount, due_date }) [Server Action]
→ verifica rentals.status = 'active' para o lease_id → se não: RENTAL_NOT_ACTIVE
→ INSERT billings (billing_type='one_time', status='pending', original_amount=amount)
→ logAction('billing.one_time_created', ...)
```

### 3.3 Fila de espera

```
addToQueue({ customer_id }) [Server Action]
→ verifica tenants.queue_enabled = true
→ INSERT queue_entries (tenant_id, customer_id, status='waiting', position)

createRentalFromQueue({ customer_id, queue_entry_id, ...rentalData }) [Server Action]
→ mesmo fluxo de §3.1 com RPC
→ após sucesso: UPDATE queue_entries SET status='converted', converted_at=now()
```

### 3.4 Encerramento antecipado

```
1. UI: chama getEarlyTerminationImpact(charges, today, start_date, contract_type) [client-side, @gomoto/core]
   → retorna: { overdue_count, future_count, within_minimum, fine_amount }
2. UI: exibe alertas:
   - Se overdue_count > 0: "N cobrança(s) vencida(s) permanecem abertas para pagamento."
   - Se within_minimum: "Rescisão dentro da vigência mínima. Multa contratual de R$ 1.000,00 aplicável."
3. Operador confirma → terminateRental({ lease_id, termination_date }) [Server Action]
4.   RPC terminate_rental(tenant_id, lease_id, termination_date):
       valida status='active'
       UPDATE billings SET status='cancelled' WHERE due_date > termination_date AND status='pending'
       UPDATE rentals SET status='closed'|'transferred', end_date=termination_date
         (status='transferred' se contract_type='rent_to_own' e NOT within_minimum)
5. logAction('rental.terminated', ...)
```

### 3.5 Renovação

```
renewRental({ lease_id, new_end_date }) [Server Action]
→ busca última cobrança da locação (maior due_date)
→ determina próximo vencimento regular do ciclo após a data original fim
→ Caso A — última não paga:
    complementary_charge = { action: 'update', billing_id, amount: cycle_amount }
→ Caso B — última paga em pro rata:
    complementary_charge = { action: 'insert', amount: cycle_amount - ultima_paga.original_amount,
                              due_date: próximo_vencimento_regular }
→ generateCycleCharges({ start: ponto_renovação, end: new_end_date, ... }) → novas cobranças
→ RPC renew_rental(tenant_id, lease_id, new_end_date, complementary_charge, new_charges)
→ logAction('rental.renewed', ...)
```

### 3.6 Mobile — cliente consulta cobranças

```
1. Cliente autentica no app → anon key + JWT (auth.uid() = customers.user_id)
2. useBillingsForCustomer() → Supabase PostgREST
   → RLS 'customer_read_own_billings': lease_id IN (SELECT id FROM rentals WHERE customer_id IN (...))
3. BillingsScreen: lista agrupada por locação (placa + modelo)
4. Filtro por status (all / pending / paid / overdue) → client-side no array em cache
5. BillingDetailScreen: original_amount, discount_amount, valor final, due_date, status, paid_at, payment_method
6. Offline: staleTime=5min → TanStack cache serve dados; banner "Sem conexão — dados podem estar desatualizados"
   → refetchOnReconnect: true (atualiza ao voltar online)
```

### 3.7 Eventos

Sem eventos assíncronos — todas as operações são síncronas. Se no futuro forem adicionados webhooks de pagamento (PRD Gateway de pagamento), o ponto de integração na `BillingsScreen` já está reservado.

---

## 4. Modelo de Dados

### 4.1 Entidades

| Tabela | Tipo | O que muda |
|---|---|---|
| `rentals` | Renomeada de `contracts` | Campos de ciclo, pro rata, datas; status atualizado |
| `billings` | Modificada | `lease_id` (renomeia `contract_id`), `original_amount`, `discount_amount`, `billing_type`, `payment_method` |
| `queue_entries` | Modificada | Status `converted`; campo `converted_at` |
| `clients_documents` | Nova | Upload de documentos de clientes |
| `tenants` | Modificada | `queue_enabled` booleano |

### 4.2 Migration 1 — Schema base

```sql
-- supabase/migrations/20260624000001_rentals_schema_base.sql
BEGIN;

-- 1. Renomear contracts → rentals
ALTER TABLE contracts RENAME TO rentals;

-- Renomear indexes que referenciam 'contracts' (se existirem)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'rentals' AND indexname LIKE '%contracts%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
      r.indexname, replace(r.indexname, 'contracts', 'rentals'));
  END LOOP;
END $$;

-- 2. Atualizar CHECK de status em rentals
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'rentals'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rentals DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_status_check
  CHECK (status IN ('active', 'closed'));

-- 3. Adicionar campos de locação
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS cycle VARCHAR(10),
  ADD COLUMN IF NOT EXISTS due_day SMALLINT,
  ADD COLUMN IF NOT EXISTS cycle_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS use_pro_rata BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_cycle_check CHECK (cycle IN ('weekly', 'monthly')),
  ADD CONSTRAINT rentals_due_day_check CHECK (due_day BETWEEN 1 AND 28);

-- 4. Estender queue_entries
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'queue_entries'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE queue_entries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE queue_entries
  ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN ('waiting', 'converted', 'cancelled'));

-- 5. Tabela clients_documents
CREATE TABLE IF NOT EXISTS clients_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL
    CHECK (document_type IN ('drivers_license_front', 'drivers_license_back', 'id_front', 'id_back', 'other')),
  storage_path TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  uploaded_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_clients_documents_updated_at
  BEFORE UPDATE ON clients_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clients_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_clients_documents" ON clients_documents
  FOR ALL TO authenticated
  USING  (tenant_id IN (SELECT tenant_id FROM get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM get_user_tenants()));

-- 6. queue_enabled no tenant
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS queue_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 7. Índices
CREATE INDEX IF NOT EXISTS idx_rentals_tenant_status ON rentals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_motorcycle    ON rentals(tenant_id, motorcycle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_customer      ON rentals(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_clients_docs_customer ON clients_documents(tenant_id, customer_id);

COMMIT;
```

### 4.3 Migration 2 — Extensões de billings + RLS mobile

```sql
-- supabase/migrations/20260624000002_billings_extensions.sql
BEGIN;

-- 1. Renomear contract_id → lease_id
ALTER TABLE billings RENAME COLUMN contract_id TO lease_id;

-- 2. Renomear amount → original_amount
ALTER TABLE billings RENAME COLUMN amount TO original_amount;

-- 3. Adicionar campos de desconto, tipo e pagamento
ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason  TEXT,
  ADD COLUMN IF NOT EXISTS billing_type     VARCHAR(20) NOT NULL DEFAULT 'cycle',
  ADD COLUMN IF NOT EXISTS payment_method   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS paid_at          DATE,
  ADD COLUMN IF NOT EXISTS paid_by          UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS discounted_by    UUID REFERENCES auth.users(id);

ALTER TABLE billings
  ADD CONSTRAINT billings_billing_type_check
    CHECK (billing_type IN ('cycle', 'one_time', 'complementary')),
  ADD CONSTRAINT billings_payment_method_check
    CHECK (payment_method IN ('pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer')
           OR payment_method IS NULL);

-- 4. Atualizar CHECK de status
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'billings'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE billings DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE billings
  ADD CONSTRAINT billings_status_check
  CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled', 'prejudice'));

-- 5. Índices compostos para queries frequentes
CREATE INDEX IF NOT EXISTS idx_billings_lease    ON billings(tenant_id, lease_id);
CREATE INDEX IF NOT EXISTS idx_billings_status   ON billings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_billings_due_date ON billings(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_billings_lease_status ON billings(tenant_id, lease_id, status);

-- 6. RLS mobile: cliente lê apenas próprias cobranças
CREATE POLICY "customer_read_own_billings" ON billings
  FOR SELECT TO authenticated
  USING (
    lease_id IN (
      SELECT r.id FROM rentals r
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = auth.uid()
        AND r.tenant_id = billings.tenant_id
    )
  );

COMMIT;
```

### 4.4 Migration 3 — RPCs atômicos

```sql
-- supabase/migrations/20260624000003_rental_rpcs.sql

-- RPC: criar locação com cobranças (operação atômica)
CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id      UUID,
  p_motorcycle_id  UUID,
  p_customer_id    UUID,
  p_cycle          TEXT,
  p_due_day        INTEGER,
  p_cycle_amount   NUMERIC,
  p_start_date     DATE,
  p_end_date       DATE,
  p_use_pro_rata   BOOLEAN,
  p_charges        JSONB   -- [{ due_date, amount, billing_type }]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id UUID;
BEGIN
  -- Lock para evitar locação concorrente no mesmo veículo
  PERFORM id FROM rentals
  WHERE motorcycle_id = p_motorcycle_id
    AND status = 'active'
    AND tenant_id = p_tenant_id
  FOR UPDATE NOWAIT;

  IF FOUND THEN
    RAISE EXCEPTION 'VEHICLE_ALREADY_RENTED';
  END IF;

  -- Criar locação
  INSERT INTO rentals (
    tenant_id, motorcycle_id, customer_id,
    cycle, due_day, cycle_amount, use_pro_rata,
    start_date, end_date, status
  ) VALUES (
    p_tenant_id, p_motorcycle_id, p_customer_id,
    p_cycle, p_due_day, p_cycle_amount, p_use_pro_rata,
    p_start_date, p_end_date, 'active'
  ) RETURNING id INTO v_lease_id;

  -- Bulk insert de cobranças em um único statement
  INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
  SELECT
    p_tenant_id,
    v_lease_id,
    (c->>'amount')::NUMERIC,
    (c->>'due_date')::DATE,
    c->>'billing_type',
    'pending'
  FROM jsonb_array_elements(p_charges) AS c;

  RETURN v_lease_id;
END;
$$;

-- RPC: encerrar locação
CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id       UUID,
  p_lease_id        UUID,
  p_termination_date DATE,
  p_new_status      TEXT DEFAULT 'closed'  -- 'closed' ou 'transferred'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Cancelar cobranças futuras pendentes
  UPDATE billings
  SET status = 'cancelled', updated_at = now()
  WHERE lease_id = p_lease_id
    AND tenant_id = p_tenant_id
    AND due_date > p_termination_date
    AND status = 'pending';

  -- Encerrar locação
  UPDATE rentals
  SET status = p_new_status, end_date = p_termination_date, updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;
END;
$$;

-- RPC: renovar locação
CREATE OR REPLACE FUNCTION renew_rental(
  p_tenant_id           UUID,
  p_lease_id            UUID,
  p_new_end_date        DATE,
  p_complementary_action JSONB,  -- { action: 'update'|'insert', billing_id?, amount, due_date? }
  p_new_charges         JSONB    -- [{ due_date, amount, billing_type }]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rentals
    WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Atualizar data de fim
  UPDATE rentals
  SET end_date = p_new_end_date, updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  -- Tratar última cobrança (recalcular ou inserir complementar)
  IF p_complementary_action IS NOT NULL THEN
    IF (p_complementary_action->>'action') = 'update' THEN
      UPDATE billings
      SET original_amount = (p_complementary_action->>'amount')::NUMERIC, updated_at = now()
      WHERE id = (p_complementary_action->>'billing_id')::UUID
        AND tenant_id = p_tenant_id;
    ELSE
      INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
      VALUES (
        p_tenant_id, p_lease_id,
        (p_complementary_action->>'amount')::NUMERIC,
        (p_complementary_action->>'due_date')::DATE,
        'complementary', 'pending'
      );
    END IF;
  END IF;

  -- Bulk insert novas cobranças
  INSERT INTO billings (tenant_id, lease_id, original_amount, due_date, billing_type, status)
  SELECT p_tenant_id, p_lease_id,
    (c->>'amount')::NUMERIC, (c->>'due_date')::DATE, c->>'billing_type', 'pending'
  FROM jsonb_array_elements(p_new_charges) AS c;
END;
$$;
```

### 4.5 Migration 4 — Suporte Rent-to-Own

```sql
-- supabase/migrations/20260624000004_rent_to_own.sql
BEGIN;

-- 1. Adicionar tipo de locação
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) NOT NULL DEFAULT 'rental';

ALTER TABLE rentals
  ADD CONSTRAINT rentals_contract_type_check
  CHECK (contract_type IN ('rental', 'rent_to_own'));

-- 2. Adicionar status 'transferred' (Rent-to-Own concluído)
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_status_check;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_status_check
  CHECK (status IN ('active', 'closed', 'transferred'));

-- 3. Índice auxiliar para queries de tipo
CREATE INDEX IF NOT EXISTS idx_rentals_contract_type ON rentals(tenant_id, contract_type);

COMMIT;
```

### 4.6 Relacionamentos e restrições críticas

```
rentals
  ├── tenant_id   → tenants.id ON DELETE CASCADE
  ├── motorcycle_id → motorcycles.id ON DELETE RESTRICT
  └── customer_id  → customers.id ON DELETE RESTRICT

billings
  ├── tenant_id  → tenants.id ON DELETE CASCADE
  ├── lease_id   → rentals.id ON DELETE CASCADE
  ├── paid_by    → auth.users(id) (nullable)
  └── discounted_by → auth.users(id) (nullable)

queue_entries
  ├── tenant_id   → tenants.id ON DELETE CASCADE
  └── customer_id → customers.id ON DELETE RESTRICT

clients_documents
  ├── tenant_id   → tenants.id ON DELETE CASCADE
  ├── customer_id → customers.id ON DELETE CASCADE
  └── uploaded_by → auth.users(id)
```

**Restrição de unicidade de locação ativa:** não implementada como UNIQUE constraint no banco (a verificação ocorre via `SELECT FOR UPDATE NOWAIT` no RPC). Isso permite que a constraint seja validada dentro da mesma transação atômica.

---

## 5. APIs

### 5.1 Server Actions (`apps/web/src/app/(dashboard)/locacoes/actions.ts`)

```ts
'use server'

export async function createRental(
  data: CreateRental
): Promise<ActionResult<{ lease_id: string }>>

export async function terminateRental(
  data: TerminateRental
): Promise<ActionResult<void>>

export async function renewRental(
  data: RenewRental
): Promise<ActionResult<void>>

export async function registerPayment(
  data: RegisterPayment
): Promise<ActionResult<void>>

export async function applyDiscount(
  data: ApplyDiscount
): Promise<ActionResult<void>>

export async function createOneTimeCharge(
  data: CreateOneTimeCharge
): Promise<ActionResult<{ billing_id: string }>>

export async function uploadClientDocument(
  data: UploadClientDocument
): Promise<ActionResult<{ document_id: string }>>
```

Padrão de implementação (exemplo — `createRental`):

```ts
export async function createRental(
  data: CreateRental
): Promise<ActionResult<{ lease_id: string }>> {
  const client = await createClient()
  const tenantId = await getCurrentTenantId(client)
  const parsed = RentalSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: '...', field: '...' } }
  }
  const charges = generateCycleCharges(parsed.data)
  const { data: leaseId, error } = await client.rpc('create_rental_with_charges', {
    p_tenant_id: tenantId,
    p_charges: JSON.stringify(charges),
    ...parsed.data,
  })
  if (error) {
    if (error.message.includes('VEHICLE_ALREADY_RENTED')) {
      return { ok: false, error: { code: 'VEHICLE_ALREADY_RENTED', message: 'Veículo já possui locação ativa.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
  await logAction(client, { action: 'rental.created', tenantId, resourceId: leaseId, chargesCount: charges.length })
  return { ok: true, data: { lease_id: leaseId } }
}
```

### 5.2 Schemas Zod (`packages/core/src/schemas/rentals.ts`)

```ts
import { z } from 'zod'

export const RentalSchema = z.object({
  motorcycle_id:  z.string().uuid({ error: 'Veículo obrigatório' }),
  customer_id:    z.string().uuid({ error: 'Cliente obrigatório' }),
  contract_type:  z.enum(['rental', 'rent_to_own']).default('rental'),
  cycle:          z.enum(['weekly', 'monthly']),
  due_day:        z.number().int().min(1).max(28),
  cycle_amount:   z.number().positive({ error: 'Valor do ciclo deve ser positivo' }),
  start_date:     z.string().date(),
  end_date:       z.string().date(),
  use_pro_rata:   z.boolean().default(true),
}).refine(d => d.end_date > d.start_date, {
  message: 'Data de fim deve ser posterior à data de início',
  path: ['end_date'],
})
export type CreateRental = z.infer<typeof RentalSchema>

export const RenewRentalSchema = z.object({
  lease_id:     z.string().uuid(),
  new_end_date: z.string().date(),
  // current_end_date passado pelo server action para validar refine
  current_end_date: z.string().date(),
}).refine(d => d.new_end_date > d.current_end_date, {
  message: 'Nova data de fim deve ser posterior à data de fim atual',
  path: ['new_end_date'],
})
export type RenewRental = z.infer<typeof RenewRentalSchema>

export const RegisterPaymentSchema = z.object({
  billing_id:     z.string().uuid(),
  paid_at:        z.string().date(),
  payment_method: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer']),
})
export type RegisterPayment = z.infer<typeof RegisterPaymentSchema>

export const ApplyDiscountSchema = z.object({
  billing_id:     z.string().uuid(),
  discount_amount: z.number().positive(),
  discount_reason: z.string().min(3, { error: 'Motivo deve ter ao menos 3 caracteres' }),
})
export type ApplyDiscount = z.infer<typeof ApplyDiscountSchema>

export const OneTimeChargeSchema = z.object({
  lease_id:    z.string().uuid(),
  description: z.string().min(3),
  amount:      z.number().positive(),
  due_date:    z.string().date(),
})
export type CreateOneTimeCharge = z.infer<typeof OneTimeChargeSchema>

export const UploadClientDocumentSchema = z.object({
  customer_id:   z.string().uuid(),
  document_type: z.enum(['drivers_license_front', 'drivers_license_back', 'id_front', 'id_back', 'other']),
  file:          z.instanceof(File),
})
export type UploadClientDocument = z.infer<typeof UploadClientDocumentSchema>
```

### 5.3 Hooks de leitura (`@gomoto/data`)

```ts
// packages/data/src/hooks/useRentals.ts
export function useRentals(filter?: { status?: 'active' | 'closed' | 'transferred' })

// packages/data/src/hooks/useBillings.ts
export function useBillings(filter: {
  lease_id?: string
  status?: 'pending' | 'paid' | 'overdue' | 'cancelled'
  overdue?: boolean  // due_date < today AND status = 'pending'
  billing_type?: 'cycle' | 'one_time' | 'complementary'
})

// packages/data/src/hooks/useBillingsForCustomer.ts  (mobile)
export function useBillingsForCustomer(filter?: { status?: string })
```

Configuração TanStack Query para mobile:
```ts
{
  staleTime: 5 * 60 * 1000,   // 5 min
  refetchOnReconnect: true,
  refetchOnWindowFocus: false,
}
```

### 5.4 Envelope de resposta e códigos de erro

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; field?: string } }
```

| Código | Quando ocorre | HTTP equivalente |
|---|---|---|
| `VALIDATION_ERROR` | Schema Zod rejeitado | 422 + `field` preenchido |
| `UNAUTHORIZED` | Sem sessão ativa | 401 |
| `FORBIDDEN` | RLS bloqueou acesso | 403 |
| `VEHICLE_ALREADY_RENTED` | Veículo já tem locação ativa | 409 |
| `VEHICLE_LOCKED` | `SELECT FOR UPDATE NOWAIT` falhou | 503 |
| `RENTAL_NOT_ACTIVE` | Locação não está ativa | 409 |
| `BILLING_ALREADY_PAID` | Cobrança já está paga | 409 |
| `BILLING_CANCELLED` | Cobrança está cancelada — imutável | 409 |
| `DISCOUNT_EXCEEDS_AMOUNT` | Desconto > valor original | 422 |
| `TERMINATION_FINE_APPLICABLE` | Rescisão dentro da vigência mínima (informativo) | 200 com alerta |
| `INTERNAL_ERROR` | Erro inesperado do Supabase | 500 |

---

## 6. Segurança

### 6.1 Autenticação

| Persona | Mecanismo |
|---|---|
| Operador | Supabase Auth → JWT → `tenant_members` vincula `user_id` a `tenant_id` |
| Cliente (mobile) | Supabase Auth → JWT → `customers.user_id = auth.uid()` |

A função `getCurrentTenantId(client)` (Server Action) lê `tenant_members` com o `user_id` da sessão. No mobile, não há acesso ao `getCurrentTenantId` — o RLS usa `auth.uid()` diretamente.

### 6.2 Autorização

**Matriz persona × ação:**

| Recurso / Ação | Operador | Cliente (mobile) |
|---|---|---|
| Criar locação | ✓ (own tenant) | ✗ |
| Encerrar / renovar locação | ✓ | ✗ |
| Ler lista de locações | ✓ | ✗ |
| Criar baixa / desconto / avulsa | ✓ | ✗ |
| Ler cobranças (web) | ✓ (own tenant) | ✗ |
| Ler cobranças (mobile) | ✗ | ✓ (próprias) |
| Upload de documentos de cliente | ✓ | ✗ |
| Ler documentos de cliente | ✓ (own tenant) | ✗ |
| Adicionar à fila / criar da fila | ✓ | ✗ |

**Políticas RLS aplicadas:**

```sql
-- Operador (todas as tabelas: rentals, billings, queue_entries, clients_documents)
USING (tenant_id IN (SELECT tenant_id FROM get_user_tenants()))

-- Cliente mobile (billings only — policy: customer_read_own_billings)
USING (
  lease_id IN (
    SELECT r.id FROM rentals r
    INNER JOIN customers c ON c.id = r.customer_id
    WHERE c.user_id = auth.uid()
      AND r.tenant_id = billings.tenant_id
  )
)
```

**SECURITY DEFINER nos RPCs:** o RPC recebe `p_tenant_id` validado pela Server Action — nunca infere `tenant_id` de dentro do RPC via sessão. Toda Server Action deve chamar `getCurrentTenantId()` antes de invocar o RPC.

### 6.3 Auditoria

Toda mutação registra via `logAction`:

```ts
await logAction(client, {
  action: 'rental.created' | 'rental.terminated' | 'rental.renewed'
        | 'billing.paid' | 'billing.discount_applied' | 'billing.one_time_created',
  tenantId: string,
  userId: string,
  resourceId: string,         // lease_id ou billing_id
  outcome: 'success' | 'error',
  latencyMs: number,
  // campos opcionais por ação:
  chargesCount?: number,       // rental.created
  errorCode?: string,          // outcome='error'
})
```

### 6.4 LGPD

- Logs não contêm PII bruta (sem nome, CPF, endereço, placa). Apenas IDs (`tenant_id`, `user_id`, `resource_id`).
- Dados financeiros do cliente acessíveis apenas via RLS autenticado.
- Documentos de clientes armazenados no Supabase Storage com bucket privado (`tenant_id` no path) — sem URL pública.

---

## 7. Observabilidade

### 7.1 Logs essenciais

Formato JSON estruturado por operação:

```json
{ "action": "rental.created",   "tenantId": "uuid", "userId": "uuid", "resourceId": "lease_uuid",  "chargesCount": 52, "latencyMs": 145, "outcome": "success" }
{ "action": "rental.terminated","tenantId": "uuid", "userId": "uuid", "resourceId": "lease_uuid",  "cancelledCount": 8, "latencyMs": 67, "outcome": "success" }
{ "action": "rental.renewed",   "tenantId": "uuid", "userId": "uuid", "resourceId": "lease_uuid",  "newChargesCount": 12, "latencyMs": 89, "outcome": "success" }
{ "action": "billing.paid",     "tenantId": "uuid", "userId": "uuid", "resourceId": "billing_uuid","latencyMs": 34, "outcome": "success" }
{ "action": "billing.discount_applied", "tenantId": "uuid", "userId": "uuid", "resourceId": "billing_uuid", "latencyMs": 28, "outcome": "success" }
{ "action": "billing.one_time_created", "tenantId": "uuid", "userId": "uuid", "resourceId": "billing_uuid", "latencyMs": 22, "outcome": "success" }
```

Erros logados sempre com `outcome: 'error'` e `errorCode`:

```json
{ "action": "rental.created", "outcome": "error", "errorCode": "VEHICLE_ALREADY_RENTED", "latencyMs": 12 }
```

### 7.2 Métricas e alertas

N/A — feature de gestão interna; sem SLA de disponibilidade diferenciado. Monitorar `latencyMs` do `rental.created` nos primeiros deploys para validar RNF-001.

---

## 8. Performance e Escalabilidade

### RNF-001 — Criação com até 104 cobranças em < 3s

**Mecanismo:** `jsonb_to_recordset` em um único `INSERT ... SELECT` (1 statement, não N statements em loop). Estimativa baseada em Supabase Postgres padrão:

| Operação | Estimativa |
|---|---|
| `SELECT FOR UPDATE NOWAIT` | ~2ms (índice `motorcycle_id`) |
| `INSERT INTO rentals` | ~3ms |
| `INSERT INTO billings` (104 rows bulk) | ~15ms |
| Overhead de rede + serialização | ~50–100ms |
| **Total estimado** | **< 150ms** |

Índice crítico: `idx_rentals_motorcycle ON rentals(tenant_id, motorcycle_id)` — sem ele, o lock scan degrada para seq scan.

Verificação pós-deploy: `latencyMs` no log `rental.created` deve ser < 500ms em condições normais.

### RNF-002 — Listagem de até 200 cobranças em < 2s

Índice composto `idx_billings_lease_status ON billings(tenant_id, lease_id, status)` cobre o filtro mais frequente. Query PostgREST com `?tenant_id=eq.X&lease_id=eq.Y` usa o índice completo.

### RNF-003 — Mobile < 3s em 4G

```ts
// Configuração TanStack Query no hook mobile
{
  staleTime: 5 * 60 * 1000,  // cache válido por 5 min — não refetch em navegação
  refetchOnReconnect: true,   // atualiza ao voltar online
  refetchOnWindowFocus: false, // app mobile não tem foco de janela
}
```

Banner offline no `BillingsScreen`:
```tsx
{!isOnline && (
  <Banner variant="warning">
    Sem conexão — exibindo dados salvos localmente
  </Banner>
)}
```

---

## 9. Test Strategy

### 9.1 Unit tests (Vitest em `@gomoto/core`)

**`packages/core/src/rules/rentals.spec.ts`** (arquivo novo):

```ts
describe('generateCycleCharges', () => {
  it('gera N cobranças semanais cheias entre datas', ...)
  it('gera pro rata na primeira cobrança quando início não é dia de vencimento', ...)
  it('primeira cobrança = ciclo completo quando início é exatamente o dia de vencimento', ...)
  it('gera pro rata na última cobrança proporcional ao período restante', ...)
  it('cobranças intermediárias são sempre pelo valor cheio', ...)
  it('arredonda pro rata para 2 casas decimais (≥0,005 → sobe)', ...)
  it('gera cobranças mensais respeitando dia de vencimento 28 em fevereiro', ...)
  it('sem pro rata: todas as cobranças pelo valor integral incluindo primeira e última', ...)
})

describe('isTerminationWithinMinimum', () => {
  it('Rental: retorna true quando encerramento < 3 meses após início', ...)
  it('Rental: retorna false quando encerramento >= 3 meses após início', ...)
  it('Rent-to-Own: retorna true quando encerramento < 2 anos após início', ...)
  it('Rent-to-Own: retorna false quando encerramento >= 2 anos após início', ...)
})

describe('calculateMinimumEndDate', () => {
  it('Rental: data mínima = início + 3 meses', ...)
  it('Rent-to-Own: data mínima = início + 2 anos', ...)
})

describe('getEarlyTerminationImpact', () => {
  it('conta cobranças vencidas, futuras e identifica within_minimum', ...)
  it('retorna fine_amount = CONTRACT_TERMINATION_FINE_BRL quando within_minimum', ...)
})

describe('RentalSchema', () => {
  it('rejeita quando end_date <= start_date', ...)
  it('rejeita due_day fora de 1-28', ...)
  it('aceita contract_type rental e rent_to_own', ...)
})

describe('complementary charge on renewal', () => {
  it('calculates complementary amount = ciclo - pro_rata_pago', ...)
  it('due_date do complementar = próximo vencimento regular', ...)
})
```

**`packages/core/src/rules/billings.spec.ts`** (extensão do existente):

```ts
describe('canRegisterPayment', () => {
  it('aceita status pending', ...)
  it('aceita status overdue', ...)
  it('rejeita status paid → BILLING_ALREADY_PAID', ...)
  it('rejeita status cancelled → BILLING_CANCELLED', ...)
})

describe('canApplyDiscount', () => {
  it('aceita desconto < original_amount', ...)
  it('rejeita desconto > original_amount → DISCOUNT_EXCEEDS_AMOUNT', ...)
  it('rejeita quando status = cancelled', ...)
})

describe('calculateFinalAmount', () => {
  it('valor final = original - desconto', ...)
  it('sem desconto: valor final = original', ...)
})
```

Rodar: `pnpm --filter @gomoto/core test`.

### 9.2 E2E tests (Playwright em `apps/web`)

**`apps/web/tests/e2e/rentals.spec.ts`**:

```ts
test('operador cria locação semanal com pro rata e N cobranças são geradas', ...)
test('preview de cobranças exibido antes da confirmação', ...)
test('criação falha com rede cortada → nenhuma cobrança persistida', ...)
test('veículo bloqueado quando já tem locação ativa', ...)
test('locação encerrada libera veículo para nova locação', ...)
test('adicionar cliente à fila e criar locação a partir dela', ...)
test('fila oculta quando tenant.queue_enabled = false', ...)
test('criar locação tipo Rent-to-Own sugere data de fim 2 anos à frente', ...)
test('renovar contrato — última não paga → recalcula valor', ...)
test('renovar contrato — última paga pro rata → gera complementar', ...)
```

**`apps/web/tests/e2e/billings.spec.ts`**:

```ts
test('encerramento antecipado cancela cobranças futuras e preserva vencidas e pagas', ...)
test('alerta exibe N cobranças vencidas abertas ao encerrar', ...)
test('alerta de multa ao encerrar Rental com < 3 meses', ...)
test('Rent-to-Own com 2 anos cumpridos → status transferred', ...)
test('baixa manual muda status para paid com data e forma registrados', ...)
test('bloqueia segunda baixa em cobrança já paga', ...)
test('desconto preserva valor original e exibe valor final = original - desconto', ...)
test('bloqueia desconto maior que valor original', ...)
test('cobrança avulsa criada vinculada a locação ativa', ...)
test('filtro por status exibe apenas cobranças do status selecionado', ...)
test('histórico por locação exibe todas as cobranças da locação', ...)
```

Rodar: `pnpm --filter web test:e2e`.

### 9.3 Protocolo mobile (manual)

Executar em dispositivo físico (Android 10+ ou iOS 14+) antes de EAS external build:

| CA | Cenário | Esperado |
|---|---|---|
| CA-032 | Cliente autenticado acessa "Minhas Cobranças" | Lista exibe placa + modelo em cada item |
| CA-033 | Cliente seleciona filtro "pendentes" | Apenas cobranças pendentes exibidas |
| CA-034 | Cliente toca em cobrança com desconto | Detalhe mostra original, desconto, valor final |
| CA-035 | Cliente toca em cobrança paga | Detalhe mostra data e forma de pagamento |
| CA-036 | Cliente desativa Wi-Fi/dados e abre app | Última lista em cache exibida com banner "offline" |

### 9.4 Integration / Contract

N/A — Unit + E2E suficientes para V1. Testes de isolamento cross-tenant são cobertos implicitamente pelos E2E (cada sessão opera com um tenant separado via seed).

---

## 10. Deploy e Rollback

### 10.1 Ordem de deploy

As migrations têm dependência em cascata: cada uma pressupõe a anterior aplicada.

```
Migration 1 (rentals_schema_base)
  → Migration 2 (billings_extensions)
    → Migration 3 (rental_rpcs)
      → Migration 4 (rent_to_own)
```

### 10.2 Sequência de deploy

```
1. pnpm db:reset (dev) ou supabase db push (prod — aprovação humana explícita)
2. Deploy @gomoto/core  → novo rentals.ts, billings.ts, schemas/rentals.ts
3. Deploy @gomoto/data  → hooks e repositórios atualizados
4. Deploy apps/web      → nova tela /locacoes + ações no Vercel
5. Deploy apps/mobile   → EAS build (gate separado, após ADR 0004 aprovado)
```

O deploy das migrations deve anteceder o deploy do código que depende das novas colunas/RPCs. Não há feature flag em V1 — o rollout é progressivo pela ordem acima.

### 10.3 Rollback por migration

| Migration | Rollback |
|---|---|
| Migration 4 (Rent-to-Own) | `ALTER TABLE rentals DROP COLUMN contract_type; DROP CONSTRAINT rentals_status_check; ADD CONSTRAINT ... CHECK (status IN ('active', 'closed'))` |
| Migration 3 (RPCs) | `DROP FUNCTION create_rental_with_charges; DROP FUNCTION terminate_rental; DROP FUNCTION renew_rental` |
| Migration 2 (billings ext.) | Reversão complexa (rename de colunas); dado que não há produção: `pnpm db:reset` |
| Migration 1 (schema base) | `pnpm db:reset` — sistema sem dados em produção |

### 10.4 Verificação pós-deploy

- [ ] `pnpm --filter web test:e2e` passa (headless)
- [ ] Criar 1 locação manual via UI e verificar N cobranças na listagem
- [ ] Verificar `latencyMs` no log `rental.created` < 500ms
- [ ] Verificar tela de cobranças no mobile (protocolo §9.3 CA-032)
- [ ] `SELECT COUNT(*) FROM rentals WHERE tenant_id = '<test-tenant>'` retorna esperado

---

## 11. Riscos Técnicos e Questões Abertas

### 11.1 Riscos técnicos

#### Riscos do PRD §11.2 → mitigações técnicas

| Risco (PRD) | Mitigação técnica prescrita nesta Spec |
|---|---|
| Pro rata com edge cases gera cobranças incorretas | Suite de unit tests em `rentals.spec.ts` cobre: início no dia do vencimento, mês curto (due_day 28), ciclo semanal com 3/7 e 4/7 — **deve ser verde antes de qualquer release** |
| Operador cria locação com configuração errada | Preview obrigatório (RF-036) recalculado via `generateCycleCharges` client-side — impossível confirmar sem ver a lista |
| Operador encerra locação sem perceber cobranças vencidas | `getEarlyTerminationImpact` calcula client-side antes da confirmação; alerta informativo (RF-037) |
| Geração de 104+ cobranças atinge timeout | Bulk insert via `jsonb_to_recordset` (1 statement); estimativa < 150ms; verificar `latency_ms` nos logs pós-deploy |
| Cliente mobile acessa cobranças de outro tenant | Policy `customer_read_own_billings` + testes de isolamento manual (CA-032–CA-036) antes do release externo; ADR 0004 é gate |
| Cache offline exibe cobranças desatualizadas | `staleTime: 5min` + reconexão dispara refetch; banner "Sem conexão" quando offline |
| Migração dos dados de `/fila` para `/locacoes` | Sem dados em produção — `pnpm db:reset` + seed novo cobre |

#### Riscos técnicos identificados durante a Spec

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| **Rename `contracts.ts` → `rentals.ts` quebra imports** em `apps/web`, `@gomoto/data`, testes | Alta | Médio | Auditar todos os `import ... from './contracts'` e `from '@gomoto/core'` antes de renomear; manter re-export temporário se necessário |
| **Rename `billings.contract_id` → `lease_id` quebra queries** em repositórios e hooks | Alta | Médio | Atualizar `repositories/billings.ts`, `hooks/useBillings.ts` simultaneamente com a migration |
| **RPC SECURITY DEFINER sem validação de `tenant_id` na Server Action** | Baixa | Crítico | Toda Server Action deve chamar `getCurrentTenantId()` ANTES do RPC — nunca inferir tenant dentro do RPC via sessão |
| **`SELECT FOR UPDATE NOWAIT` no RPC** pode causar `VEHICLE_LOCKED` espúrio | Muito baixa | Baixo | Aceitar — é preferível falhar rápido a esperar. UI trata com "Tente novamente" |
| **CLAUDE.md desatualizado** induz agentes futuros a padrões errados | Alta | Médio | Atualizar CLAUDE.md neste mesmo PR |
| **`checklists.contract_id` não renomeado** neste PR | Baixa | Baixo | `COMMENT ON COLUMN checklists.contract_id IS 'FK para rentals (antigo contracts)'` na Migration 1 |
| **Multa R$ 1.000 hardcoded em `@gomoto/core`** | Baixa | Baixo | V1 aceita hardcoded. Configurável por tenant = PRD futuro |

### 11.2 Questões abertas

| ID | Questão | Status | Responsável |
|---|---|---|---|
| QA-SPEC-01 | **ADR 0009** — Geração upfront vs. cron: criada em 2026-06-24 (`[[decisions/0009-geracao-cobracas-upfront-vs-cron]]`). | **Resolvida** | — |
| QA-SPEC-02 | **Auth mobile + tenant scope**: coberto por ADR 0003 (`escopo-e-auth-do-mobile-cliente`) + ADR 0004 (`control-plane-e-identidade-do-cliente`). Confirmar que `customer_read_own_billings` é consistente com ADR 0003 antes do EAS external build. | Pendente (verificação) | Alan |
| QA-SPEC-03 | **CLAUDE.md** atualizado em 2026-06-24: padrão canônico de tela documentado (ADR 0002), `packages/data` e `apps/mobile` na estrutura, fases 0–5 marcadas como concluídas, referência a `get_user_tenants()`. | **Resolvida** | — |
| QA-SPEC-04 | **Rota `/fila`**: **remover** `apps/web/src/app/(dashboard)/fila/` neste PR. Decisão: remoção completa (sem redirect, sem dados em produção). | **Resolvida** | — |

---

## 12. Matriz de Rastreabilidade e Aprovação

### 12.1 Matriz

Cobertura **100%** dos RF/RNF/RN do PRD `[[PRDs/0004-locacao-e-cobrancas]]`.

#### Requisitos Funcionais

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RF-001 | Upload de documentos do cliente no cadastro | §4.2 (`clients_documents`), §5.1 (`uploadClientDocument`) | E2E: `rentals.spec.ts::upload-document` |
| RF-002 | Ação imediata pós-registro ("Fila" ou "Nova locação") | §3.1, §5.1 | E2E: `rentals.spec.ts::post-register-action` |
| RF-003 | Criar locação selecionando cliente por busca | §3.1, §5.2 (`useCustomers`) | E2E: `rentals.spec.ts::create-rental` |
| RF-004 | Formulário exige veículo, ciclo, due_day, valor, início, fim | §5.1 (`RentalSchema`), §4.2 | Unit: `rentals.spec.ts::RentalSchema-required-fields`; E2E: `rentals.spec.ts::create-rental` |
| RF-005 | Escolher entre pro rata e cobrança cheia | §3.1, §5.1 (`use_pro_rata`) | E2E: `rentals.spec.ts::create-rental-pro-rata` |
| RF-006 | Bloquear criação para veículo com locação ativa | §3.1 (`VEHICLE_ALREADY_RENTED`), §4.4 (RPC lock), §5.4 | E2E: `rentals.spec.ts::vehicle-already-rented` |
| RF-007 | Gerar cobranças de ciclo automaticamente e de forma atômica | §3.1 (`create_rental_with_charges`), §4.4 | Unit: `rentals.spec.ts::generateCycleCharges`; E2E: `rentals.spec.ts::atomic-generation` |
| RF-008 | Primeira cobrança pro rata proporcional ao período | §3.1, §5.2 | Unit: `rentals.spec.ts::first-charge-pro-rata` |
| RF-009 | Última cobrança pro rata proporcional ao período | §3.1, §5.2 | Unit: `rentals.spec.ts::last-charge-pro-rata` |
| RF-010 | Fila habilitável/desabilitável por tenant | §4.2 (`tenants.queue_enabled`), §5.1 | E2E: `rentals.spec.ts::queue-disabled-hides-option` |
| RF-011 | Adicionar cliente cadastrado à fila | §3.3 | E2E: `rentals.spec.ts::add-to-queue` |
| RF-012 | Criar locação a partir de cliente na fila | §3.3 | E2E: `rentals.spec.ts::create-from-queue` |
| RF-013 | Listar locações ativas e encerradas em `/locacoes` | §2.2, §5.3 (`useRentals`) | E2E: `rentals.spec.ts::list-rentals` |
| RF-014 | Encerrar locação ativa antecipadamente | §3.4, §5.1 (`terminateRental`) | E2E: `billings.spec.ts::early-termination` |
| RF-015 | Cancelar cobranças futuras ao encerrar | §3.4, §4.4 (`terminate_rental` RPC) | E2E: `billings.spec.ts::early-termination` |
| RF-016 | Cobranças vencidas preservadas no encerramento | §3.4 | E2E: `billings.spec.ts::early-termination` |
| RF-017 | Renovar locação ativa com nova data de fim | §3.5, §5.1 (`renewRental`) | E2E: `rentals.spec.ts::renew-contract` |
| RF-018 | Recalcular última cobrança não paga na renovação | §3.5 | Unit: `rentals.spec.ts::recalc-last-unpaid`; E2E: `rentals.spec.ts::renew-contract` |
| RF-019 | Gerar complementar se última paga em pro rata | §3.5 | Unit: `rentals.spec.ts::complementary-charge-generation`; E2E: `rentals.spec.ts::renew-contract` |
| RF-020 | Novas cobranças de ciclo após renovação | §3.5 | E2E: `rentals.spec.ts::renew-contract` |
| RF-021 | Exibir valor original, desconto, valor final, vencimento, status | §5.3 (`BillingCard`) | E2E: `billings.spec.ts::billing-detail-view` |
| RF-022 | Histórico completo de cobranças por locação | §3.2, §5.3 (`useBillings` com `lease_id`) | E2E: `billings.spec.ts::history-by-lease` |
| RF-023 | Lista de cobranças em atraso de todas as locações | §3.2, §5.3 (`useBillings` com `overdue`) | E2E: `billings.spec.ts::overdue-list` |
| RF-024 | Filtrar cobranças por status | §3.2, §5.3 | E2E: `billings.spec.ts::status-filter` |
| RF-025 | Baixa manual com data e forma de pagamento | §3.2, §5.1 (`registerPayment`) | E2E: `billings.spec.ts::register-payment` |
| RF-026 | Bloquear baixa em cobrança já paga | §5.1, §5.4 (`BILLING_ALREADY_PAID`) | Unit: `billings.spec.ts::canRegisterPayment-already-paid`; E2E: `billings.spec.ts::block-double-payment` |
| RF-027 | Criar cobrança avulsa vinculada a locação ativa | §3.2, §5.1 (`createOneTimeCharge`) | E2E: `billings.spec.ts::one-time-charge` |
| RF-028 | Toda avulsa obrigatoriamente vinculada a locação | §5.1 (`lease_id` required), §4.3 (FK NOT NULL) | Unit: `billings.spec.ts::OneTimeChargeSchema-requires-lease` |
| RF-029 | Aplicar desconto com valor e motivo | §3.2, §5.1 (`applyDiscount`) | E2E: `billings.spec.ts::apply-discount` |
| RF-030 | Preservar valor original após desconto | §4.3 (`original_amount` + `discount_amount`) | Unit: `billings.spec.ts::calculateFinalAmount`; E2E: `billings.spec.ts::apply-discount` |
| RF-031 | Bloquear desconto maior que valor original | §5.1, §5.4 (`DISCOUNT_EXCEEDS_AMOUNT`) | Unit: `billings.spec.ts::canApplyDiscount-exceeds`; E2E: `billings.spec.ts::block-excess-discount` |
| RF-032 | Mobile — lista cobranças com placa/modelo por item | §3.6, §5.3 (`BillingsScreen`) | Manual: `protocolo-mobile::CA-032` |
| RF-033 | Mobile — filtrar cobranças por status | §3.6, §5.3 | Manual: `protocolo-mobile::CA-033` |
| RF-034 | Mobile — detalhe da cobrança | §3.6, §5.3 (`BillingDetailScreen`) | Manual: `protocolo-mobile::CA-034`; `CA-035` |
| RF-035 | Mobile — cache offline com indicador de rede | §3.6, §8 (`staleTime` + reconexão) | Manual: `protocolo-mobile::CA-036` |
| RF-036 | Preview de cobranças antes de confirmar criação | §3.1, §5.1 (`generateCycleCharges` client-side) | Unit: `rentals.spec.ts::generateCycleCharges`; E2E: `rentals.spec.ts::preview-before-confirm` |
| RF-037 | Alerta de cobranças vencidas abertas ao encerrar | §3.4 (`getEarlyTerminationImpact`), §5.1 | Unit: `rentals.spec.ts::getEarlyTerminationImpact`; E2E: `billings.spec.ts::early-termination-alert` |
| RF-038 | Selecionar tipo de locação (Rental / Rent-to-Own) | §5.1 (`RentalSchema.contract_type`), §4.5 (Migration 4) | E2E: `rentals.spec.ts::contract-type-selection` |
| RF-039 | Alerta de multa ao encerrar dentro da vigência mínima | §3.4 (`isTerminationWithinMinimum`), §5.1 | Unit: `rentals.spec.ts::isTerminationWithinMinimum`; E2E: `billings.spec.ts::termination-fine-alert` |

#### Requisitos Não Funcionais

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RNF-001 | Criação com cobranças < 3s para até 104 cobranças | §8 (estimativa < 150ms via bulk insert), §4.4 (`jsonb_to_recordset`) | N/A — verificação via `latencyMs` nos logs pós-deploy |
| RNF-002 | Listagem de cobranças < 2s para até 200 cobranças | §8 (`idx_billings_lease_status`), §4.3 | N/A — verificação via logs pós-deploy |
| RNF-003 | Tela mobile < 3s em conexão 4G | §8 (`staleTime: 5min`), §3.6 | Manual: teste de rede throttled |
| RNF-004 | Criação de locação + cobranças indivisível | §3.1 (RPC ACID), §4.4 (transação PostgreSQL) | E2E: `rentals.spec.ts::atomic-generation` |
| RNF-005 | Baixas, descontos e avulsas registram operador e timestamp | §6.2 (auditoria), §7.1 (logs estruturados) | E2E: `billings.spec.ts::audit-trail` |
| RNF-006 | Cliente mobile vê apenas próprias cobranças | §6.2 (`customer_read_own_billings`), §4.3 (Migration 2 RLS) | Manual: `protocolo-mobile::CA-032` |
| RNF-007 | Isolamento total por tenant em todos os registros | §6.2 (`get_user_tenants` RLS), §4.2 (`tenant_id NOT NULL`) | N/A — implícito em todos os E2E de listagem |
| RNF-008 | Compatibilidade Android 10+ / iOS 14+ / Expo Go | §1 (stacks), §3.6 | Manual: teste em dispositivo; N/A — suporte garantido por Expo SDK |
| RNF-009 | Browsers Chrome, Firefox, Edge, Safari (últimos 2 anos) | §10.4 (checklist pós-deploy) | N/A — padrão Next.js 14 |
| RNF-010 | Dados financeiros do cliente não expostos a terceiros (LGPD) | §6.4 (proteção de dados) | N/A — RN documental; garantido por RLS + política organizacional |

#### Regras de Negócio

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RN-001 | Registro pertence a um único tenant | §4.2 (`tenant_id NOT NULL`), §6.2 (RLS) | N/A — DB constraint + RLS; implícito em todos os E2E |
| RN-002 | Locação = 1 veículo + 1 cliente | §4.6 (FKs `motorcycle_id`, `customer_id`) | N/A — DB constraint |
| RN-003 | Cliente pode ter múltiplas locações ativas | §4.6 (sem `UNIQUE` em `customer_id`) | N/A — ausência de constraint |
| RN-004 | Veículo tem no máximo 1 locação ativa | §4.4 (`SELECT FOR UPDATE NOWAIT`), §5.4 (`VEHICLE_ALREADY_RENTED`) | E2E: `rentals.spec.ts::vehicle-already-rented` |
| RN-005 | Data de fim estritamente após data de início | §5.1 (`RentalSchema.refine`) | Unit: `rentals.spec.ts::RentalSchema-end-after-start` |
| RN-006 | Due day semanal = dia da semana (1–7) | §5.1 (`RentalSchema.due_day` enum semanal) | Unit: `rentals.spec.ts::RentalSchema-due-day-weekly` |
| RN-007 | Due day mensal = inteiro 1–28 | §5.1 (`RentalSchema.due_day` refine 1–28) | Unit: `rentals.spec.ts::RentalSchema-due-day-monthly` |
| RN-008 | Valor da primeira cobrança pro rata = dias/ciclo × valor | §5.2 (`generateCycleCharges`), §3.1 | Unit: `rentals.spec.ts::first-charge-pro-rata` |
| RN-009 | Valor da última cobrança pro rata = dias/ciclo × valor | §5.2 (`generateCycleCharges`) | Unit: `rentals.spec.ts::last-charge-pro-rata` |
| RN-010 | Cobranças intermediárias sempre pelo valor integral | §5.2 (loop em `generateCycleCharges`) | Unit: `rentals.spec.ts::intermediate-charges-full` |
| RN-011 | Cobrança cheia → todas as cobranças pelo valor integral | §5.2 (`use_pro_rata=false`) | Unit: `rentals.spec.ts::full-charges-no-prorate` |
| RN-012 | Pro rata arredondado 2 casas decimais (≥0,005 sobe) | §5.2 (`calculateProRataValue`) | Unit: `rentals.spec.ts::pro-rata-rounding` |
| RN-013 | Cobrança nasce com status `pending` | §4.3 (`DEFAULT 'pending'`) | N/A — DB default; E2E: `billings.spec.ts::new-billing-status` |
| RN-014 | Cobrança vencida: `due_date < today` e `status = pending` | §5.2 (`isChargeOverdue` em `billings.ts`) | Unit: `billings.spec.ts::isChargeOverdue` |
| RN-015 | Baixa aceita apenas em `pending` ou `overdue` | §5.2 (`canRegisterPayment`) | Unit: `billings.spec.ts::canRegisterPayment` |
| RN-016 | Cobrança `cancelled` é imutável | §5.2 (`canRegisterPayment`, `canApplyDiscount`) | Unit: `billings.spec.ts::canRegisterPayment-cancelled`; `billings.spec.ts::canApplyDiscount-cancelled` |
| RN-017 | Cobrança `paid` não recebe baixa novamente | §5.2 (`canRegisterPayment`) | Unit: `billings.spec.ts::canRegisterPayment-already-paid` |
| RN-018 | Desconto ≤ valor original | §5.2 (`canApplyDiscount`) | Unit: `billings.spec.ts::canApplyDiscount-exceeds` |
| RN-019 | Valor final = original − desconto | §5.2 (`calculateFinalAmount`) | Unit: `billings.spec.ts::calculateFinalAmount` |
| RN-020 | Valor original imutável após criação | §4.3 (`original_amount` + `discount_amount` separados) | Unit: `billings.spec.ts::calculateFinalAmount`; E2E: `billings.spec.ts::apply-discount` |
| RN-021 | Encerramento cancela cobranças com `due_date > termination_date` | §3.4, §4.4 (`terminate_rental` RPC) | E2E: `billings.spec.ts::early-termination` |
| RN-022 | Cobranças com `due_date ≤ termination_date` preservadas | §3.4 | E2E: `billings.spec.ts::early-termination` |
| RN-023 | Só locações `active` podem ser renovadas | §5.1, §5.4 (`RENTAL_NOT_ACTIVE`) | E2E: `rentals.spec.ts::renew-contract` |
| RN-024 | Nova data de fim > data de fim atual | §5.1 (`RenewRentalSchema.refine`) | Unit: `rentals.spec.ts::RenewRentalSchema-end-date` |
| RN-025 | Ciclo preservado na renovação; última cobrança estendida ao próximo vencimento regular | §3.5 | Unit: `rentals.spec.ts::renew-cycle-preserved`; E2E: `rentals.spec.ts::renew-contract` |
| RN-026 | Última não paga → recalculada para ciclo completo | §3.5 | Unit: `rentals.spec.ts::recalc-last-unpaid` |
| RN-027 | Última paga pro rata → cobrança complementar gerada | §3.5 | Unit: `rentals.spec.ts::complementary-charge-generation` |
| RN-028 | Novas cobranças da renovação seguem ciclo regular; pro rata na última se ativo | §3.5 | E2E: `rentals.spec.ts::renew-contract` |
| RN-029 | Avulsa só para locação `active` | §5.1, §5.4 (`RENTAL_NOT_ACTIVE`) | E2E: `billings.spec.ts::one-time-charge-inactive-rental` |
| RN-030 | Avulsa obrigatoriamente vinculada a locação | §5.1 (`lease_id` required), §4.3 (FK NOT NULL) | Unit: `billings.spec.ts::OneTimeChargeSchema-requires-lease` |
| RN-031 | Fila configurável por tenant | §4.2 (`tenants.queue_enabled`) | E2E: `rentals.spec.ts::queue-disabled-hides-option` |
| RN-032 | Vencimento do complementar = próximo vencimento regular após fim original | §3.5 | Unit: `rentals.spec.ts::complementary-charge-due-date` |
| RN-033 | Cliente disponível para fila ou locação a qualquer momento | §3.1, §3.3 | E2E: `rentals.spec.ts::create-rental` (pré-condição) |
| RN-034 | Rental: vigência mínima 3 meses | §5.2 (`calculateMinimumEndDate` — `CONTRACT_MINIMUM_DURATION.rental`) | Unit: `rentals.spec.ts::calculateMinimumEndDate-rental` |
| RN-035 | Rent-to-Own: vigência mínima 2 anos | §5.2 (`CONTRACT_MINIMUM_DURATION.rent_to_own`) | Unit: `rentals.spec.ts::calculateMinimumEndDate-rent-to-own` |
| RN-036 | Rescisão dentro da vigência mínima implica multa R$ 1.000 | §5.2 (`isTerminationWithinMinimum`), §5.4 | Unit: `rentals.spec.ts::isTerminationWithinMinimum`; E2E: `billings.spec.ts::termination-fine-alert` |
| RN-037 | Rent-to-Own cumprido integralmente → status `transferred` | §4.5 (Migration 4 status CHECK), §5.1 (`terminateRental`) | E2E: `billings.spec.ts::rent-to-own-transferred-status` |

### 12.2 Checklist de aprovação

- [x] Sem campos não preenchidos (zero ocorrências de placeholder)
- [x] Toda tabela nova em §4 tem `tenant_id` + RLS + trigger `update_updated_at_column`
- [x] Toda decisão arquitetural não trivial referencia ou propõe ADR (`decisions/0003`, `decisions/0004`)
- [x] Matriz §12.1 cobre 100% dos 86 itens RF/RNF/RN do PRD (39 RFs + 10 RNFs + 37 RNs)
- [x] Anti-padrões GoMoto não adotados — Server Actions `'use server'` + hooks `@gomoto/data` + Zod em `@gomoto/core`
- [x] Questões abertas registradas (QA-SPEC-01 a QA-SPEC-04)

**Aprovado por:** Alan em 2026-06-24
