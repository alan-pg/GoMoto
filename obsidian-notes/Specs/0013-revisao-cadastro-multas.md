---
status: aprovado
versão: 1.1
modo: lite
autor: Alan (com agente IA)
data: 2026-08-10
prd: "[[PRDs/0013-revisao-cadastro-multas]]"
related:
  - "[[Banco de Dados]]"
  - "[[Telas/Multas]]"
tags:
  - spec
  - spec-lite
  - revisao-cadastro-multas
  - financeiro
---

# Spec 0013 — Revisão do Cadastro de Multas (NA/NP)

> 🟢 **Status: aprovado v1.1** (modo lite) em 2026-08-11. Derivada de [[PRDs/0013-revisao-cadastro-multas]] v1.1. Implementado e validado ao vivo.
>
> **v1.1 (2026-08-11)** — atualização pós-implementação pra refletir o estado real do código, revisada seção a seção:
> - §3/§4.2: schema corrigido (RN-002 removida do `.refine()`, `infraction_code`/`source`/`ticket_url` fora, +16 colunas da NA que entraram depois da v1.0, `FineUpdateSchema` removida — hoje é um único `z.object()`).
> - §2: `findFineByRenainfOrAit` nunca existiu em `packages/data` na prática — foi inlined como `findDuplicateFine` direto na Server Action (bug de boundary Server/Client, ver §11.4). Fluxo Placa→Locação→Cliente documentado (redesenho que não estava na v1.0).
> - Nova §4.4: `syncFineBilling` (RF-011 do PRD) — geração/cancelamento automático de cobrança a partir do responsável pelo pagamento.
> - §8.1: matriz de rastreabilidade ganhou RF-011.

> **Por que lite?** Feature pequena — fica toda dentro da entidade Multa já existente, sem tabela nova, sem worker/evento assíncrono, sem ADR necessária.

---

## 1. Visão Geral Técnica

Estende o cadastro de multa pra refletir os dois documentos oficiais do processo brasileiro (NA/NP): novos campos em `fines` (prazos legais, RENAINF, condutor identificado, código SENATRAN, órgão por extenso, dados de velocidade/equipamento/agente, município/UF), extração por IA ampliada e restrita à NA, detecção de duplicidade por RENAINF/AIT, remoção do quick-fill de infrações, um indicador de "condutor não identificado" reaproveitando o sistema de anexos já existente, vínculo Placa→Locação→Cliente (em vez de cliente solto), e geração automática de cobrança a partir do responsável pelo pagamento (RF-011, integra com `billings`). Não cria tabela nova em `fines`/multas — `billings` já existia (módulo financeiro); tudo em `packages/core`, `apps/web/.../multas/*` e migrations aditivas.

---

## 2. Arquitetura

- `packages/core/src/schemas/index.ts` — `FineSchema` é um único `z.object()` com todos os campos da NA/NP + `responsible` obrigatório (`z.enum(['customer','company'])`, sem `.optional()`). **Sem `.refine()`** — RN-002 foi revogada, não há mais validação condicional de RENAINF; `updateFine` usa `FineSchema.partial()` direto (não existe `FineUpdateSchema` separada).
- `packages/core/src/rules/fines.ts` **(novo)** — `calcFineUrgency` (RF-008, hoje inline em `page.tsx` — anti-padrão pré-existente que esta Spec corrige de passagem) e `isDriverUnidentified` (RF-010) como funções puras.
- `packages/core/src/document-extraction/registry.ts` + `prompts.ts` — estende `FineNoticeFieldsSchema` e `buildFineNoticePrompt` com os campos da NA (30 ao todo, ver §3.1); remove `due_date` do conjunto extraído (a NA não tem esse campo — ver §11).
- `apps/web/src/app/(dashboard)/multas/_components/FineForm.tsx` — remove `COMMON_INFRACTIONS`/quick-fill; adiciona os campos novos; relabela o slot de upload da extração como "NA"; seleção de veículo/locação/cliente em cascata (Placa→Locação→Cliente, `customer_id` derivado, nunca selecionado direto); campo "Responsável pelo pagamento" obrigatório sem default; sinalização visual (`Sparkles`) nos campos preenchidos pela extração.
- `apps/web/src/app/(dashboard)/multas/[id]/_components/FineAttachments.tsx` — badge "condutor não identificado" acima da lista, usando `isDriverUnidentified`.
- `apps/web/src/app/(dashboard)/multas/actions.ts` — `createFine` valida duplicidade antes do insert (via `findDuplicateFine`, função privada — **não** vem de `@gomoto/data`, ver §11.4); `extractFineNoticeFields` roda a mesma checagem e retorna `duplicateOf`; `syncFineBilling` (privada) gera/atualiza/cancela a cobrança vinculada, chamada por `createFine`/`updateFine` (§4.4).
- `apps/web/src/app/(dashboard)/multas/page.tsx` — passa a chamar `calcFineUrgency` de `@gomoto/core` em vez da função local.
- `supabase/migrations/` — `20260810120000_fines_na_np_fields.sql` (11 colunas iniciais + índice único), `20260810130000_drop_fines_infraction_code.sql`, `20260810140000_fines_payment_slip_attachment.sql`, `20260810150000_drop_fines_source.sql`, `20260811100000_fines_extra_na_fields.sql` (+16 colunas), `20260811110000_fines_responsible_required.sql` (`responsible` `NOT NULL` sem `DEFAULT`).

