# ADR 0013 — Revisão do modelo de dados financeiro: substituição de `incomes` por `payments`

- **Status:** ⛔ Substituída
- **Data:** 2026-07-19
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]] (2026-08-12)

> ⛔ **Esta decisão não vale mais.** Os dois gatilhos que ela própria nomeou em *Quando reavaliar* — parcelamento e estorno — viraram requisito, e `UNIQUE(billing_id)` os impede por construção. Substituída por `payment_allocations` N:N.
>
> ⚠️ **Correção factual:** a seção *Limites desta decisão* afirma que despesas "permanecem como `expenses` com `is_company_expense = true`, que já existem no schema". **Essa coluna nunca existiu** (verificado em `information_schema`) — por isso responsabilidade de despesa era inmodelável até a ADR 0024.
>
> Permanece válida a separação conceitual entre *ordem de pagamento* (cobrança) e *recibo* (pagamento).
- **Relacionada:** [[decisions/0009-geracao-cobracas-upfront-vs-cron|ADR 0009]], [[PRDs/0008-modulo-financeiro|PRD 0008]], [[Specs/0008-modulo-financeiro|Spec 0008]]

## Contexto

O PRD 0008 (módulo financeiro) introduz o conceito de **pagamento de cobrança** como operação central do fluxo financeiro. O esquema existente tem duas estruturas candidatas a representar esse conceito:

### `incomes` (existente)

```sql
CREATE TABLE incomes (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle     VARCHAR(100),   -- texto livre, sem FK
  amount      NUMERIC(10,2),
  income_date DATE,
  description TEXT,
  ...
);
```

Problemas identificados:
- `vehicle` é VARCHAR livre — sem FK para `vehicles`, sem rastreabilidade.
- Não há FK para `billings` — um income não prova que uma cobrança foi quitada.
- Criada como ledger de receitas avulsas; na prática nunca foi populada via fluxo de locação.
- Impossível distinguir receita de aluguel de receita de manutenção, multa ou caução.

### `payments` (proposta)

Tabela nova, vinculada obrigatoriamente a uma cobrança:

```sql
CREATE TABLE payments (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_id     UUID NOT NULL REFERENCES billings(id) ON DELETE RESTRICT,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_method payment_method_type NOT NULL,
  paid_at        TIMESTAMPTZ NOT NULL,
  received_by    UUID REFERENCES auth.users(id),
  ...
  CONSTRAINT payments_billing_id_unique UNIQUE (billing_id)
);
```

## Decisão

**Substituir `incomes` por `payments` e remover a tabela `incomes`.**

A constraint `UNIQUE(billing_id)` em `payments` é a implementação técnica da regra de negócio RN-047: "pagamento é a única operação que quita uma cobrança". Torna fisicamente impossível pagar a mesma cobrança duas vezes.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **Manter `incomes` e criar `payments`** | Double-entry sem valor: dois registros para o mesmo evento financeiro, divergência eventual. Reportes de receita teriam que unir as duas tabelas. |
| **Adaptar `incomes` adicionando `billing_id`** | A semântica de `incomes` (receita livre) é incompatível com a semântica de `payments` (recibo de quitação). Renomear e adaptar seria mais confuso do que criar do zero. Além disso, o campo `vehicle VARCHAR` seria legacy permanente. |
| **Usar `billings` para registrar o pagamento** | `billings` é a *ordem de pagamento*; `payments` é o *recibo*. Misturar as duas semânticas na mesma tabela dificulta queries de fluxo de caixa e auditorias. |

## Justificativa

**Rastreabilidade completa:** cada `payment` aponta para um `billing` que aponta para um `rental` (ou `maintenance`/`fine`/`expense`). A cadeia de auditoria é completa sem joins extras.

**Constraint no banco como regra de negócio:** `UNIQUE(billing_id)` elimina a possibilidade de pagamento duplo sem nenhuma lógica de aplicação — o banco rejeita o INSERT.

**Modelo de receita limpo:** para o painel financeiro (RF-038, RF-039), receita = `SUM(payments.amount)` filtrado por período. Sem exclusões de incomes de tipo "caução" ou "ajuste".

**Sistema pré-produção:** não há dados históricos em `incomes` a migrar. O custo de remoção é zero.

## Extensão de `billings` no mesmo escopo

Além de criar `payments`, o módulo financeiro adiciona colunas a `billings`:

| Coluna | Propósito |
|---|---|
| `source billing_source` | Rastreia origem da cobrança: `rental_cycle`, `maintenance`, `fine`, `expense`, `manual` |
| `maintenance_id UUID` | FK para `maintenances` quando `source = 'maintenance'` |
| `late_charge_config JSONB` | Snapshot das taxas de encargo fixadas no momento da criação (RN-013) |
| `credit_applied NUMERIC` | Total de crédito de cliente abatido desta cobrança |
| `charges_waived BOOLEAN` | Encargos dispensados (irreversível, RN-014) |
| `waiver_reason / waiver_by / waiver_at` | Auditoria da dispensa |

A coluna `billing_type VARCHAR` (existente, check constraint) e `fine_id UUID` (existente desde migration 20260709) são mantidas sem alteração.

## Consequências

### Positivas

- Regra "sem pagamento parcial" (QA-01) implementada como constraint de banco, não apenas como validação de aplicação.
- Receita financeira consultável em uma única tabela sem filtros complexos.
- `incomes` removida elimina confusão futura sobre qual tabela usar para registrar recebimentos.

### Negativas / riscos aceitos

- **Nenhuma forma de pagamento parcial em V1:** a constraint `UNIQUE(billing_id)` torna isso fisicamente impossível. Para V2 que precise de parcelamento, será necessário redesenhar `payments` (remover a constraint, adicionar `sequence_number`, ajustar regras de quitação).
- **`billing_type` como VARCHAR + check:** legado da migration 0004. Será migrado para ENUM `billing_source` na mesma migration deste módulo.

## Limites desta decisão

Esta ADR cobre apenas o fluxo de **receita** (pagamento de cobranças). Despesas operacionais da empresa (ex.: aluguel do galpão) não são representadas em `payments` — elas permanecem como `expenses` com `is_company_expense = true`, que já existem no schema.

## Quando reavaliar

- Requisito de parcelamento de cobrança (pagamento em N vezes).
- Requisito de estorno ou reversão de pagamento (adicionar `reversed_at` + `reversal_reason`).

## Referências

- [[PRDs/0008-modulo-financeiro]] — RF-049, RN-037, RN-046, RN-047, RNF-005, RNF-008, RNF-009.
- [[Specs/0008-modulo-financeiro]] — §3 FT-03b, §4.3 `payments`, §4.4 ALTER billings, §5.1 `CreatePaymentSchema`.
- [[decisions/0009-geracao-cobracas-upfront-vs-cron|ADR 0009]] — padrão de geração de cobranças que `payments` complementa.
