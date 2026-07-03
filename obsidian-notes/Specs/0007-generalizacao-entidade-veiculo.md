---
status: aprovado
versão: 1.0
modo: lite
autor: Alan (com agente IA)
data: 2026-07-01
prd: "[[PRDs/0007-generalizacao-entidade-veiculo]]"
adr:
  - "[[decisions/0012-generalizacao-motorcycle-para-vehicle]]"
related:
  - "[[Banco de Dados]]"
  - "[[Arquitetura Proposta]]"
tags:
  - spec
  - spec-lite
  - generalizacao-entidade-veiculo
  - veiculos
---

# Spec 0007 — Generalização da Entidade Veículo (motorcycle → vehicle)

> ✅ **Status: aprovado** (modo lite) em 2026-07-01. Derivada de [[PRDs/0007-generalizacao-entidade-veiculo]]. Próximo passo: criar ADR 0012 → migration → core → data → web/mobile.

> **Por que lite?** Renomeação pura sem nova lógica de negócio. Amplitude grande (~30 arquivos, 4 camadas), mas sem complexidade vertical — sem evento async, worker, ADR de trade-off ou RNF de latência.

---

## 1. Visão Geral Técnica

Substituição da entidade `motorcycle` por `vehicle` como nome canônico em todas as camadas do sistema. O trabalho é estritamente uma renomeação em cascata — sem novos endpoints, sem nova lógica e sem mudança de comportamento funcional.

Camadas afetadas, em ordem de implementação: (1) banco de dados — migration transacional que renomeia tabela, FKs e views; (2) `@gomoto/core` — tipos TypeScript, schemas Zod e função pura; (3) `@gomoto/data` — hooks e repositórios; (4) `apps/web` — diretório de rota, Sidebar, componente, referências internas e redirect permanente; (5) `apps/mobile` — rótulos de UI; (6) testes E2E e seed.

---

## 2. Arquitetura

Componentes novos/modificados:

- `supabase/migrations/<ts>_rename_motorcycle_to_vehicle.sql` — migration transacional (nova)
- `packages/core/src/types/index.ts` — 5 tipos/interfaces renomeados; todos os campos `motorcycle_id` → `vehicle_id`; `motorcycle_license_plate` → `vehicle_license_plate`; `motorcycle_model` → `vehicle_model`
- `packages/core/src/schemas/index.ts` — `MotorcycleSchema` → `VehicleSchema`; campos `motorcycle_id` → `vehicle_id` em 4 schemas dependentes
- `packages/core/src/rules/motorcycles.ts` → `vehicles.ts` — renomear arquivo, interface `MotorcycleIdleInput` → `VehicleIdleInput`, função `isIdleMotorcycle` → `isIdleVehicle`
- `packages/core/src/rules/index.ts` — atualizar re-export
- `packages/data/src/hooks/useMotorcycles.ts` → `useVehicles.ts`
- `packages/data/src/hooks/useMotorcycleCosts.ts` → `useVehicleCosts.ts`
- `packages/data/src/repositories/motorcycles.ts` → `vehicles.ts`
- `packages/data/src/repositories/motorcycleCosts.ts` → `vehicleCosts.ts`
- `packages/data/src/hooks/index.ts` + `repositories/index.ts` — re-exports atualizados
- `apps/web/src/app/(dashboard)/motos/` → `veiculos/` — renomear diretório (page.tsx + actions.ts); referências internas atualizadas
- `apps/web/src/components/MotorcycleMap.tsx` → `VehicleMap.tsx`
- `apps/web/src/components/layout/Sidebar.tsx` — label "Motos" → "Veículos", href `/motos` → `/veiculos`
- `apps/web/next.config.mjs` — adicionar `async redirects()` permanente `/motos/:path*` → `/veiculos/:path*`
- `apps/web/src/app/(dashboard)/locacoes/actions.ts` — 2× `revalidatePath('/motos')` → `/veiculos`
- Demais pages/actions (contratos, manutencao, multas, despesas, entradas, aprovacoes, dashboard, admin) — todas as referências `motorcycle`/`Motorcycle` → `vehicle`/`Vehicle`
- `apps/mobile/src/components/RegisterMaintenanceModal.tsx` — rótulos de UI
- `apps/mobile/src/screens/BillingsScreen.tsx` — rótulos de UI
- `apps/web/tests/motos.spec.ts` → `veiculos.spec.ts` + atualizar `locacoes.spec.ts`, `billings-rentals.spec.ts`, `helpers.ts`
- `supabase/seed.sql` — inserções na tabela `motorcycles` → `vehicles`