**Fluxo principal:** FineForm (Placa → Locação → Cliente derivado; upload NA) → `extractFineNoticeFields` (extração + checagem de duplicata) → operador revisa/ajusta e declara o responsável pelo pagamento → `createFine` (revalida duplicata, roda `syncFineBilling`, insere) → DB (+ cobrança em `billings` se responsável for o cliente).

---

## 3. Modelo de Dados

### 3.1 Mudanças

`fines` ganhou campos em 5 migrations sucessivas (v1.0 tinha só a primeira leva; as demais entraram durante a revisão pós-implementação, v1.1). Nenhuma tabela nova nasce em `fines`; `fine_attachments` não muda — já cobre NA/`ait`, NP/`nip`, Boleto/`payment_slip`, indicação de condutor/`driver_indication`.

**Adicionados:**

| Campo | Tipo | Observação |
|---|---|---|
| `renainf_number` | `VARCHAR(30)` | Único por tenant quando informado (RN-001). **Sempre opcional** (RN-002 revogada — v1.1) |
| `original_renainf_number` | `VARCHAR(30)` | RENAINF da multa original, se esta notificação for reemissão |
| `notification_date` | `DATE` | Data da notificação (NA ou NP) |
| `prior_defense_deadline` | `DATE` | Prazo de defesa prévia (NA) |
| `driver_identification_deadline` | `DATE` | Prazo de identificação do condutor (NA) |
| `appeal_deadline` | `DATE` | Prazo de recurso (NP) |
| `discounted_payment_deadline` | `DATE` | Vencimento com desconto (NP) — distinto do `due_date` genérico já existente |
| `senatran_infraction_code` / `senatran_infraction_subcode` | `VARCHAR(20)` / `VARCHAR(10)` | Código oficial SENATRAN (ex.: `7455`) e desdobramento |
| `issuing_agency_name` / `issuing_agency_code` | `VARCHAR(200)` / `VARCHAR(20)` | Órgão autuador por extenso + código — **substitui** o antigo `source` (enum), removido (v1.1) |
| `competent_agency_name` / `competent_agency_code` | `VARCHAR(200)` / `VARCHAR(20)` | Órgão competente pelo julgamento, quando diferente do autuador |
| `driver_name` / `driver_cnh` / `driver_cpf` / `driver_document` | `VARCHAR` | Condutor já identificado no documento |
| `infraction_time` | `TIME` | Hora da infração (complementa `infraction_date`) |
| `measurement_instrument_id` / `traffic_agent_id` | `VARCHAR(50)` | Rastreabilidade pra recurso |
| `measured_speed` / `considered_speed` / `speed_limit` | `DECIMAL(6,2)` | Só infração de velocidade |
| `infraction_municipality_code` / `infraction_municipality_name` / `infraction_state` | `VARCHAR(10)` / `VARCHAR(100)` / `VARCHAR(2)` | Frota opera em cidades diferentes — local estruturado, não só texto livre |
| `senatran_message` | `TEXT` | Aviso legal do órgão, quando presente no documento |
| `responsible` | `VARCHAR(20)` | **v1.1** — passa de opcional (`customer`\|`company`, sem default) pra **`NOT NULL`, sem `DEFAULT`** (RF-011). Decide se a multa gera cobrança pro cliente. |

