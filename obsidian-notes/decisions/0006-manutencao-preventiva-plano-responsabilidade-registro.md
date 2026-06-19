# ADR 0006 — Manutenção preventiva: plano por tenant, responsabilidade contratual e registro pelo cliente

- **Status:** Aceita
- **Data:** 2026-06-18
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] (multi-tenancy P2), [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (Server Actions + `logAction`), [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] (auth do cliente), [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]] (CPF como identidade global)
- **PRD de origem:** [[PRDs/0003-manutencao-preventiva]]
- **PRD irmão:** [[PRDs/0002-cadastro-de-motos-documentacao-e-tco]] (D1 — "cada custo na sua tabela; sem espelho em `expenses`")

## Contexto

A manutenção preventiva foi a primeira área de domínio modelada no GoMoto e carrega débitos acumulados de quando o app rodava com um único tenant fictício e nenhuma noção de cliente externo:

1. **Regra hardcoded no código.** `packages/core/src/rules/maintenance.ts` carrega `STANDARD_INTERVALS` — 27 entradas com chaves duplicadas com/sem acento (`'Troca de óleo'` vs `'Troca de oleo'`), mais `normalize()` e `getInterval()` fazendo lookup tolerante. Toda frota de todo tenant herda a mesma tabela; nenhum operador pode customizar.
2. **Tabela órfã.** `maintenance_items` existe no schema desde a Fase 1 do monorepo mas nunca foi consumida pelo bootstrap do wizard de motos (que insere em `maintenances` direto, sem amarrar `standard_item_id`).
3. **Responsabilidade não persistida.** O modal de conclusão em `/manutencao` mostra um dropdown `responsibility ∈ {split, company, customer}` por item. **A escolha não vai pro banco** — não há coluna em `maintenances`. O valor é usado só pro preview de custo e some no save. Quando o operador escolhe "customer", a página silenciosamente insere uma linha em `expenses` — conflitando com a D1 do [[PRDs/0002-cadastro-de-motos-documentacao-e-tco|PRD 0002]] ("cada custo na sua tabela; sem espelho").
4. **Contrato é mudo.** Nenhum mecanismo expressa "neste contrato o cliente arca com óleo e filtro; a empresa cobre o resto".
5. **Cliente não existe no fluxo.** O mobile bootstrap está pronto ([[Estado Atual]]), mas o cliente não vê preventivas, não submete evidências e não tem caminho para corrigir um registro rejeitado.

Este ADR formaliza as 9 decisões consolidadas em [[PRDs/0003-manutencao-preventiva]] §13. Modela três entidades distintas (plano, regra contratual, registro do cliente) e ataca cada um dos débitos acima de forma explícita.

## Decisão

### 1. Escopo do plano de manutenção — por tenant, não por moto individual

Cada **tenant cria N planos próprios**. Cada moto aponta para 1 plano (`motorcycles.maintenance_plan_id`). O override por moto individual fica **fora do V1**: tenant que precisar do caso (uma moto da frota com regime diferente) cria um plano específico (`Plano Moto AB123`) como workaround.

```sql
CREATE TABLE maintenance_plans (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    is_default  BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ,
    -- ...
);

CREATE UNIQUE INDEX maintenance_plans_default_unique
    ON maintenance_plans (tenant_id)
    WHERE is_default = true AND archived_at IS NULL;
```

Tenant novo nasce **sem plano nenhum** — usuários do tenant criam o primeiro. A plataforma não auto-cria default.

### 2. `STANDARD_INTERVALS` → `SUGGESTED_PLAN_ITEMS` no core

A constante hardcoded vira **sugestão**, não fonte de verdade:

```ts
// packages/core/src/data/suggested-plan-items.ts
export const SUGGESTED_PLAN_ITEMS = [
  { name: 'Troca de óleo',       category: 'oil',   interval_km: 1000, is_critical: false },
  { name: 'Filtro de óleo',      category: 'filter', interval_km: 4000, is_critical: false },
  { name: 'Pastilha de freio…',  category: 'brake', interval_km: 8000, is_critical: true },
  // … deduplicado, com categoria, sem acentos duplicados.
] as const
```