**Fluxo de implementação (ordem obrigatória):**

```
migration → @gomoto/core → @gomoto/data → apps/web + apps/mobile → testes
```

Cada camada só compila após a anterior estar correta (`pnpm build` falha em cascata se `core` ou `data` tiver tipo quebrado).

---

## 3. Modelo de Dados

### 3.1 Mudanças

Não há tabela nova. A migration: (a) renomeia `motorcycles` → `vehicles`; (b) renomeia colunas FK `motorcycle_id` → `vehicle_id` em tabelas dependentes; (c) recria as duas views de custo com nomes e referências atualizados; (d) recria a política RLS com nome legível. Migrations históricas são imutáveis (RN-006).

### 3.2 SQL

```sql
-- supabase/migrations/<ts>_rename_motorcycle_to_vehicle.sql
BEGIN;

-- Passo 1: dropar views dependentes ANTES de renomear colunas
-- (as views referenciam colunas que serão renomeadas a seguir)
DROP VIEW IF EXISTS motorcycle_financial_events;
DROP VIEW IF EXISTS motorcycle_cost_summary;

-- Passo 2: renomear tabela central
ALTER TABLE motorcycles RENAME TO vehicles;

-- Passo 3: renomear trigger para consistência de nomenclatura
ALTER TRIGGER trg_motorcycles_updated_at ON vehicles
  RENAME TO trg_vehicles_updated_at;

-- Passo 4: renomear colunas FK em tabelas dependentes
ALTER TABLE vehicle_documents   RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE vehicle_obligations RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE billings            RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE maintenances        RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE fines               RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE expenses            RENAME COLUMN motorcycle_id TO vehicle_id;
ALTER TABLE maintenance_records RENAME COLUMN motorcycle_id TO vehicle_id; -- validar: pode não existir no schema atual
ALTER TABLE maintenance_plans   RENAME COLUMN motorcycle_id TO vehicle_id; -- validar: pode não existir no schema atual

-- Passo 5: recriar view de TCO (vehicle_cost_summary)
-- WITH (security_invoker = true) é obrigatório: sem ele a view executa com permissões
-- do owner (BYPASSRLS) e expõe dados de todos os tenants, quebrando o isolamento.
CREATE OR REPLACE VIEW vehicle_cost_summary
WITH (security_invoker = true) AS
SELECT
    v.id                                                                                         AS vehicle_id,
    v.tenant_id,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0)                                  AS obligations_paid,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('pending', 'overdue')), 0)                 AS obligations_due,
    COALESCE(SUM(mt.cost)  FILTER (WHERE mt.completed = true), 0)                                AS maintenance_cost,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'company' AND f.status = 'paid'), 0)    AS fines_company_paid,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'customer' AND f.status = 'paid'), 0)   AS fines_customer_paid,
    COALESCE(SUM(e.amount) FILTER (WHERE e.payment_status = 'paid'), 0)                          AS expenses_paid
FROM vehicles v
LEFT JOIN vehicle_obligations o ON o.vehicle_id = v.id
LEFT JOIN maintenances        mt ON mt.vehicle_id = v.id
LEFT JOIN fines               f  ON f.vehicle_id = v.id
LEFT JOIN expenses            e  ON e.vehicle_id = v.id
GROUP BY v.id, v.tenant_id;

COMMENT ON VIEW vehicle_cost_summary IS
    'PRD 0007: agregado de custo por veículo. security_invoker=true garante isolamento de tenant via RLS das tabelas base.';

-- Passo 6: recriar view de eventos financeiros (vehicle_financial_events)
CREATE OR REPLACE VIEW vehicle_financial_events
WITH (security_invoker = true) AS
SELECT
    o.id                                                         AS event_id,
    o.tenant_id,
    o.vehicle_id,
    'obligation'::TEXT                                           AS source,
    o.type::TEXT                                                 AS subtype,
    COALESCE(o.description, o.type || ' ' || o.reference_year)  AS description,
    o.amount,
    o.due_date                                                   AS event_date,
    o.paid_at,
    o.status::TEXT                                               AS status,
    o.receipt_url                                                AS attachment_url
FROM vehicle_obligations o
UNION ALL
SELECT
    mt.id, mt.tenant_id, mt.vehicle_id,
    'maintenance'::TEXT, mt.type::TEXT, mt.description,
    mt.cost,
    COALESCE(mt.completed_date, mt.scheduled_date),
    mt.completed_date,
    CASE WHEN mt.completed THEN 'paid' ELSE 'pending' END,
    mt.invoice_photo_url
FROM maintenances mt
WHERE mt.cost IS NOT NULL
UNION ALL
SELECT
    f.id, f.tenant_id, f.vehicle_id,
    'fine'::TEXT, f.responsible::TEXT, f.description,
    f.amount, f.infraction_date, f.payment_date, f.status::TEXT, f.ticket_url
FROM fines f
UNION ALL
SELECT
    e.id, e.tenant_id, e.vehicle_id,
    'expense'::TEXT, e.category::TEXT, e.description,
    e.amount, e.date, e.paid_at, e.payment_status::TEXT,
    NULL::TEXT AS attachment_url
FROM expenses e
WHERE e.vehicle_id IS NOT NULL;

COMMENT ON VIEW vehicle_financial_events IS
    'PRD 0007: linha por evento financeiro do veículo. security_invoker=true garante isolamento de tenant via RLS das tabelas base.';

-- Passo 7: recriar política RLS com nome atualizado
-- (a política original segue o rename automaticamente, mas o nome de string fica desatualizado)
DROP POLICY IF EXISTS "Authenticated users can access motorcycles" ON vehicles;
CREATE POLICY "Authenticated users can access vehicles"
    ON vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- RLS já estava habilitada na tabela e segue o rename automaticamente

COMMIT;
```