**Removidos** (v1.1, decisão pós-implementação revendo os documentos reais):

| Campo | Motivo |
|---|---|
| `infraction_code` | Artigo do CTB (ex. `218-II`) — nenhum dos documentos reais analisados trazia; `senatran_infraction_code` (numérico) já cobre a necessidade |
| `source` | Enum `detran`/`cetran`/`municipal`/`private_area`/`other` — nunca era preenchido pela extração, virou select morto; `issuing_agency_name` (texto livre) já resolve |
| `ticket_url` | Link digitado à mão, não um arquivo de verdade — substituído pelo anexo real `payment_slip` em `fine_attachments` |

### 3.2 SQL (histórico das migrations)

```sql
-- 20260810120000_fines_na_np_fields.sql — leva inicial (v1.0)
ALTER TABLE fines
    ADD COLUMN renainf_number VARCHAR(30), ADD COLUMN notification_date DATE,
    ADD COLUMN prior_defense_deadline DATE, ADD COLUMN driver_identification_deadline DATE,
    ADD COLUMN appeal_deadline DATE, ADD COLUMN discounted_payment_deadline DATE,
    ADD COLUMN senatran_infraction_code VARCHAR(20), ADD COLUMN issuing_agency_name VARCHAR(200),
    ADD COLUMN driver_name VARCHAR(200), ADD COLUMN driver_cnh VARCHAR(20), ADD COLUMN driver_cpf VARCHAR(20);

CREATE UNIQUE INDEX idx_fines_tenant_renainf
    ON fines (tenant_id, renainf_number) WHERE renainf_number IS NOT NULL;

-- 20260810130000_drop_fines_infraction_code.sql
ALTER TABLE fines DROP COLUMN infraction_code;

-- 20260810140000_fines_payment_slip_attachment.sql
-- (redefine vehicle_financial_events pra não depender de ticket_url antes de dropar)
ALTER TABLE fines DROP COLUMN ticket_url;
-- + 'payment_slip' adicionado ao check constraint de fine_attachments.type

-- 20260810150000_drop_fines_source.sql
ALTER TABLE fines DROP COLUMN source;

-- 20260811100000_fines_extra_na_fields.sql — +16 colunas (ver tabela acima)

-- 20260811110000_fines_responsible_required.sql — v1.1
ALTER TABLE fines ALTER COLUMN responsible DROP DEFAULT;
ALTER TABLE fines ALTER COLUMN responsible SET NOT NULL;
```

Todas as colunas aditivas são nullable — sobem sem quebrar dado existente. A migration de `responsible NOT NULL` só foi segura porque toda linha pré-existente já tinha o campo preenchido (era opcional com uso de fato universal antes da v1.1). `tenant_id` e RLS via `get_user_tenants()` já existem em `fines` desde a Fase 5 (multi-tenancy); trigger `update_updated_at_column` também já existe na tabela — nada disso precisa ser recriado.

---

## 4. APIs

### 4.1 Endpoint(s) — Server Actions afetadas

- `createFine` — checa duplicata (RN-001, via `findDuplicateFine`) antes do insert; roda `syncFineBilling` depois de inserir (§4.4); **não** valida mais RENAINF condicional (RN-002 revogada).
- `updateFine` — usa `FineSchema.partial()`; roda `syncFineBilling` **antes** do `UPDATE` em `fines` — se o sync bloquear (cobrança já paga, ver RF-011/CA-011c), a multa nem chega a ser atualizada.
- `syncFineBilling` — **v1.1, novo**, função privada (não exportada) em `multas/actions.ts`, chamada pelas duas acima (§4.4).
- `extractFineNoticeFields` — retorna os campos novos extraídos da NA + `duplicateOf` (multa existente encontrada pelo mesmo RENAINF/AIT, ou `null`).
- Indicação de condutor — **reaproveita** `addFineAttachment(fineId, 'driver_indication', ...)`, já existente e já utilizável a qualquer momento pós-criação (RF-010, sem action nova).

