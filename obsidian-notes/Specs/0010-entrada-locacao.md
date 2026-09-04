---
status: aprovado
versão: 1.0
modo: lite
autor: Alan (com agente IA)
data: 2026-08-07
prd: "[[PRDs/0010-entrada-locacao]]"
related:
  - "[[Telas/Locações]]"
  - "[[Specs/0004-locacao-e-cobrancas]]"
  - "[[Specs/0008-modulo-financeiro]]"
tags:
  - spec
  - spec-lite
  - entrada-locacao
  - financeiro
---

# Spec 0010 — Entrada não reembolsável na locação

> ✅ **Status: implementado** em 2026-08-07. Derivada de [[PRDs/0010-entrada-locacao]]. Migrations aplicadas e testadas localmente (`pnpm db:reset` + smoke test SQL), unit test (`canEditDownPayment`) e 3 testes E2E reais rodando verde (`locacoes.spec.ts`, `billings-rentals.spec.ts`), fluxo completo (criação paga/pendente, edição/trava, encerramento) verificado manualmente no navegador. Bug pré-existente não relacionado corrigido no mesmo PR: `financeiro/veiculos/[id]/page.tsx` filtrava `billings` por uma coluna `vehicle_id` que não existe na tabela — bloqueava a RF-004. Detalhes em [[Telas/Locações]] §"Entrada não reembolsável".

> **Por que lite?** Um campo novo, um fluxo isolado (criação/edição de locação), reaproveitando a infraestrutura de cobrança já existente (`billings`) sem tabela nova. Sem nova persona, sem evento assíncrono, sem ADR.

---

## 1. Visão Geral Técnica

Entrada é um valor opcional, não reembolsável, informado na criação da locação. Ao contrário da Caução (que vive em `billings` + tabela `deposits` com saldo/movimentações, porque é devolvível), a Entrada não tem saldo a rastrear — é só uma cobrança (`billings`) com `billing_type='down_payment'` e `source='down_payment'`, paga na hora ou pendente. Isso significa que ela já nasce compatível com toda a infraestrutura genérica existente: pagamento via `/cobrancas` (`registerPayment`, sem alteração), listagem em "Em aberto" (filtro `billing_type !== 'cycle'`, sem alteração) e cômputo de receita do veículo (filtro `source != 'deposit'` — `down_payment` passa automaticamente, ao contrário de `deposit`).

O trabalho real está em: (1) estender a RPC `create_rental_with_charges` para inserir essa cobrança na criação; (2) corrigir `terminate_rental`, que hoje cancela qualquer cobrança pendente com vencimento futuro sem filtrar por tipo — sem o fix, uma Entrada (ou Caução) pendente com vencimento após a data de encerramento seria cancelada, violando a RN-003; (3) UI no `RentalForm` (criação e edição) e nos 4 mapas de label de tipo/origem espalhados pela tela (`billing-status.ts` + 3 páginas com mapas locais duplicados).

---

## 2. Arquitetura

- `supabase/migrations/20260807140000_add_down_payment_billing_type.sql` — novo valor de enum + CHECK constraint.
- `supabase/migrations/20260807140100_extend_create_rental_rpc_down_payment.sql` — `create_rental_with_charges` passa a aceitar e persistir a Entrada.
- `supabase/migrations/20260807140200_fix_terminate_rental_exclude_guarantee_billings.sql` — `terminate_rental` para de cancelar `deposit`/`down_payment` pendentes.
- `packages/core/src/schemas/rentals.ts` — `RentalSchema` ganha `down_payment`, `down_payment_paid`, `down_payment_payment_date`, `down_payment_due_date`.
- `packages/core/src/rules/billings.ts` — nova função pura `canEditDownPayment(status)`.
- `apps/web/src/app/(dashboard)/locacoes/actions.ts` — `createRental` passa os 4 novos parâmetros à RPC; `updateRental` ganha lógica de edição/trava da Entrada.
- `apps/web/src/app/(dashboard)/locacoes/_components/RentalForm.tsx` — novo bloco "Entrada" (separado da Caução), preview de cobranças passa a listar a Entrada, modo edição mostra somente-leitura quando já paga.
- `apps/web/src/lib/billing-status.ts` + `apps/web/src/app/(dashboard)/locacoes/[id]/(tabs)/financeiro/page.tsx` + `apps/web/src/app/(dashboard)/financeiro/veiculos/[id]/page.tsx` + `apps/web/src/app/(dashboard)/cobrancas/[id]/page.tsx` — adicionar `down_payment: 'Entrada'` aos mapas de label existentes (`BILLING_TYPE_LABEL`/`BILLING_TYPE_LABELS` e `SOURCE_LABELS`).