---

## 4. APIs

### 4.1 Endpoints / Server Actions

Nenhum endpoint novo. Os server actions de `app/(dashboard)/motos/actions.ts` são movidos para `app/(dashboard)/veiculos/actions.ts` com referências internas atualizadas. Assinatura e comportamento são idênticos.

Redirect permanente (RF-001) adicionado em `apps/web/next.config.mjs`:

```js
// Adicionar ao objeto nextConfig, junto com headers()
async redirects() {
  return [
    {
      source: '/motos/:path*',
      destination: '/veiculos/:path*',
      permanent: true, // HTTP 308
    },
  ]
},
```

### 4.2 Schemas Zod

Renomeações em `packages/core/src/schemas/index.ts` (sem campo novo):

```ts
// ANTES                               → DEPOIS
MotorcycleSchema                       → VehicleSchema          // mesmo shape
MaintenanceSchema.motorcycle_id        → .vehicle_id
FineSchema.motorcycle_id               → .vehicle_id
ContractSchema.motorcycle_id           → .vehicle_id
ExpenseSchema.motorcycle_id (nullable) → .vehicle_id (nullable)
```

Renomeações em `packages/core/src/types/index.ts`:

```ts
// ANTES                               → DEPOIS
Motorcycle                             → Vehicle
MotorcycleStatus                       → VehicleStatus
MotorcycleCostSummary.motorcycle_id    → VehicleCostSummary.vehicle_id
MotorcycleFinancialEventSource         → VehicleFinancialEventSource
MotorcycleFinancialEvent.motorcycle_id → VehicleFinancialEvent.vehicle_id
RentalPeriod.motorcycle_license_plate  → .vehicle_license_plate
RentalPeriod.motorcycle_model          → .vehicle_model
Contract.motorcycle_id                 → .vehicle_id
Contract.motorcycle (tipo Motorcycle)  → .vehicle (tipo Vehicle)
```