### 4.2 Schema Zod

```ts
// packages/core/src/schemas/index.ts — estado atual (v1.1), um único z.object(), sem .refine()

export const FineSchema = z.object({
  customer_id: z.string().uuid().optional().nullable(), // derivado da locação, nunca selecionado direto
  vehicle_id: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(9999999),
  infraction_date: dateString,
  due_date: dateString.optional().nullable(), // obrigatório na prática quando responsible='customer' (checado fora do schema, ver §4.4)
  status: z.enum(['pending', 'paid']).optional(),
  payment_date: dateString.optional().nullable(),
  responsible: z.enum(['customer', 'company']), // v1.1: obrigatório, sem .optional()
  observations: z.string().trim().max(2000).optional().nullable(),
  ait_number: z.string().trim().max(50).optional().nullable(),
  infraction_location: z.string().trim().max(2000).optional().nullable(),
  points: z.number().int().min(0).max(7).optional().nullable(),
  // Campos oficiais da NA (todos opcionais, RN-002 revogada)
  renainf_number: z.string().trim().max(30).optional().nullable(),
  original_renainf_number: z.string().trim().max(30).optional().nullable(),
  notification_date: dateString.optional().nullable(),
  prior_defense_deadline: dateString.optional().nullable(),
  driver_identification_deadline: dateString.optional().nullable(),
  senatran_infraction_code: z.string().trim().max(20).optional().nullable(),
  senatran_infraction_subcode: z.string().trim().max(10).optional().nullable(),
  issuing_agency_name: z.string().trim().max(200).optional().nullable(),
  issuing_agency_code: z.string().trim().max(20).optional().nullable(),
  competent_agency_code: z.string().trim().max(20).optional().nullable(),
  competent_agency_name: z.string().trim().max(200).optional().nullable(),
  driver_name: z.string().trim().max(200).optional().nullable(),
  driver_cnh: z.string().trim().max(20).optional().nullable(),
  driver_cpf: z.string().trim().max(20).optional().nullable(),
  driver_document: z.string().trim().max(30).optional().nullable(),
  infraction_time: timeString.optional().nullable(),
  measurement_instrument_id: z.string().trim().max(50).optional().nullable(),
  traffic_agent_id: z.string().trim().max(50).optional().nullable(),
  measured_speed: z.number().min(0).max(999).optional().nullable(),
  considered_speed: z.number().min(0).max(999).optional().nullable(),
  speed_limit: z.number().min(0).max(999).optional().nullable(),
  infraction_municipality_code: z.string().trim().max(10).optional().nullable(),
  infraction_municipality_name: z.string().trim().max(100).optional().nullable(),
  infraction_state: z.string().trim().max(2).optional().nullable(),
  senatran_message: z.string().trim().max(2000).optional().nullable(),
  // Campos oficiais da NP (preenchimento manual, sem extração)
  appeal_deadline: dateString.optional().nullable(),
  discounted_payment_deadline: dateString.optional().nullable(),
})
```

Não existem mais `infraction_code`, `source` nem `ticket_url` no schema (removidos, ver §3.1) — e não existe `FineUpdateSchema`: `updateFine` usa `FineSchema.partial()` direto, o que só foi possível porque não há mais `.refine()` (a validação condicional de RENAINF que exigia separar as duas foi revogada).