**Fluxo principal:** `RentalForm` (criação) → `createRental` (Server Action) → RPC `create_rental_with_charges` insere `rentals` + cobranças de ciclo + (se houver) 1 cobrança `billing_type='deposit'` + 1 cobrança `billing_type='down_payment'`, tudo na mesma transação.

**Fluxo de edição:** `RentalForm` (modo edição, só quando Entrada existe e está `pending`) → `updateRental` → `UPDATE billings` na linha de Entrada, guardado por `canEditDownPayment`.

---

## 3. Modelo de Dados

### 3.1 Mudanças

Sem tabela nova (decisão registrada: Entrada não tem saldo/devolução/retenção como a Caução — RN-001 — então o ledger de `deposits` seria complexidade sem uso). Mudanças:

- Novo valor `'down_payment'` no enum `billing_source`.
- Novo valor `'down_payment'` permitido no CHECK de `billings.billing_type`.
- `create_rental_with_charges` (RPC) ganha 4 parâmetros novos, todos com `DEFAULT`, preservando retrocompatibilidade com qualquer chamador existente.
- `terminate_rental` (RPC): mesmo parâmetro, corpo ajustado para não cancelar `deposit`/`down_payment` pendentes.

### 3.2 SQL

```sql
-- 20260807140000_add_down_payment_billing_type.sql
BEGIN;
ALTER TYPE billing_source ADD VALUE IF NOT EXISTS 'down_payment';
COMMIT;

BEGIN;
ALTER TABLE billings DROP CONSTRAINT IF EXISTS billings_billing_type_check;
ALTER TABLE billings ADD CONSTRAINT billings_billing_type_check
  CHECK (billing_type IN ('cycle', 'one_time', 'complementary', 'fine', 'deposit', 'down_payment'));
COMMIT;
```

```sql
-- 20260807140100_extend_create_rental_rpc_down_payment.sql
DROP FUNCTION IF EXISTS create_rental_with_charges(
  UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB, NUMERIC, JSONB, BOOLEAN, DATE, DATE, UUID, UUID, INTEGER
);

CREATE OR REPLACE FUNCTION create_rental_with_charges(
  p_tenant_id            UUID,
  p_vehicle_id           UUID,
  p_customer_id          UUID,
  p_cycle                TEXT,
  p_due_day              INTEGER,
  p_cycle_amount         NUMERIC,
  p_start_date           DATE,
  p_end_date             DATE,
  p_use_pro_rata         BOOLEAN,
  p_charges              JSONB,
  p_security_deposit     NUMERIC  DEFAULT NULL,
  p_late_charge_config   JSONB    DEFAULT NULL,
  p_deposit_paid         BOOLEAN  DEFAULT true,
  p_deposit_payment_date DATE     DEFAULT NULL,
  p_deposit_due_date     DATE     DEFAULT NULL,
  p_checkin_checkout_inspection_profile_id UUID    DEFAULT NULL,
  p_periodic_inspection_profile_id         UUID    DEFAULT NULL,
  p_periodic_inspection_frequency_days     INTEGER DEFAULT NULL,
  p_down_payment              NUMERIC DEFAULT NULL,
  p_down_payment_paid         BOOLEAN DEFAULT true,
  p_down_payment_payment_date DATE    DEFAULT NULL,
  p_down_payment_due_date     DATE    DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_id             UUID;
  v_deposit_billing_id    UUID;
  v_deposit_due_date      DATE;
  v_down_payment_due_date DATE;
  v_schedule_date         DATE;
BEGIN
  -- [corpo existente de rentals/charges/deposit/vehicles/inspections inalterado — ver
  --  20260730120400_extend_create_rental_rpc_inspections.sql]

  IF p_down_payment IS NOT NULL THEN
    v_down_payment_due_date := CASE
      WHEN p_down_payment_paid THEN COALESCE(p_down_payment_payment_date, p_start_date)
      ELSE COALESCE(p_down_payment_due_date, p_start_date)
    END;

    INSERT INTO billings (
      tenant_id, lease_id, customer_id,
      original_amount, due_date, billing_type, source, status,
      description, paid_at
    ) VALUES (
      p_tenant_id, v_lease_id, p_customer_id,
      p_down_payment, v_down_payment_due_date, 'down_payment', 'down_payment',
      CASE WHEN p_down_payment_paid THEN 'paid' ELSE 'pending' END,
      'Entrada',
      CASE WHEN p_down_payment_paid THEN COALESCE(p_down_payment_payment_date, p_start_date) END
    );
  END IF;

  RETURN v_lease_id;
END;
$$;
```