A UI do criador de plano oferece **chips** agrupados por categoria. Clicar **copia** o item para `maintenance_plan_items` do tenant. Sem FK de catálogo, sem tabela global, sem migração automática quando uma sugestão muda.

**Consequência direta no código:** `STANDARD_INTERVALS`, `getInterval`, `normalize` saem de `@gomoto/core/rules/maintenance.ts`. As duplicatas com acento desaparecem por construção.

### 3. Responsabilidade contratual — default + regras por categoria/item

Modelagem em três camadas com precedência explícita:

```sql
ALTER TABLE contracts
    ADD COLUMN default_maintenance_executor   VARCHAR(20) CHECK (executor IN ('company','customer')),
    ADD COLUMN default_customer_payer_pct     INTEGER CHECK (pct BETWEEN 0 AND 100);

CREATE TABLE contract_maintenance_rules (
    id                 UUID PRIMARY KEY,
    tenant_id          UUID NOT NULL,
    contract_id        UUID NOT NULL,
    category           VARCHAR(20),       -- override por categoria (preferido)
    plan_item_id       UUID,              -- override por item (escape hatch)
    executor           VARCHAR(20),
    customer_payer_pct INTEGER,
    CHECK (category IS NOT NULL OR plan_item_id IS NOT NULL),
    CHECK (executor IS NOT NULL OR customer_payer_pct IS NOT NULL)
);
```

Precedência aplicada por `resolveResponsibility()` (função pura em `@gomoto/core`):

1. Regra com `plan_item_id = planItem.id`
2. Regra com `category = planItem.category`
3. Default do contrato (`default_maintenance_executor`, `default_customer_payer_pct`)
4. Nada → `null` (operador decide caso a caso no save)

Cada campo (`executor`, `customerPayerPct`) é resolvido **de forma independente** — uma regra pode setar só executor e deixar o pagador herdar do default.

### 4. Executor binário + pagador percentual + snapshot persistido

Em vez de um enum `responsibility ∈ {company, customer, split}` (que confunde "quem faz" com "quem paga"), o modelo separa:

- **`executor`** binário: `company` ou `customer` — quem leva à oficina.
- **`customer_payer_pct INTEGER 0–100`** — empresa = 100 − cliente. Cobre 100/0, 50/50, 70/30, etc.

No momento da conclusão, ambos os valores são **persistidos em snapshot**:

```sql
ALTER TABLE maintenances
    ADD COLUMN effective_executor            VARCHAR(20),
    ADD COLUMN effective_customer_payer_pct  INTEGER;
```

Imutável retroativamente — refeições futuras da regra contratual não reescrevem o histórico.

**`splitMaintenanceCost(total, pct)` é função pura** (round 2 casas decimais; empresa absorve diferença ≤ R$ 0,01). Gera valores para exibição/relatório; **não gera linhas em `billings` no V1** (rateio financeiro vira PRD próprio).

**Mudança comportamental:** o `INSERT INTO expenses` que existe hoje no save de manutenção é **removido**. Alinha com a D1 do PRD 0002 ("cada custo na sua tabela; sem espelho").

### 5. Registro do cliente em tabela separada, com índice parcial garantindo unicidade do aprovado

A evidência submetida pelo cliente vive em `maintenance_records`, **não em `maintenances`**. Razões:

- Cliente pode submeter, ter rejeitado, reenviar — N tentativas para uma mesma `maintenance_id`.
- `maintenances` continua representando "ocorrência de manutenção"; `maintenance_records` representa "tentativas do cliente de evidenciar".
- Permite histórico completo (incluindo rejeitados) sem poluir o modelo principal.