```ts
// packages/core/src/document-extraction/registry.ts — FineNoticeFieldsSchema, 30 campos extraíveis da NA
export const FineNoticeFieldsSchema = z.object({
  license_plate: extractionField(z.string()),
  description: extractionField(z.string()),
  infraction_date: extractionField(z.string()),
  infraction_time: extractionField(z.string()),
  amount: extractionField(z.number()),
  ait_number: extractionField(z.string()),
  infraction_location: extractionField(z.string()),
  infraction_municipality_code: extractionField(z.string()),
  infraction_municipality_name: extractionField(z.string()),
  infraction_state: extractionField(z.string()),
  renainf_number: extractionField(z.string()),
  original_renainf_number: extractionField(z.string()),
  notification_date: extractionField(z.string()),
  prior_defense_deadline: extractionField(z.string()),
  driver_identification_deadline: extractionField(z.string()),
  senatran_infraction_code: extractionField(z.string()),
  senatran_infraction_subcode: extractionField(z.string()),
  issuing_agency_name: extractionField(z.string()),
  issuing_agency_code: extractionField(z.string()),
  competent_agency_name: extractionField(z.string()),
  competent_agency_code: extractionField(z.string()),
  driver_name: extractionField(z.string()),
  driver_cnh: extractionField(z.string()),
  driver_cpf: extractionField(z.string()),
  driver_document: extractionField(z.string()),
  measurement_instrument_id: extractionField(z.string()),
  traffic_agent_id: extractionField(z.string()),
  measured_speed: extractionField(z.number()),
  considered_speed: extractionField(z.number()),
  speed_limit: extractionField(z.number()),
  senatran_message: extractionField(z.string()),
})
```

`buildFineNoticePrompt()` abre com *"Você está analisando uma **Notificação de Autuação (NA)** de trânsito brasileira"* e tem instrução por campo, no mesmo formato (`high`/`low` confidence, `null` se ausente). `due_date` **não** é extraído (a NA não tem esse campo — ver §11) nem `responsible`/`customer_id` (não vêm do documento, são decisão do operador). `EXTRACTION_TIMEOUT_MS` subiu de 15s pra 30s quando o schema quase dobrou de tamanho (ver §11.5).

### 4.3 Erros relevantes

- `createFine` — novo caso: `{ error: 'Já existe uma multa com este RENAINF/AIT', code: 'DUPLICATE_FINE', existingFineId }`.
- `extractFineNoticeFields` — `ActionResult` já suporta erro; `duplicateOf` vai dentro de `data` (não é erro, é aviso — extração continua válida e o form fica preenchido normalmente).
- `updateFine`/`createFine` — se `responsible==='customer'` sem `due_date` ou sem `customer_id` resolvido: `{ error: '...' }` (mensagem específica pra cada caso, ver §4.4). Se a troca de responsável for bloqueada por cobrança paga: `{ error: 'Não é possível mudar o responsável para empresa: a cobrança do cliente já foi paga.' }`.

### 4.4 `syncFineBilling` — geração automática de cobrança (RF-011, v1.1)

Função privada em `multas/actions.ts`, chamada por `createFine` (depois do insert) e `updateFine` (**antes** do update, pra poder bloquear a mudança de `responsible` sem deixar a multa em estado inconsistente).

```ts
interface SyncFineBillingParams {
  fineId: string
  tenantId: string
  responsible: 'customer' | 'company'
  amount: number
  dueDate: string | null
  customerId: string | null
  rentalId: string | null
}
type SyncFineBillingResult =
  | { ok: true; billingId: string | null }
  | { ok: false; error: string }
```

Lógica:
1. Busca a `billing` não-cancelada vinculada (`billings.fine_id = fineId`, `status != 'cancelled'`).
2. `responsible === 'company'`: sem billing → no-op. Com billing `pending`/`overdue` → cancela (`status='cancelled'`). Com billing `paid` → **bloqueia**, retorna erro (RN-003 do PRD).
3. `responsible === 'customer'`: exige `dueDate` e `customerId` (erro dedicado se faltar — a checagem client-side em `FineForm.tsx::handleSubmit` cobre os dois casos antes mesmo de chamar a action). Sem billing existente → cria (`source: 'fine'`, `fine_id`, `late_charge_config` com o default hardcoded de `manutencao/[id]/actions.ts::confirmAutoBilling` — RF-017 não lê `FinancialSettingsSchema.late_charge_defaults` do tenant em nenhum dos dois fluxos ainda). Com billing `pending`/`overdue` → atualiza `original_amount`/`due_date`/`customer_id`/`lease_id` in-place (nunca duplica). Com billing `paid` → mantém congelada, não mexe.

`createFine`/`updateFine` chamam `revalidatePath('/cobrancas')` além de `/multas`. Tela de detalhe (`[id]/page.tsx`) busca a billing vinculada em paralelo com a query da multa e mostra uma seção "Cobrança" (só quando `responsible==='customer'`).