```sql
-- 20260807140200_fix_terminate_rental_exclude_guarantee_billings.sql
CREATE OR REPLACE FUNCTION terminate_rental(
  p_tenant_id        UUID,
  p_lease_id         UUID,
  p_termination_date DATE,
  p_new_status       TEXT DEFAULT 'closed'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id UUID;
BEGIN
  SELECT vehicle_id INTO v_vehicle_id
  FROM rentals
  WHERE id = p_lease_id AND tenant_id = p_tenant_id AND status = 'active';

  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'RENTAL_NOT_ACTIVE';
  END IF;

  -- Cancelar cobranças futuras pendentes — exceto garantias (RN-003 do PRD 0010:
  -- Entrada pendente sobrevive ao encerramento antecipado; Caução tinha o mesmo
  -- risco latente e foi corrigida junto).
  UPDATE billings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE lease_id     = p_lease_id
    AND tenant_id    = p_tenant_id
    AND due_date     > p_termination_date
    AND status       = 'pending'
    AND billing_type NOT IN ('deposit', 'down_payment');

  UPDATE rentals
  SET status     = p_new_status,
      end_date   = p_termination_date,
      updated_at = now()
  WHERE id = p_lease_id AND tenant_id = p_tenant_id;

  UPDATE vehicles
  SET status     = 'available',
      updated_at = now()
  WHERE id = v_vehicle_id AND tenant_id = p_tenant_id;
END;
$$;
```

---

## 4. APIs

### 4.1 Server Actions

- `createRental(data: CreateRental)` — já existe; passa a repassar `down_payment`, `down_payment_paid`, `down_payment_payment_date`, `down_payment_due_date` para a RPC.
- `updateRental(leaseId, data: Pick<CreateRental, 'observations' | 'security_deposit' | 'down_payment' | 'down_payment_due_date'>)` — já existe; ganha novo bloco:

```ts
if (data.down_payment != null) {
  const { data: dp } = await supabase
    .from('billings')
    .select('id, status')
    .eq('lease_id', leaseId)
    .eq('tenant_id', tenantId)
    .eq('billing_type', 'down_payment')
    .maybeSingle()

  if (dp) {
    const check = canEditDownPayment(dp.status)
    if (!check.ok) {
      return { ok: false, error: { code: check.errorCode, message: 'Entrada já paga não pode ser alterada.' } }
    }
    await supabase
      .from('billings')
      .update({ original_amount: data.down_payment, due_date: data.down_payment_due_date ?? undefined })
      .eq('id', dp.id)
      .eq('tenant_id', tenantId)
  }
  // dp inexistente: RN-002 — Entrada só é definida na criação; edição nunca cria uma nova.
}
```

### 4.2 Schema Zod

```ts
// packages/core/src/schemas/rentals.ts — dentro de RentalSchema
down_payment:              z.number().min(0).nullable().optional(),
// Default true — mesmo racional do deposit_paid: preserva o caso comum
// (entrada recebida em dinheiro na assinatura).
down_payment_paid:         z.boolean().default(true),
down_payment_payment_date: dateString.optional(),
down_payment_due_date:     dateString.optional(),
```

### 4.3 Erros relevantes

| Código | Quando |
|---|---|
| `VALIDATION_ERROR` | Payload não passa no Zod (`RentalSchema`) |
| `DOWN_PAYMENT_ALREADY_PAID` | Tentativa de editar valor/vencimento de Entrada com `status='paid'` (defesa em profundidade — UI já esconde o campo, mas a action valida de novo) |
| `UNAUTHORIZED` | Sessão ausente ou tenant não resolvido (padrão já existente) |

---

## 5. Segurança

- **AuthN:** Supabase Auth via `createClient()` + `getUser()` — igual às demais Server Actions de `locacoes/actions.ts`.
- **AuthZ:** tenant resolvido server-side via `getCurrentTenantId(supabase)`; toda leitura/escrita em `billings` filtra `.eq('tenant_id', tenantId)`.
- **RLS:** `billings` já tem RLS multi-tenant existente (`get_user_tenants()`) — nenhuma política nova, pois não há tabela nova.

---

## 6. Test Strategy