```sql
CREATE TABLE maintenance_records (
    id                   UUID PRIMARY KEY,
    tenant_id            UUID NOT NULL,
    motorcycle_id        UUID NOT NULL,
    maintenance_id       UUID NOT NULL REFERENCES maintenances(id) ON DELETE CASCADE,
    submitted_by_user_id UUID NOT NULL,
    performed_date       DATE NOT NULL,
    actual_km            INTEGER NOT NULL,
    workshop_name        VARCHAR(200),
    cost                 DECIMAL(10,2),
    odometer_photo_url   TEXT NOT NULL,        -- foto obrigatória
    invoice_photo_url    TEXT,
    evidence_photos      TEXT[] NOT NULL DEFAULT '{}',
    status               VARCHAR(20) NOT NULL CHECK (status IN ('pending','in_review','approved','rejected')),
    reviewed_by_user_id  UUID,
    reviewed_at          TIMESTAMPTZ,
    rejection_reason     TEXT,
    -- ...
);

-- No máximo 1 aprovado por manutenção; outras tentativas livres.
CREATE UNIQUE INDEX maintenance_records_approved_unique
    ON maintenance_records (maintenance_id)
    WHERE status = 'approved';
```

Bucket dedicado de storage `maintenance-records` (privado, 10 MB, accept `pdf,jpg,png,webp`), com path `<tenant_id>/<motorcycle_id>/<maintenance_record_id>/<file>` e RLS por tenant.

**Aprovação é transacional** — único Server Action `approveMaintenanceRecord()` em `BEGIN/COMMIT`:

1. UPDATE `maintenance_records.status='approved'`
2. UPDATE `maintenances.completed=true`, `actual_km`, `cost`, `workshop`, `effective_executor='customer'`, `effective_customer_payer_pct=<resolveResponsibility>`
3. INSERT próxima `maintenances` (via `calculateNextMaintenance(planItem)`)
4. UPDATE `motorcycles.km_current`
5. INSERT `audit_logs` (`action='maintenance_record.approved'`)

### 6. Aprovação configurável: default por tenant + override por contrato

A obrigatoriedade de aprovação não é um flag global — varia por tenant e até por contrato:

| Camada | Coluna | Default |
|---|---|---|
| Tenant | `settings['maintenance.approval_required']` | `true` |
| Contrato | `contracts.maintenance_approval_required` (nullable) | herda do tenant |

`isApprovalRequired(tenantSettings, contract)` é função pura: `contract.maintenance_approval_required ?? tenantSettings['maintenance.approval_required'] ?? true`.

Estado `'in_review'` **fica reservado no CHECK constraint** mas não é usado pela UI no V1 — operação multi-operador pode introduzir um botão "Reservar para análise" sem migration.

`getMaintenanceSettings(settings_rows): MaintenanceSettings` agrega chaves `maintenance.*` em objeto tipado consumido pelos hooks.

### 7. Threshold de alerta configurável: default por tenant + override por item

O "vence em breve" deixa de ser fixo em "10% do intervalo ou 100 km/18 dias":

| Camada | Coluna | Default |
|---|---|---|
| Tenant | `settings['maintenance.default_warn_threshold_pct']` (1-100) | `10` |
| Item do plano | `maintenance_plan_items.warn_threshold_pct` (nullable) | herda |

`getWarnThreshold(planItem, tenantSettings): number` é função pura.

**`calculateMaintenanceStatus` é refatorada** para receber intervalo e threshold como **input puro** — sem lookup interno por descrição:

```ts
calculateMaintenanceStatus({
  completed, current_km, predicted_km, scheduled_date,
  interval_km, interval_days, warn_threshold_pct,
  today,
}): 'overdue' | 'upcoming' | 'scheduled' | 'completed'
```

Quem chama é responsável por buscar o `plan_item` ligado. `calculateNextMaintenance` recebe o mesmo tratamento.