> ⚠️ Existia um `confirmAutoBilling` manual em `multas/[id]/actions.ts` (RF-017), cópia adaptada do equivalente em `manutencao/`, nunca conectado a nenhum botão — e com um bug real (`INSERT` sem `fine_id`, geraria cobrança órfã). Removido na v1.1, superado por `syncFineBilling`.

---

## 5. Segurança

- **AuthN:** inalterado — Server Actions exigem sessão via `getAuthenticatedUser()`.
- **AuthZ / RLS:** inalterado — `fines`/`fine_attachments` já isolados por `tenant_id` via `get_user_tenants()`. O índice único novo é condicionado por `tenant_id`, preservando isolamento entre tenants.

---

## 6. Test Strategy

- **Unit (Vitest, `packages/core`):**
  - `calcFineUrgency` — cobre os 4 prazos novos + `due_date`, prioriza o mais próximo em aberto.
  - `isDriverUnidentified` — `true` quando há prazo de identificação e nem documento nem anexo identificam condutor; `false` nos dois casos contrários.
  - `FineSchema` — aceita multa sem RENAINF (RN-002 revogada, v1.1) e com RENAINF; **rejeita** multa sem `responsible` (v1.1).
- **E2E (Playwright, `apps/web`):** fluxo principal do PRD §3.1 — anexar NA → conferir prazos/RENAINF pré-preenchidos → salvar → abrir detalhe → anexar NP com prazo de recurso/vencimento com desconto → tentar cadastrar outra multa com o mesmo RENAINF e ver o aviso de duplicidade.
- **Validação manual ao vivo (v1.1, RF-011)** — sem cobertura automatizada ainda (fica como próximo passo se a suíte E2E de multas for estendida): criar multa `responsible='customer'` sem locação → bloqueado; com locação → cobrança aparece na tela de detalhe; editar `customer`→`company` → cobrança cancelada (`status` confirmado via psql); editar `company`→`customer` → nova cobrança `pending`; editar só o valor → mesma cobrança atualizada in-place; marcar cobrança como `paid` e tentar trocar pra `company` → bloqueado com a mensagem certa.

Integration/Contract: N/A no modo lite.

---

## 7. Deploy e Rollback

Migration primeiro (aditiva, todas colunas nullable — sobe sem downtime), depois o app. Rollback: reverter o deploy do app é seguro mesmo com as colunas novas já no banco (ficam ignoradas pelo código antigo); se precisar reverter o schema, uma migration reversa faz `DROP COLUMN`/`DROP INDEX` — seguro porque nenhum dado pré-existente depende dessas colunas.

---

## 8. Matriz de Rastreabilidade e Aprovação

### 8.1 Matriz

Cobertura obrigatória 100% dos RF/RN do PRD [[PRDs/0013-revisao-cadastro-multas]].

| PRD Item | Descrição curta | Seção(ões) da Spec | Cobertura de Testes |
|---|---|---|---|
| RF-001 | Remove quick-fill "Infrações comuns" | §2 | E2E: seção Infração sem select de quick-fill |
| RF-002 | Campos oficiais da NA (todos opcionais) | §3, §4.2 | Unit: `FineSchema` aceita sem RENAINF; E2E: campos salvos |
| RF-003 | Condutor identificado no documento | §3, §4.2 | Unit: extração popula `driver_*` |
| RF-004 | Campos da NP (manual) | §2, §4.2 | E2E: preenchimento manual no detalhe |
| RF-005 | Extração por IA direcionada à NA | §2, §4.2 | E2E: extração cobre campos novos |
| RF-006 | Anexo dedicado NA/NP | §2 | E2E: upload dos dois tipos no detalhe |
| RF-007 | Detecção de duplicidade RENAINF/AIT | §4.1, §4.3, §3.2 | Unit: `findDuplicateFine`; E2E: aviso exibido |
| RF-008 | Indicadores de urgência recalculados | §2, §6 | Unit: `calcFineUrgency` |
| RF-009 | Nome do órgão autuador por extenso | §3, §4.2 | E2E: campo visível/preenchido |
| RF-010 | Badge de condutor não identificado + indicação a qualquer momento | §2, §6 | Unit: `isDriverUnidentified`; E2E: badge some após anexo `driver_indication` |
| **RF-011** *(v1.1)* | Responsável pelo pagamento → cobrança automática | §3.1, §4.1, §4.4 | Unit: `FineSchema` rejeita sem `responsible`; validação manual ao vivo (§6) — sem E2E automatizado ainda |
| RN-001 | RENAINF único por tenant | §3.2 | Unit: índice único via `createFine` duplicado |
| ~~RN-002~~ *(revogada v1.1)* | RENAINF obrigatório condicional | — | — |
| **RN-003** *(v1.1)* | Bloqueia troca de responsável se cobrança já paga | §4.4 | Validação manual ao vivo (§6) |