Renomeações em `packages/core/src/rules/vehicles.ts` (renomeado de `motorcycles.ts`):

```ts
// ANTES                               → DEPOIS
MotorcycleIdleInput                    → VehicleIdleInput
isIdleMotorcycle(moto, ...)            → isIdleVehicle(vehicle, ...)
```

### 4.3 Erros relevantes

Sem código de erro novo. Erros existentes (`VALIDATION_ERROR`, `FORBIDDEN`) mantêm comportamento idêntico.

---

## 5. Segurança

- **AuthN:** Supabase Auth — sem mudança. Server actions continuam exigindo sessão autenticada.
- **AuthZ:** `getCurrentTenantId(supabase)` em todas as actions — sem mudança.
- **RLS:** A política `FOR ALL TO authenticated` é recriada explicitamente em `vehicles` na migration (§3.2, passo 7). O isolamento de tenant é garantido pela coluna `tenant_id UUID NOT NULL` herdada da renomeação, combinada com a camada de aplicação (`getCurrentTenantId`). Todo o rename ocorre em transação única — sem janela de exposição entre DROP e CREATE da política. As views recriadas com `WITH (security_invoker = true)` mantêm o isolamento de tenant via RLS das tabelas base.

---

## 6. Test Strategy

- **Unit (Vitest, `packages/core`):**
  - Renomear `packages/core/src/rules/motorcycles.test.ts` → `vehicles.test.ts`; adaptar todos os cenários:
    - `isIdleVehicle` com `status: 'available'` + `updated_at` há 8 dias → `true`
    - `isIdleVehicle` com `status: 'rented'` → `false`
    - `isIdleVehicle` com `updated_at` ontem → `false`

- **E2E (Playwright, `apps/web/tests/`):**
  - Renomear `motos.spec.ts` → `veiculos.spec.ts`; atualizar rotas `/motos` → `/veiculos` e textos "moto" → "veículo"
  - Cenas obrigatórias:
    - Menu lateral exibe "Veículos"; "Motos" ausente (CA-002)
    - GET `/motos` retorna 308 redirecionando para `/veiculos` (CA-001)
    - CRUD básico em `/veiculos` sem regressão (CA-003, CA-004)
  - Atualizar `locacoes.spec.ts`, `billings-rentals.spec.ts`, `helpers.ts` — rotas e asserções de texto
  - Mobile: sem testes automatizados — validação manual das cenas CA-007 a CA-010 após build

Integration/Contract: N/A no modo lite.

---

## 7. Deploy e Rollback

**Ordem obrigatória:**

1. `pnpm db:reset` localmente — validar migration sem erros
2. `supabase db push` — controlado pelo humano, com confirmação explícita
3. `pnpm build` — confirmar zero erros de tipo em todos os pacotes
4. Deploy `apps/web` + `apps/mobile`

**Rollback:**

Down migration natural: `ALTER TABLE vehicles RENAME TO motorcycles` + rename das colunas FK de volta + recriar views antigas. Criar `<ts>_rollback_rename_vehicle.sql` antes de qualquer push. Sistema pré-produção: rollback de baixo risco.

---

## 8. Matriz de Rastreabilidade e Aprovação