**`STANDARD_INTERVALS`, `getInterval`, `normalize` morrem** — não há mais fallback de "100 km / 18 dias", pois o dado existe explícito no item.

### 8. Bloqueio de locação por preventiva vencida — fora do V1; só schema preparado

`maintenance_plan_items.is_critical BOOLEAN` é incluído no V1 e os chips de `SUGGESTED_PLAN_ITEMS` pré-marcam `true` em `brake`, `tire`, `inspection`. **Sem uso operacional no V1** — a coluna existe só para que o PRD futuro de "regras avançadas" não precise migrar dados retroativamente.

Lógica (qual moto pode ser alugada), UX (banner/bloqueio na criação de contrato) e override por contrato ficam para PRD próprio quando aparecer demanda.

### 9. Ordem de Serviço — fora do V1, sem schema preparatório

Hoje `maintenances.workshop` é texto livre. Cobre 100% dos casos atuais (oficina informal, terceira parte, dono do tenant). Modelar OS no V1 seria overengineering: o modal multi-item já trata "concluir N itens de uma vez" — a UX de OS pode herdar disso quando aparecer demanda concreta.

PRD futuro próprio cobrirá `service_orders` + `service_order_items` + `service_order_parts` + `service_order_services` + `workshops` (oficinas como entidade) + `mechanics` (responsável técnico).

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| **Catálogo curado pela plataforma (`maintenance_item_catalog` global)** | Resolve "duplicação" mas tira autonomia do tenant e força a plataforma a virar dona do conteúdo. Sugestão em código vs catálogo em banco: ambos resolvem digitação; o em código não cria dependência operacional. Reabrir se aparecerem 50+ tenants pedindo a mesma curadoria. |
| **`responsibility` enum único (company/customer/split)** | Confunde "quem faz" com "quem paga". Em `split`, ainda fica ambíguo o percentual. Separar `executor` (binário) de `customer_payer_pct` (inteiro) é mais expressivo e elimina valores "intermediários" sem semântica. |
| **Persistir só `executor` e calcular pagador na hora da exibição** | Quebra histórico. Se o `contract_maintenance_rules` mudar depois, a manutenção concluída "retroage". Snapshot em `effective_*` garante que olhar pra uma manutenção concluída em janeiro sempre mostra a regra de janeiro. |
| **Manter `expenses` espelho na conclusão** | Conflita com PRD 0002 D1. Dois locais para o mesmo custo (em `maintenances.cost` e em `expenses.amount`) implica risco de divergência e relatórios duplos. View `motorcycle_financial_events` agrega quando precisar. |
| **Override de plano por moto (`motorcycle_plan_overrides`)** | Trade-off do D1. Adiciona mesa nova e ramo de precedência sem dado real comprovado. Workaround "criar plano específico" cobre o caso raro sem custo de modelagem. |
| **Persistir o status (`overdue/upcoming/scheduled/completed`) em `maintenances.status`** | Status é derivado de `predicted_km`, `current_km`, `scheduled_date`, `today` e thresholds. Persistir exige cron e gera divergência entre "o que está no banco" e "o que é verdade agora". Mantemos derivação em runtime; cron de marcar overdue vira PRD de "automações" se aparecer demanda de relatório histórico. |
| **`is_critical` na categoria (`maintenance_categories.is_critical`)** | Implicaria criar tabela de categorias. Categoria é só um enum (string) hoje; flag por item dá granularidade (uma "vistoria mensal" pode ser crítica em frota high-end, opcional em frota cheap-and-cheerful). |
| **Aprovação obrigatória global, sem opt-out** | Tenants pequenos que confiam no cliente querem auto-aprovar. Tenants grandes querem revisar tudo. Configurar por tenant + override por contrato cobre os dois mundos com 1 setting + 1 coluna. |
| **`maintenance_records` como subset de `maintenances` (mesma tabela com flag `submitted_by_customer`)** | Misturaria "ocorrência canônica da preventiva" com "tentativa do cliente". Reenvio após rejeição ficaria impossível sem soft delete. Tabela separada com FK obrigatória mantém o histórico de tentativas explícito. |
| **Foto do odômetro opcional** | Sem foto, a aprovação vira "confiar no número digitado". Operador não tem como validar. Foto obrigatória dá ao operador o ponto de evidência mínimo pra aprovar/rejeitar com segurança. |
| **Implementar OS no V1 ("já que estou mexendo aqui")** | OS é um modelo de 5+ tabelas (ordem, itens, peças, serviços, oficinas) que pediria PRD próprio com personas e fluxo. Misturar com manutenção preventiva inflaria escopo. Texto livre em `workshop` cobre 100% do uso atual. |