### 8.2 Checklist de aprovação

- [x] Sem `<!-- preencher -->` remanescente
- [x] Toda coluna nova em §3 respeita `tenant_id` (já existe na tabela) + RLS (já existe) + trigger `updated_at` (já existe em `fines`)
- [x] Matriz §8.1 cobre 100% dos itens do PRD (incl. RF-011/RN-003 da v1.1)
- [x] Sem anti-padrões — inclusive corrige um pré-existente (`calcFineStatus` sai de `page.tsx` pra `packages/core/src/rules/fines.ts`) e remove um `confirmAutoBilling` morto com bug (§4.4)

**Aprovado por:** Alan em 2026-08-10 · **v1.1 aprovada por:** Alan em 2026-08-11

---

## 11. Notas de implementação (decisões confirmadas)

1. **Badge de condutor não identificado (RF-010)** resolvido só quando há um anexo `driver_indication` OU o documento já trouxe `driver_name`/`cnh`/`cpf` preenchidos — o simples vínculo com `customer_id` (cliente da locação) **não** basta, por ser só vínculo interno, não a indicação formal ao órgão de trânsito.
2. `due_date` sai do conjunto de campos extraídos automaticamente da NA — o documento real não tem esse campo (a extração anterior mapeava isso de forma ambígua, provavelmente confundindo com o prazo de defesa prévia). `due_date` continua existindo no formulário como campo manual, sem extração.
3. Checagem de duplicidade (RF-007) roda em **dois pontos**: logo após a extração (aviso antecipado, antes mesmo de salvar) e de novo no `createFine` (trava final, cobre RENAINF digitado manualmente).
4. **Boundary Server/Client (v1.1)** — nenhuma Server Action deste arquivo importa de `@gomoto/data`: o barrel do pacote (`packages/data/src/index.ts`) reexporta `./context` (client-only, `createContext`) junto com os repositórios, e importar qualquer coisa de lá num arquivo `'use server'` quebra o build ("You're importing a component that needs createContext"). Por isso a dedup por RENAINF/AIT (`findDuplicateFine`) e todas as queries de `syncFineBilling` usam o client `supabase` local, inline — nunca um repositório de `@gomoto/data`.
5. **Timeout de extração (v1.1)** — `FineNoticeFieldsSchema` quase dobrou de tamanho (16→30 campos) durante a revisão pós-implementação, o que passou a estourar os 15s originais em chamada real ao Gemini (`"Delay was aborted"`). `EXTRACTION_TIMEOUT_MS` (`apps/web/src/lib/document-extraction/extract.ts`) subiu pra 30s; RNF-001 do PRD/Spec 0012 atualizado junto.
6. **Placa → Locação → Cliente (v1.1)** — `customer_id` deixou de ser selecionável direto no form: o operador escolhe a Placa, isso lista todas as locações da moto (ativas e históricas, sem filtro de status — a NA/NP chega semanas/meses depois e o locatário atual pode não ser quem dirigia na data da infração), e escolher a locação preenche `customer_id` a partir de `rental.customer_id` (exibido como texto somente-leitura). A extração por IA casa a placa e seleciona a moto, mas não escolhe a locação — só o operador sabe qual cobre a data da infração.
7. **RF-011/RN-003 (v1.1)** — decisão de bloquear (em vez de permitir) a troca de responsável quando a cobrança já está paga foi tomada explicitamente com o usuário (não é comportamento óbvio do domínio) — a alternativa seria permitir a troca e deixar a cobrança paga órfã/inconsistente, descartada por criar um estado sem caminho de correção claro na UI atual.