- **Unit (Vitest, `packages/core`):** `packages/core/src/rules/billings.test.ts::canEditDownPayment` — cenários: `'pending'` → `{ ok: true }`; `'paid'` → `{ ok: false, errorCode: 'DOWN_PAYMENT_ALREADY_PAID' }`; `'cancelled'` → `{ ok: false, errorCode: 'BILLING_CANCELLED' }`.
- **E2E (Playwright, `apps/web`):**
  - Novo teste em `apps/web/tests/locacoes.spec.ts` — operador cria locação com Entrada já paga (nasce recebida, sem cobrança aberta, soma na receita do veículo) e com Entrada pendente (gera cobrança em aberto, aparece no preview de cobranças e no extrato financeiro).
  - Estende `apps/web/tests/billings-rentals.spec.ts::"encerramento antecipado cancela cobranças futuras e preserva vencidas e pagas"` — adiciona asserção de que Entrada e Caução pendentes com vencimento futuro sobrevivem ao encerramento antecipado (RN-003).

Integration/Contract: N/A no modo lite.

---

## 7. Deploy e Rollback

Ordem: aplicar as 3 migrations (enum/check → RPC de criação → RPC de encerramento) antes do deploy do app — todos os parâmetros novos têm `DEFAULT`, então chamadores antigos continuam funcionando sem alteração. Rollback: recriar as duas RPCs na versão anterior (`DROP FUNCTION` + `CREATE OR REPLACE` com a assinatura de 18/4 parâmetros já versionada nas migrations anteriores); o valor de enum `'down_payment'` não precisa ser removido — ficar órfão não bloqueia nada. Sem feature flag: reverter os commits de UI já impede a criação de novas Entradas; Entradas já criadas continuam no banco como `billings` normais.

---

## 8. Matriz de Rastreabilidade e Aprovação

### 8.1 Matriz

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RF-001 | Registrar valor de Entrada (opcional) na criação | §3.2 (RPC `p_down_payment` opcional), §4.2 (`down_payment` opcional no Zod), §2 (bloco no `RentalForm`) | E2E: `locacoes.spec.ts::entrada na criação` |
| RF-002 | Indicar se Entrada já foi paga ou está pendente | §3.2 (branch `p_down_payment_paid` na RPC), §4.2 (`down_payment_paid`/`_payment_date`/`_due_date`) | E2E: `locacoes.spec.ts::entrada na criação` |
| RF-003 | Exibir Entrada no preview de cobranças e no extrato financeiro | §2 (merge no preview do `RentalForm`), §3 (linha em `billings` já visível no extrato genérico existente) | E2E: `locacoes.spec.ts::entrada na criação` |
| RF-004 | Contabilizar Entrada como receita recebida do veículo | §3.1 (`source='down_payment'`, distinto de `'deposit'` — inclusão automática no filtro `.neq('source','deposit')` de `financeiro/veiculos/[id]/page.tsx`) | E2E: `locacoes.spec.ts::entrada na criação` (assert receita do veículo) |
| RF-005 | Permitir corrigir a Entrada enquanto pendente; travar após paga | §4.1 (`updateRental` + `canEditDownPayment`), §4.3 (`DOWN_PAYMENT_ALREADY_PAID`) | Unit: `billings.test.ts::canEditDownPayment`; E2E: `locacoes.spec.ts::entrada na criação` (edição) |
| RN-001 | Entrada não é reembolsável — sem obrigação de devolução | §3.1 (decisão de não criar tabela de ledger, ao contrário de `deposits`) | N/A — decisão de modelo de dados, sem cenário de teste isolado |
| RN-002 | No máximo 1 Entrada por locação, definida na criação | §4.1 (`updateRental` nunca insere uma nova linha de Entrada, só edita a existente) | N/A — garantido estruturalmente pela ausência de branch de criação em `updateRental`; sem cenário de teste isolado |
| RN-003 | Entrada pendente não é cancelada automaticamente no encerramento antecipado | §3.2 (fix em `terminate_rental`) | E2E: `billings-rentals.spec.ts::encerramento antecipado cancela cobranças futuras e preserva vencidas e pagas` (estendido) |

> Cobertura: 100% (5 RF + 3 RN = 8 itens do PRD, todos mapeados). RNF: nenhum no PRD.

### 8.2 Checklist de aprovação

- [x] Sem `<!-- preencher -->` remanescente
- [x] Nenhuma tabela nova em §3 (logo, sem checklist de `tenant_id`/RLS/trigger a aplicar — `billings` já os tem)
- [x] Matriz §8.1 cobre 100% dos itens do PRD
- [x] Sem anti-padrões (`actions.ts` morto, `createClient()` em `page.tsx`, lógica em UI handler, Zod duplicado)

**Aprovado por:** Alan em 2026-08-07