## Consequências

### Positivas

- **Tenant ganha autonomia.** Plano é configurável, intervalos são editáveis, threshold é por item.
- **Código mais puro.** `@gomoto/core/rules/maintenance` perde 80% das linhas de "fallback defensivo" e ganha funções 100% puras com input explícito — testáveis sem mock de tabela.
- **Multi-tenant correto.** Cada plano vive no tenant; nenhum vazamento entre locadoras.
- **Custo na tabela certa.** `maintenances.cost` é a fonte de verdade. Expenses não é mais espelho. Relatórios financeiros consomem view única.
- **Snapshot de responsabilidade.** Mudar regra de contrato amanhã não reescreve manutenção concluída ontem.
- **Cliente entra no fluxo.** Mobile passa a ter razão de existir para preventiva (antes só tinha login).
- **Aprovação transacional.** Estado consistente garantido em `BEGIN/COMMIT` (record + maintenance + próximo agendamento + km da moto + audit).
- **Escala pra PRDs futuros.** `is_critical` já no schema; estado `in_review` reservado; rateio financeiro consome `effective_*` sem mudar a tabela.

### Negativas

- **Migração progressiva.** Motos existentes sobem com `maintenance_plan_id NULL`. Tenant precisa atribuir antes da próxima conclusão. Mitigado com banner discreto e modal bloqueante só no save.
- **Manutenções históricas perdem dados.** `plan_item_id` e `effective_*` ficam `NULL` em registros antigos — tela mostra "—" e badge "Antes do registro de responsabilidade".
- **Mais tabelas.** +4 tabelas (`maintenance_plans`, `maintenance_plan_items`, `contract_maintenance_rules`, `maintenance_records`). Maior superfície de RLS e índices. Vale a aposta.
- **Tenant precisa criar plano antes de cadastrar moto.** Atrito no onboarding mitigado pelos chips de `SUGGESTED_PLAN_ITEMS` (criar plano com 5 itens em < 1 min). Wizard de moto oferece "Criar plano agora →" pra reduzir fricção.
- **Operador pode esquecer de definir responsabilidade.** Resolução cai para `null` → operador escolhe no save. Sem regras, o sistema não força — modela a realidade de "às vezes a empresa decide na hora".
- **Bucket novo aumenta storage gasto.** Foto obrigatória de odômetro × N manutenções de clientes × N tenants. Limite 10 MB por foto e lifecycle policy futuro mitigam.

### Neutras

- **Estado `'in_review'` fica reservado mas sem uso.** Zero custo (CHECK aceita o valor); ganho de flexibilidade futura sem migration.
- **`is_critical` populado mas sem comportamento.** Idem.
- **`maintenances.standard_item_id` removida junto com `maintenance_items`.** Coluna nunca foi usada na operação; pré-check em produção (`SELECT count(*) WHERE standard_item_id IS NOT NULL`) garante drop seguro.
- **Telas web `/aprovacoes` e `/planos-manutencao` aparecem na sidebar.** Mais 2 itens; quem não usa ignora.

## Quando reavaliar