### 8.1 Matriz

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RF-001 | Redirect `/motos` → `/veiculos` | §4.1 (`next.config.mjs`) | E2E: `veiculos.spec.ts::redirect-motos-to-veiculos` |
| RF-002 | Menu lateral: "Veículos" em `/veiculos` | §2 (`Sidebar.tsx`) | E2E: `veiculos.spec.ts::menu-item-veiculos` |
| RF-003 | Tela `/veiculos`: terminologia "veículo/veículos" | §2 (`veiculos/page.tsx`) | E2E: `veiculos.spec.ts::listagem-terminologia` |
| RF-004 | Formulário: rótulos genéricos → "veículo" | §2 (`veiculos/page.tsx`) | E2E: `veiculos.spec.ts::form-rotulos-genericos` |
| RF-005 | Telas relacionadas: rótulos genéricos → "veículo" | §2 (múltiplas pages/actions) | E2E: `locacoes.spec.ts`, `billings-rentals.spec.ts` (atualização de texto) |
| RF-006 | Mobile: rótulo "KM atual do veículo" | §2 (`RegisterMaintenanceModal.tsx`) | Manual: CA-007 |
| RF-007 | Mobile: subtítulo, vazio e fallback → "veículo" | §2 (`BillingsScreen.tsx`) | Manual: CA-008, CA-009, CA-010 |
| RF-008 | Entidade canônica "vehicle" — nenhum artefato "motorcycle" | §2 (todas camadas), §3 (migration), §4.2 (schemas) | CI: `pnpm build` sem erros; `grep -r motorcycle packages/ apps/` → 0 resultados |
| RF-009 | Módulos dependentes referenciam "vehicle"; sem mudança funcional | §3 (FKs renomeadas), §4.2 (schemas) | E2E: `locacoes.spec.ts`, `billings-rentals.spec.ts` funcionais |
| RNF-001 | Sem perda de dados | §3.2 (migration transacional com `BEGIN/COMMIT`) | DB: `pnpm db:reset` + contagem de registros antes/depois |
| RNF-002 | Integridade referencial preservada | §3.2 (FK `RENAME COLUMN`, constraints mantidas) | DB: `pnpm db:reset` sem erros de FK |
| RNF-003 | Isolamento de tenant mantido | §5 (RLS recriada; views com `security_invoker=true`) | E2E: testes multi-tenant existentes |
| RNF-004 | `pnpm build` sem erros | §2 (ordem core → data → web/mobile) | CI: `pnpm build` |
| RNF-005 | Testes E2E passam após generalização | §6 (specs atualizados) | E2E: `pnpm --filter web test:e2e` |
| RNF-006 | Sem regressão de performance | N/A — rename puro sem mudança de query plan | N/A — sem target de latência no PRD |
| RN-001 | `vehicle` substitui `motorcycle` totalmente; sem coexistência | §3.2 (migration única), §4.2 (sem alias de compatibilidade) | CI: `grep -r motorcycle packages/ apps/` → 0 resultados |
| RN-002 | Regras preservadas sem alteração semântica | §4.2 (schemas idênticos), §6 (mesmos cenários de teste) | Unit: `vehicles.test.ts` (mesmos cenários de `motorcycles.test.ts`) |
| RN-003 | Placa única por tenant | §3.2 (constraint `UNIQUE` herdada do rename — não afetada) | DB: constraint ativa após `pnpm db:reset` |
| RN-004 | Renomeação pura — sem nova lógica | §1 (escopo declarado), sem RF novo na Spec | N/A — ausência verificável: Spec não introduz função ou regra nova |
| RN-005 | Nome "GoMoto" não afetado | N/A — fora do escopo de código | N/A — verificação visual |
| RN-006 | Migrations históricas imutáveis | §3.2 (arquivo novo; histórico intocado) | N/A — por convenção do projeto (CLAUDE.md) |

### 8.2 Checklist de aprovação

- [x] Sem `<!-- preencher -->` remanescente
- [x] Toda tabela/campo novo em §3 respeita `tenant_id` + RLS + trigger `updated_at` (N/A — rename, não tabela nova)
- [x] Matriz §8.1 cobre 100% dos itens do PRD (9 RFs + 6 RNFs + 6 RNs = 21 itens)
- [x] Sem anti-padrões (`actions.ts` morto, `createClient()` em `page.tsx`, lógica em UI, Zod duplicado)

**Aprovado por:** Alan em 2026-07-01