- **Override de plano por moto vira recorrente** ("toda hora crio um plano só pra essa moto"). Reabrir D1 com `motorcycle_plan_overrides` ou flexibilizar `motorcycles.maintenance_plan_id` para apontar pra um "plano efêmero" da moto.
- **Plataforma quer curar conteúdo** (compliance, padrão de mercado). Reabrir D2 com `maintenance_item_catalog` global + sync opcional pro plano do tenant.
- **`'split'` financeiro vira regra recorrente** com cobrança automática. PRD futuro de rateio consome `effective_*` direto; este ADR só precisa garantir que o snapshot está fiel.
- **Aprovação multi-nível** (gerente → operador → arquivo) aparece como pedido. Estado `'in_review'` já está reservado; adicionar `approval_levels`/`reviewers_required` no contrato ou tenant.
- **Bloqueio de locação por preventiva vencida** vira requisito (frota high-value, exigência regulatória). PRD próprio consome `is_critical` + `calculateMaintenanceStatus`; este ADR não muda.
- **Ordem de Serviço** com peças/mecânico/tempo vira parte do produto. PRD próprio; texto livre em `workshop` migra pra FK opcional `service_order_id`.
- **Histórico cumulativo do cliente** ("seu Z já gastou R$ 1200 em óleo") como produto. Consome `maintenance_records` + view; PRD próprio.
- **Notificações** (push, WhatsApp, email) de "sua manutenção vence em 200 km". PRD de automações.

## Estado atual (2026-06-18)

- Migrations F1–F3: **a criar** (3 arquivos novos em `supabase/migrations/`).
- `maintenance_items` órfã: **a dropar** (após pré-check `SELECT count(*) FROM maintenances WHERE standard_item_id IS NOT NULL` em local e cloud).
- `STANDARD_INTERVALS`, `getInterval`, `normalize` em `@gomoto/core/rules/maintenance.ts`: **a remover** (F1).
- `SUGGESTED_PLAN_ITEMS`: **a criar** em `packages/core/src/data/suggested-plan-items.ts` (F1).
- `calculateMaintenanceStatus` e `calculateNextMaintenance`: **a refatorar** para receber intervalo como input puro (F1).
- `resolveResponsibility`, `splitMaintenanceCost`, `isApprovalRequired`, `getWarnThreshold`, `getMaintenanceSettings`: **a implementar** (F1/F3).
- Modal de conclusão em `/manutencao` removendo `INSERT INTO expenses` e persistindo `effective_*`: **a refatorar** (F3).
- Telas `/planos-manutencao`, `/contratos/[id]/manutencao`, `/aprovacoes`: **a criar** (F2/F3/F6).
- Telas mobile `(tabs)/manutencao.tsx`, `manutencao/[id]/registrar.tsx`, `manutencao/historico.tsx`: **a criar** (F4–F5).
- Settings `maintenance.approval_required` e `maintenance.default_warn_threshold_pct`: **a popular** nos tenants seed (F3).
- Bucket `maintenance-records`: **a criar** (F5).

## Referências

- [[PRDs/0003-manutencao-preventiva]] — PRD de origem com escopo completo, schema, telas, critérios de aceite e faseamento V1.
- [[PRDs/0002-cadastro-de-motos-documentacao-e-tco]] — D1 (cada custo na sua tabela) é o ancoramento arquitetural para a remoção do espelho em `expenses`.
- [[decisions/0001-monorepo-pnpm-turborepo|ADR 0001]] — premissa P2 (multi-tenancy) que motiva `tenant_id` em todas as tabelas novas.
- [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] — Server Actions co-localizadas + `logAction()` por mutação; novas actions de aprovação seguem o padrão.
- [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] — auth do cliente no mobile; este ADR estende com primeiras telas de produto (manutenção).
- [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]] — `current_customer_ids()` SETOF, base de RLS pras leituras mobile.
- `packages/core/src/rules/maintenance.ts` — arquivo a ser refatorado em F1.
- `apps/web/src/app/(dashboard)/manutencao/page.tsx` — modal de conclusão a ser refatorado em F3.
