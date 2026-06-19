---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-06-17
related:
  - "[[Telas/Motos]]"
  - "[[Telas/Multas]]"
  - "[[Telas/Manutenção]]"
  - "[[Telas/Despesas]]"
  - "[[Banco de Dados]]"
  - "[[Fluxos de Negócio]]"
tags:
  - prd
  - motos
  - documentacao
  - tco
---

# PRD 0002 — Cadastro de motos, documentação e custo total da frota

> ✅ **Status: aprovado** em 2026-06-17. 7 decisões fechadas (ver §13). Substitui a visão atual de "moto = registro estático" por "moto = ativo financeiro com ciclo de vida documental e operacional". Próximo passo: implementar **F1** (schema + core) — ver §12.

---

## 1. Contexto

Hoje o cadastro de moto em `motorcycles` (ver [[Telas/Motos]]) cobre apenas a **identificação técnica do veículo + um traço opcional do dono anterior**. O modelo atual sustenta operação básica (frota, locação, manutenção preventiva), mas deixa três lacunas estruturais:

1. **Identidade documental do veículo é informal.** O sistema não sabe quem é o **proprietário registrado no CRV/CRLV atual**, se a transferência para a empresa já foi feita, qual é o **número do CRV vigente**, e não guarda o **anexo do documento**. Operacionalmente, quem precisa do CRV recorre a pasta física.

2. **Documentação anual obrigatória não tem entidade própria.** IPVA, licenciamento, DPVAT, seguro e taxas DETRAN são pagamentos recorrentes (anuais) com **ano de exercício, vencimento e comprovante**. Hoje, quem registra acaba lançando como `expenses` solto — sem ano de referência, sem status de "vence em X dias", sem possibilidade de alertar o operador antes de virar IPVA atrasado.

3. **Multas e gastos de manutenção não consolidam em "TCO por moto".** As tabelas existem (`fines`, `maintenances`, `expenses`), mas a tela `/motos` não mostra **quanto cada veículo custou no ano** — informação que decide se a moto é rentável, se vai vender ou se vai dar baixa.

Soma-se a isso uma falha estreita: `fines.customer_id` é **NOT NULL**, o que impede registrar a **multa que chegou antes** da locadora identificar quem era o locatário no momento da infração, ou multas administrativas (licenciamento atrasado, DETRAN, sem vínculo a cliente).

Este PRD repensa o cadastro de moto como **dossiê do ativo** — com identidade técnica, identidade documental, documentação anual e visão consolidada de custo — e ajusta os modelos vizinhos (`fines`, `expenses`) para fechar o ciclo.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **CRV** | Certificado de Registro do Veículo — documento original de propriedade emitido pelo DETRAN. Trocado a cada transferência. |
| **CRLV** | Certificado de Registro e Licenciamento do Veículo — versão anual; comprova que o licenciamento está em dia. Hoje quase sempre digital (CRLV-e). |
| **Licenciamento** | Pagamento anual obrigatório que renova o CRLV. Inclui taxa DETRAN; em alguns estados engloba o DPVAT. |
| **IPVA** | Imposto sobre Propriedade de Veículos Automotores. Anual, estadual, valor função de FIPE + alíquota da UF. |
| **DPVAT** | Seguro obrigatório de Danos Pessoais. Cobrado nacionalmente ou suspenso conforme política do ano. |
| **Transferência** | Mudança de propriedade no DETRAN — emite novo CRV em nome do novo proprietário. |
| **Obrigação anual** | Termo genérico que cobre IPVA, licenciamento, DPVAT, seguro e taxas DETRAN sazonais. |
| **TCO** | Total Cost of Ownership — soma de tudo que a empresa gastou com um veículo (aquisição + documentação + manutenção + multas-empresa). |
| **Dono anterior** | Quem vendeu a moto para a empresa. Dado estático, capturado na aquisição. Pode coincidir com `registered_owner_*` enquanto a transferência não acontece. |
| **Proprietário registrado** | Nome + documento que constam no CRV/CRLV vigente. Muda quando a transferência é feita. |

---

## 3. Objetivos e não-objetivos

### 3.1 Objetivos (V1)

- ✅ Capturar **dados do CRV atual** (proprietário registrado, nº CRV, ano-exercício, anexo) no cadastro de moto.
- ✅ Modelar **histórico de documentos** da moto (CRV antigo → CRV novo após transferência).
- ✅ Registrar **status da transferência** (transferido para a empresa? quando?).
- ✅ Criar entidade `vehicle_obligations` para **IPVA, licenciamento, DPVAT, taxas DETRAN e seguro opcional** — com ano de referência, vencimento, status, comprovante. Seguro só aparece se o veículo for segurado.
- ✅ Permitir registrar multas **com ou sem cliente atribuído** no momento do lançamento. Multa é do veículo; vincular cliente é decisão do operador no form.
- ✅ Tela de detalhe da moto com **abas**: Identificação · Documento · Documentação anual · Multas · Manutenção · Custo total.
- ✅ Listagem e filtros de **todos** os gastos do veículo (obrigações, manutenção, multas, despesas) com agregação para relatórios.
- ✅ Estrutura de dados preparada para fase futura de **alertas e controle de documentação vencida** (`due_date`, `status`, índices prontos — UI de alerta fica para uma próxima fase).

### 3.2 Não-objetivos (V1 — explicitamente fora do escopo)

- ❌ **Integração automática com DETRAN** (consultar IPVA/licenciamento via API estadual). Cada UF tem sistema próprio e é projeto à parte.
- ❌ **OCR do CRV** para extrair dados automaticamente do anexo.
- ❌ **Geração de boletos de IPVA**.
- ❌ **Cobrança automática do cliente** quando a empresa paga obrigação anual (rateio mensal embutido em billings). Vira PRD próprio.
- ❌ **Tela/Dashboard/email de alertas de documentação vencida.** O dado fica estruturado e consultável; a UI dedicada de alerta é PRD da próxima fase. Decisão D4.
- ❌ **Job diário que muda `pending → overdue` automaticamente.** Status é calculado dinamicamente no client por hora; trigger automático vira parte do PRD de alertas (próxima fase).
- ❌ **Detecção automática do cliente provável para multa órfã.** Operador atribui manual. Decisão D6.
- ❌ **Histórico de proprietários antigos do veículo** (antes do dono anterior). Decisão D5: só guardamos dados básicos do vendedor (`previous_owner` + `previous_owner_cpf`).
- ❌ **Reescrita das telas `/manutencao` e `/despesas`**. Este PRD ajusta o schema de `expenses` minimamente; refactor de UI é incremento separado.

---

## 4. Personas e papéis

| Papel | Como interage |
|---|---|
| `tenant_owner` / `tenant_admin` | Cadastra moto nova; informa CRV; lança IPVA pago; aprova orçamentos de manutenção. |
| `tenant_operator` | Lança recebimento de multa que chegou pelo correio; registra licenciamento pago; anexa CRLV-e. |
| `tenant_viewer` | Consulta TCO de uma moto antes de decidir vender. |
| `platform_owner` | Não interage diretamente, mas é beneficiado em relatórios cross-tenant (quanto cada locadora gasta em documentação). |

---

## 5. Modelo de dados

### 5.1 Alterações em `motorcycles`

Acrescenta identidade documental e dados de aquisição. Tudo nullable para preservar registros existentes.

```sql
ALTER TABLE motorcycles
    -- Identidade documental atual
    ADD COLUMN registered_owner_name      VARCHAR(200),
    ADD COLUMN registered_owner_document  VARCHAR(20),    -- CPF (11) ou CNPJ (14), só dígitos
    ADD COLUMN registered_owner_type      VARCHAR(10) CHECK (registered_owner_type IN ('cpf','cnpj')),
    ADD COLUMN registration_state         VARCHAR(2),     -- UF do emplacamento (ex: 'SP'); texto livre (D7)
    ADD COLUMN ownership_transferred      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN ownership_transfer_date    DATE,

    -- Aquisição
    ADD COLUMN acquisition_type           VARCHAR(20) CHECK (acquisition_type IN ('zero_km','purchase','consignment','lease','donation','other')) DEFAULT 'purchase',
    ADD COLUMN acquisition_amount         DECIMAL(10,2);  -- quanto a empresa pagou (≠ FIPE)
```

Observações:

- `previous_owner` e `previous_owner_cpf` **continuam** — capturam o dono anterior (quem vendeu). Só são preenchidos quando `acquisition_type ≠ 'zero_km'` (D5: sem histórico de proprietários antigos; apenas o vendedor direto).
- `registered_owner_*` é a identidade documental **atual**. Pode coincidir com `previous_owner` enquanto a transferência não acontece.
- **Sem campo cache `documentation_status` no V1.** Status agregado é calculado no client/relatório a partir de `vehicle_obligations` quando preciso. Decisão D4: cache + trigger entram quando a UI de alertas for construída.

### 5.2 Nova tabela `vehicle_documents`

Histórico de documentos físicos/digitais emitidos para o veículo (CRV, CRLV, recibos de transferência).

```sql
CREATE TABLE vehicle_documents (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    motorcycle_id            UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,

    type                     VARCHAR(30) NOT NULL CHECK (type IN ('crv','crlv','transfer_receipt','other')),
    exercise_year            INTEGER,                          -- ano-exercício (CRLV anual)
    document_number          VARCHAR(50),                      -- nº CRV ou Renavam-doc
    issued_at                DATE,

    registered_owner_name    VARCHAR(200),                     -- nome no documento (pode mudar ao longo do tempo)
    registered_owner_document VARCHAR(20),
    registered_owner_type    VARCHAR(10) CHECK (registered_owner_type IN ('cpf','cnpj')),

    file_url                 TEXT,                             -- bucket storage: vehicle-documents/...
    is_current               BOOLEAN NOT NULL DEFAULT false,   -- marca o doc vigente
    observations             TEXT,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garante 1 documento "vigente" por (moto, tipo): só pode existir um CRV vigente e um CRLV vigente.
CREATE UNIQUE INDEX vehicle_documents_current_unique
    ON vehicle_documents (motorcycle_id, type)
    WHERE is_current = true;

CREATE INDEX idx_vehicle_documents_tenant ON vehicle_documents(tenant_id);
CREATE INDEX idx_vehicle_documents_motorcycle ON vehicle_documents(motorcycle_id);

ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
-- Policies seguem padrão get_user_tenants() + bypass platform admin (idêntico às demais tabelas de domínio).

CREATE TRIGGER trg_vehicle_documents_updated_at
    BEFORE UPDATE ON vehicle_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 5.3 Nova tabela `vehicle_obligations`

Pagamentos recorrentes obrigatórios (IPVA, licenciamento, DPVAT, seguro, taxa CRV-e).

```sql
CREATE TABLE vehicle_obligations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    motorcycle_id       UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,

    type                VARCHAR(30) NOT NULL CHECK (type IN (
        'ipva','licensing','dpvat','insurance','crv_issuance','detran_fee','other'
    )),
    reference_year      INTEGER NOT NULL,                     -- ano-exercício (ex: 2026)
    description         VARCHAR(300),                          -- "IPVA 2026 — 3ª parcela", "Seguro Porto Anual 2026"

    amount              DECIMAL(10,2) NOT NULL,
    due_date            DATE NOT NULL,

    status              VARCHAR(20) NOT NULL CHECK (status IN (
        'pending','paid','overdue','exempt','cancelled'
    )) DEFAULT 'pending',
    paid_at             DATE,
    payment_method      VARCHAR(50),                          -- 'pix' | 'boleto' | 'debit' | 'credit' | 'cash'
    payment_reference   VARCHAR(200),                          -- nº autenticação, código de barras pago

    receipt_url         TEXT,                                  -- bucket storage: vehicle-obligations/...
    observations        TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evita duplicidade de IPVA/Licenciamento do mesmo ano por moto. Seguro/DPVAT podem ter
-- múltiplos no ano (ex: 2 apólices parciais), por isso ficam fora do índice.
CREATE UNIQUE INDEX vehicle_obligations_year_unique
    ON vehicle_obligations (motorcycle_id, type, reference_year)
    WHERE type IN ('ipva','licensing','crv_issuance');

CREATE INDEX idx_vehicle_obligations_tenant ON vehicle_obligations(tenant_id);
CREATE INDEX idx_vehicle_obligations_motorcycle ON vehicle_obligations(motorcycle_id);
CREATE INDEX idx_vehicle_obligations_due ON vehicle_obligations(due_date) WHERE status IN ('pending','overdue');

ALTER TABLE vehicle_obligations ENABLE ROW LEVEL SECURITY;
-- Policies idênticas às de domínio (filtro por get_user_tenants() + bypass platform admin).

CREATE TRIGGER trg_vehicle_obligations_updated_at
    BEFORE UPDATE ON vehicle_obligations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 5.4 Alterações em `fines`

Permitir multa sem cliente atribuído e capturar dados completos do AIT (D3).

```sql
ALTER TABLE fines
    -- Hoje NOT NULL + CASCADE; afrouxa: multa é do veículo, cliente é opcional.
    ALTER COLUMN customer_id DROP NOT NULL,
    -- motorcycle_id permanece obrigatório (multa pertence ao veículo).
    ALTER COLUMN motorcycle_id SET NOT NULL;

-- Reescreve a FK trocando CASCADE por SET NULL: se o cliente é excluído,
-- a multa permanece com motorcycle_id (não perde histórico do veículo).
ALTER TABLE fines DROP CONSTRAINT IF EXISTS fines_customer_id_fkey;
ALTER TABLE fines
    ADD CONSTRAINT fines_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE fines
    ADD COLUMN ait_number          VARCHAR(50),      -- nº do Auto de Infração de Trânsito
    ADD COLUMN infraction_code     VARCHAR(20),      -- código CTB (ex: '545-00')
    ADD COLUMN infraction_location TEXT,
    ADD COLUMN points              INTEGER CHECK (points >= 0 AND points <= 7),
    ADD COLUMN source              VARCHAR(30) CHECK (source IN (
        'detran','cetran','municipal','private_area','other'
    )),
    ADD COLUMN ticket_url          TEXT;             -- foto/PDF do auto recebido
```

> Sem campo `driver_identified` (D6: detecção/identificação automática fora do escopo). A presença ou ausência de `customer_id` é o próprio indicador.

### 5.5 Alterações em `expenses`

Apenas adições cosméticas para apoiar a visão de TCO:

```sql
ALTER TABLE expenses
    ADD COLUMN payment_status VARCHAR(20) CHECK (payment_status IN ('pending','paid')) DEFAULT 'paid',
    ADD COLUMN paid_at        DATE,
    ADD COLUMN updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

> **Por quê:** hoje toda `expense` é tratada como pago (lançada após o fato). Para refletir IPVA boletado mas não pago via `expenses`, precisaríamos do mesmo modelo — mas como o caso de uso "documentação" agora vive em `vehicle_obligations`, `expenses.payment_status` cobre apenas gastos operacionais com vencimento futuro (ex: peça encomendada). Default `paid` preserva semântica atual.

### 5.6 Views/funções de apoio

Decisão D1: gastos **não** são duplicados em `expenses`. Cada categoria vive em sua tabela própria (`vehicle_obligations`, `maintenances`, `fines`, `expenses`) e a view abaixo é o **ponto único de consolidação** para listagem por moto, filtros cross-tipo e relatórios.

```sql
-- View 1: agregado por moto (TCO).
-- Usada na listagem de Motos, na aba "Custo total" do detalhe e em relatórios.
CREATE OR REPLACE VIEW motorcycle_cost_summary AS
SELECT
    m.id                AS motorcycle_id,
    m.tenant_id,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0)                                  AS obligations_paid,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('pending','overdue')), 0)                  AS obligations_due,
    COALESCE(SUM(mt.cost)  FILTER (WHERE mt.completed = true), 0)                                AS maintenance_cost,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'company' AND f.status = 'paid'), 0)    AS fines_company_paid,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'customer' AND f.status = 'paid'), 0)   AS fines_customer_paid,
    COALESCE(SUM(e.amount) FILTER (WHERE e.payment_status = 'paid'), 0)                          AS expenses_paid
FROM motorcycles m
LEFT JOIN vehicle_obligations o ON o.motorcycle_id = m.id
LEFT JOIN maintenances mt        ON mt.motorcycle_id = m.id
LEFT JOIN fines f                ON f.motorcycle_id = m.id
LEFT JOIN expenses e             ON e.motorcycle_id = m.id
GROUP BY m.id, m.tenant_id;

-- View 2: linha por evento financeiro do veículo (cross-tipo).
-- Habilita a aba "Custo total" (lista filtrável) e relatórios uniformes.
CREATE OR REPLACE VIEW motorcycle_financial_events AS
SELECT
    o.id              AS event_id,
    o.tenant_id,
    o.motorcycle_id,
    'obligation'      AS source,
    o.type            AS subtype,                          -- 'ipva','licensing','dpvat','insurance',...
    COALESCE(o.description, o.type || ' ' || o.reference_year) AS description,
    o.amount,
    o.due_date        AS event_date,
    o.paid_at,
    o.status,                                              -- pending | paid | overdue | exempt | cancelled
    o.receipt_url     AS attachment_url
FROM vehicle_obligations o
UNION ALL
SELECT
    mt.id, mt.tenant_id, mt.motorcycle_id,
    'maintenance', mt.type, mt.description, mt.cost,
    COALESCE(mt.completed_date, mt.scheduled_date),
    mt.completed_date,
    CASE WHEN mt.completed THEN 'paid' ELSE 'pending' END,
    mt.invoice_photo_url
FROM maintenances mt
WHERE mt.cost IS NOT NULL
UNION ALL
SELECT
    f.id, f.tenant_id, f.motorcycle_id,
    'fine', f.responsible, f.description, f.amount,
    f.infraction_date, f.payment_date,
    f.status,
    f.ticket_url
FROM fines f
UNION ALL
SELECT
    e.id, e.tenant_id, e.motorcycle_id,
    'expense', e.category, e.description, e.amount,
    e.date, e.paid_at,
    e.payment_status,
    e.invoice_url
FROM expenses e
WHERE e.motorcycle_id IS NOT NULL;
```

> **Sem trigger de status documental no V1** (D4). Status agregado é calculado on-the-fly em `@gomoto/core/rules/documentation`. O dado fica estruturado em `vehicle_obligations.due_date` + `status`, pronto para o PRD de alertas vir e adicionar trigger/job + UI no futuro.

---

## 6. Regras de negócio

### 6.1 Estados de obrigação

```text
pending ── marcada como paga ──→ paid
pending ── isenta (DPVAT 2026, p.ex.) ──→ exempt
qualquer ── erro de lançamento ──→ cancelled (não afeta TCO)
```

- **`overdue` é derivado em runtime**, não armazenado. Regra pura em `@gomoto/core/rules/documentation`:
  `effectiveStatus(o) = (o.status === 'pending' && o.due_date < hoje) ? 'overdue' : o.status`.
- A coluna `status` no banco aceita `'overdue'` pelo CHECK, mas o V1 nunca o escreve — fica reservado para quando o PRD de alertas adicionar o job de vencimento. UI e relatórios usam `effectiveStatus`.

### 6.2 Documento vigente

- Ao marcar um `vehicle_documents` como `is_current = true`, o anterior do mesmo `(motorcycle_id, type)` é automaticamente rebaixado para `is_current = false`. O índice parcial garante a regra; a Server Action faz a transição em transação.
- Ao registrar **transferência** (`motorcycles.ownership_transferred = true`):
  1. Cria novo `vehicle_documents` (type='crv', is_current=true) com `registered_owner_*` = empresa.
  2. Atualiza `motorcycles.registered_owner_*` para os dados da empresa.
  3. Marca `motorcycles.ownership_transfer_date = hoje`.
  4. CRV anterior vira histórico (`is_current=false`).

### 6.3 Bootstrap de obrigações ao cadastrar moto

No wizard de criação (passo 2 — ver §7.1), o operador pode opcionalmente preencher:

- **IPVA do ano corrente**: valor + vencimento + status (paid se já quitado pelo vendedor; pending caso contrário).
- **Licenciamento**: idem.
- **DPVAT**: idem (default exempt se o ano corrente estiver suspenso).
- **Seguro** (D2): *não aparece no bootstrap*. Só é registrado se a moto for segurada — operador adiciona depois via tela de detalhe.

Sistema cria 0 a 3 linhas em `vehicle_obligations`. Pular tudo é válido — nenhum status é forçado na moto.

### 6.4 Multas e cliente

Decisão D3: **multa é do veículo**. `motorcycle_id` é obrigatório; `customer_id` é opcional. No form de criação:

- Se a infração já tem locatário sabido, operador seleciona o cliente.
- Se não, deixa em branco — a multa fica registrada para o veículo e pode ser atribuída editando o registro depois.

Sem fluxo dedicado "Identificar locatário" no V1 (D6): edição normal do registro de multa basta. Sem detecção automática.

### 6.5 TCO por moto

A view `motorcycle_cost_summary` é o ponto único de verdade para totais. A view `motorcycle_financial_events` é o ponto único para listagem detalhada/filtros. UI consome via hooks `useMotorcycleCostSummary(motorcycleId)` e `useMotorcycleFinancialEvents(motorcycleId, filtros)` em `@gomoto/data`.

Cards de TCO na aba "Custo total" mostram:

- **Aquisição** = `motorcycles.acquisition_amount`
- **Documentação paga (ano corrente)** = soma de obligations.amount WHERE reference_year=YYYY AND status='paid'
- **Manutenção (12m)** = soma de maintenances.cost últimos 12 meses
- **Multas empresa (12m)** = soma de fines.amount com responsible='company' últimos 12m
- **Despesas operacionais (12m)** = soma de expenses.amount últimos 12m (com motorcycle_id setado)
- **Total** = soma dos 5

A lista de eventos da aba "Custo total" usa `motorcycle_financial_events` com filtros por tipo (obrigação/manutenção/multa/despesa), período e status. **Relatórios cross-frota** (PRD futuro) consomem a mesma view, agregando por tenant/período.

---

## 7. Telas e fluxos

### 7.1 Wizard de cadastro/edição — `/motos` (refatorado)

Antes: 2 passos (Dados Técnicos + Bootstrap manutenção).
Depois: **3 passos** na criação; edição vai direto ao passo 1.

#### Passo 1 — Identificação do veículo

Igual ao atual (placa, renavam, marca, modelo, ano fab/mod, cor, combustível, chassi, cilindrada, KM entrada, foto). Sem mudança visual significativa.

#### Passo 2 — Documentação e aquisição (novo)

| Bloco | Campos |
|---|---|
| **Aquisição** | tipo de aquisição (select com `zero_km`, `purchase`, `consignment`, `lease`, `donation`, `other`), data da compra, valor pago (R$), valor FIPE (R$) |
| **Dono anterior** | nome, CPF/CNPJ — **só aparecem se `acquisition_type ≠ 'zero_km'`** (D5) |
| **CRV atual** | proprietário registrado (nome + CPF/CNPJ), UF de registro (texto livre, D7), nº CRV, ano-exercício, transferência feita? (toggle), data da transferência, upload do CRV (PDF/foto) |
| **Documentação anual (opcional)** | 3 linhas pré-criadas: IPVA, Licenciamento, DPVAT — cada uma com valor, vencimento, status (pending/paid/exempt), comprovante. Operador pode pular qualquer uma. Seguro **não** aparece aqui (D2). |

#### Passo 3 — Bootstrap de manutenção

Idêntico ao atual passo 2 (13 itens). Sem mudança.

### 7.2 Detalhe da moto (nova tela / drawer)

Rota: `/motos/[id]` ou drawer modal em `/motos`. Layout:

- **Header**: foto + placa + marca/modelo + StatusBadge.
- **Abas**:
  1. **Identificação** — todos os dados técnicos + dono anterior (oculto se `zero_km`).
  2. **Documento** — CRV vigente em destaque + histórico de documentos. Botão "Registrar transferência".
  3. **Documentação anual** — lista por ano (accordion). Cada ano: cards de IPVA, Licenciamento, DPVAT com status e comprovante. **Seguro aparece como card adicional só se houver registro** (D2). Botão "Adicionar seguro" lista vazia.
  4. **Multas** — `fines` da moto (com e sem `customer_id`).
  5. **Manutenção** — `maintenances` da moto.
  6. **Custo total** — cards de TCO (ver §6.5) + lista filtrável de eventos (via `motorcycle_financial_events`) + gráfico de barras "gasto por mês".

### 7.3 Tela `/documentacao` (nova)

Visão consolidada de obrigações anuais cross-frota.

- **KPI cards**: Vencendo em 30d · Vencidas · Pagas no ano · Total a pagar.
- **Filtros**: ano (default: ano corrente), tipo (IPVA/Licenciamento/...), status.
- **Tabela** agrupada por moto: placa, IPVA, Licenciamento, DPVAT, Seguro — cada coluna é um chip clicável com status (Pago / Pendente / Vencido / Isento).
- **CRUD** de obrigação via modal (criar/editar/marcar como paga + upload de comprovante).
- **Ação em lote**: "Lançar IPVA 2027 para toda a frota" com modal que pré-popula vencimento e deixa o valor em branco para preenchimento individual.

### 7.4 Tela `/multas` — ajustes

- Form de criação: cliente vira **opcional** + acrescenta campos AIT (`ait_number`, `infraction_code`, `infraction_location`, `points`, `source`).
- Listagem mantém agrupamento por moto (já existe). Multas sem `customer_id` mostram traço "—" na coluna Cliente; permanecem editáveis para atribuir cliente depois.
- Sem fluxo dedicado de "Identificar locatário" (D6) — edição normal do registro basta.

### 7.5 Dashboard

Sem mudanças no V1. KPI de "Documentação atrasada" entra junto com o PRD de alertas (D4).

---

## 8. Fluxos críticos (end-to-end)

### 8.1 Cadastro de moto nova com CRV pendente de transferência

```
[Operador] /motos → Nova Moto
  Passo 1: dados técnicos
  Passo 2: aquisição + CRV
     - registered_owner_name = "João Vendedor"
     - registered_owner_document = "12345678900"
     - ownership_transferred = false  (ainda no nome do João)
     - anexa foto do CRV
     - IPVA 2026: R$ 350 vencendo em 15/07, status=pending
     - Licenciamento 2026: R$ 145 vencendo em 30/09, status=pending
  Passo 3: bootstrap manutenção (13 itens)
  Salvar
[Sistema]
  1. INSERT motorcycles (... ownership_transferred=false, registered_owner_*=João)
  2. INSERT vehicle_documents (type='crv', is_current=true, registered_owner_name='João Vendedor', file_url=...)
  3. INSERT vehicle_obligations × 2 (IPVA pending, Licenciamento pending)
  4. INSERT maintenances × 13 (preventiva)
[Resultado] Moto aparece em `/motos`. Aba "Documentação anual" mostra IPVA pending; effectiveStatus computa "overdue" no client quando passar do vencimento.
```

### 8.2 Pagamento de IPVA

```
[Operador] /documentacao → linha "Honda CG 160 — IPVA 2026 pending"
  → "Marcar como paga"
  → preenche data pagamento, método (pix), nº autenticação, anexa comprovante
[Server Action payObligation]
  1. UPDATE vehicle_obligations SET status='paid', paid_at=..., payment_method='pix', receipt_url=...
  2. audit_logs (action='obligation.paid')
  (sem INSERT espelho em expenses — D1)
[Resultado] TCO ano-corrente sobe; view motorcycle_cost_summary reflete na próxima query.
```

### 8.3 Transferência do CRV para a empresa

```
[Operador] /motos/[id] → aba "Documento" → "Registrar transferência"
  → preenche: nº novo CRV, data emissão, anexo do CRV novo, UF
[Server Action recordOwnershipTransfer]
  Em transação:
  1. UPDATE vehicle_documents SET is_current=false WHERE motorcycle_id=? AND type='crv' AND is_current=true
  2. INSERT vehicle_documents (type='crv', is_current=true, registered_owner_*=empresa)
  3. UPDATE motorcycles SET
        ownership_transferred=true,
        ownership_transfer_date=hoje,
        registered_owner_name=<empresa>,
        registered_owner_document=<CNPJ empresa>,
        registered_owner_type='cnpj'
     WHERE id=?
  4. audit_logs (action='motorcycle.ownership_transferred')
[Resultado] Histórico do CRV mostra os 2 documentos; vigente é o novo.
```

### 8.4 Multa chega — com ou sem cliente

```
Correios → escritório → operador abre AIT em papel
[Operador] /multas → Nova multa
  - moto: placa do AIT (obrigatório)
  - cliente: seleciona se souber, deixa em branco se não
  - infraction_date, amount, ait_number, infraction_code,
    infraction_location, points, source
  - anexo (ticket_url): foto do AIT
[Sistema]
  INSERT fines (motorcycle_id, customer_id NULLABLE, ...)
[Resultado] Multa fica registrada para a moto. Se faltou o cliente, operador edita o registro depois quando descobrir.
```

---

## 9. Impacto em código existente

| Componente | Mudança |
|---|---|
| `supabase/migrations/<ts>_motorcycle_documentation.sql` | Migration nova: altera `motorcycles`, cria `vehicle_documents`, `vehicle_obligations`, views (`motorcycle_cost_summary`, `motorcycle_financial_events`). |
| `supabase/migrations/<ts>_fines_extend.sql` | Migration nova: afrouxa `customer_id`, adiciona campos AIT, força `motorcycle_id NOT NULL`. |
| `supabase/migrations/<ts>_expenses_payment_status.sql` | Migration nova: adiciona payment_status/paid_at/updated_at. |
| `supabase/seed.sql` | Acrescentar: 1-2 obrigações por moto seed, 1 CRV vigente por moto seed. |
| `packages/core/src/schemas/index.ts` | Nova `VehicleDocumentSchema`, `VehicleObligationSchema`; ampliar `MotorcycleSchema` com campos novos; ampliar `FineSchema` (customer_id opcional, novos campos AIT). |
| `packages/core/src/rules/documentation.ts` | **Novo módulo**: `effectiveStatus(obligation, today)`, `summarizeDocumentation(obligations[])`, `nextObligationDue(obligations[])`. |
| `packages/core/src/rules/motorcycles.ts` | Acrescentar `calculateTotalCost(summary)`. |
| `packages/data/src/queries` | Hooks novos: `useVehicleDocuments`, `useVehicleObligations`, `useMotorcycleCostSummary`, `useMotorcycleFinancialEvents`. |
| `apps/web/src/app/(dashboard)/motos/page.tsx` | Wizard passa a 3 passos. |
| `apps/web/src/app/(dashboard)/motos/[id]/page.tsx` | **Nova** tela de detalhe (ou drawer) com 6 abas. |
| `apps/web/src/app/(dashboard)/documentacao/page.tsx` | **Nova** tela. |
| `apps/web/src/app/(dashboard)/multas/page.tsx` | Form com cliente opcional + campos AIT; listagem mantém estrutura. |
| `apps/web/src/components/layout/Sidebar` | Item novo "Documentação". |
| Storage | Buckets `vehicle-documents` e `vehicle-obligation-receipts` (privados, 10MB max, accept `pdf,jpg,png,webp`). |

> Sem Edge Function de vencimento no V1 (D4). Quando a fase de alertas vier, ela adiciona o cron + tela de alerta + KPI no Dashboard.

---

## 10. Migração de dados existentes

A frota atual (seed + dados produção das locadoras) tem motos sem nenhuma obrigação cadastrada. Estratégia:

1. Migration adiciona colunas/tabelas **sem backfill** — `registered_owner_*` e `acquisition_*` ficam NULL nas motos antigas.
2. **Aviso suave na UI**: aba "Documento" da moto exibe banner "Complete os dados do CRV" quando `registered_owner_name` é NULL. Sem bloqueio, sem prazo forçado.
3. Operador completa cadastro retrospectivamente conforme conveniente.

Multas existentes mantêm `customer_id` preenchido (não há órfãs hoje); o afrouxamento da constraint só beneficia inserts futuros. Verificar pré-migration que toda `fines` tem `motorcycle_id` preenchido — se houver linha com NULL, corrigir antes de aplicar `SET NOT NULL`.

---

## 11. Critérios de aceite (V1)

**Schema:**

- [ ] Migrations sobem limpo em `pnpm db:reset`; seed produz pelo menos 1 obrigação e 1 CRV vigente por moto seed.
- [ ] `vehicle_obligations` e `vehicle_documents` têm RLS habilitada e filtram por `get_user_tenants()`.
- [ ] Índice parcial garante 1 documento vigente por `(moto, tipo)`.
- [ ] View `motorcycle_cost_summary` retorna 1 linha por moto com totais zerados quando não há dados.
- [ ] View `motorcycle_financial_events` lista eventos das 4 fontes (obrigações, manutenções, multas, despesas) com schema uniforme.

**Cadastro de moto:**

- [ ] Wizard 3 passos: criar moto preenchendo CRV no passo 2 cria 1 linha em `vehicle_documents` (is_current=true) + N linhas em `vehicle_obligations` conforme preenchido.
- [ ] `acquisition_type='zero_km'` esconde os campos de dono anterior; demais tipos exibem.
- [ ] Criar moto sem informar documentação anual não falha (cria 0 obrigações).
- [ ] Upload do CRV vai para bucket `vehicle-documents` e fica acessível via signed URL.

**Documentação anual:**

- [ ] `/documentacao` lista todas as obrigações da frota, filtrável por ano/tipo/status.
- [ ] Marcar como paga registra `paid_at`, `payment_method`, `receipt_url` (sem espelho em `expenses`).
- [ ] `effectiveStatus(obligation, hoje)` retorna `'overdue'` para `pending` com `due_date < hoje`.
- [ ] Adicionar seguro só pela aba "Documentação anual" do detalhe — não aparece no bootstrap.

**Transferência:**

- [ ] Registrar transferência cria novo CRV vigente e rebaixa o anterior; histórico mostra os dois.
- [ ] `motorcycles.registered_owner_*` atualiza para os dados da empresa.

**Multas:**

- [ ] Criar multa sem cliente é aceito; `motorcycle_id` segue obrigatório.
- [ ] Editar multa permite atribuir cliente depois.
- [ ] Campos AIT (`ait_number`, `infraction_code`, `points`, `source`) gravam e aparecem na listagem.

**TCO:**

- [ ] Aba "Custo total" da moto soma corretamente obrigações pagas, manutenção concluída, multas-empresa pagas e despesas pagas dos últimos 12 meses.
- [ ] Lista de eventos da aba "Custo total" filtra por tipo (obrigação/manutenção/multa/despesa), período e status.

**Geral:**

- [ ] `pnpm build` verde; `pnpm test` verde (regras puras do `documentation.ts` com cobertura Vitest).
- [ ] Notas Obsidian atualizadas: `Telas/Motos`, `Telas/Multas`, `Banco de Dados`, `Fluxos de Negócio`, `Estado Atual`.
- [ ] ADR 0005 escrito formalizando o modelo (dossiê do veículo + view única de eventos financeiros).

---

## 12. Faseamento sugerido

| Fase | Escopo | Esforço |
|---|---|---|
| **F1 — Schema + core** | Migrations das 3 tabelas/colunas + 2 views, schemas Zod, regras puras em `@gomoto/core/rules/documentation` (`effectiveStatus`, `summarizeDocumentation`), hooks de leitura em `@gomoto/data`. | 1-2 dias |
| **F2 — Wizard de motos repensado** | 3 passos, captura CRV + obrigações iniciais, upload de anexo, `acquisition_type='zero_km'` esconde dono anterior. | 1-2 dias |
| **F3 — Tela de detalhe da moto** | `/motos/[id]` com 6 abas; reaproveita componentes existentes. | 2 dias |
| **F4 — Tela `/documentacao`** | Listagem cross-frota, CRUD obrigações, ações em lote. | 2 dias |
| **F5 — Ajustes em `/multas`** | Cliente opcional + form AIT (campos novos). UI mantém estrutura atual. | 0.5 dia |
| **F6 — TCO** | Cards na aba "Custo total" + lista filtrável via `motorcycle_financial_events`. | 1 dia |

**Total V1 (F1-F6):** 7-9 dias focados, sem dependência da plataforma admin.

**Ordem de prioridade:**
- **F1 → F2 → F3** desbloqueia o fluxo principal (cadastrar moto com CRV + ver detalhe).
- **F4** robustece a operação anual.
- **F5 → F6** podem ir em paralelo após F1.

**Fase futura (PRD separado):** alertas de documentação vencida — adiciona KPI no Dashboard, tela `/alertas`, Edge Function `mark-overdue-obligations` agendada, e cache `documentation_status` em `motorcycles` (com trigger de manutenção).

---

## 13. Decisões (fechadas em 2026-06-17)

| # | Decisão | Resolução |
|---|---|---|
| ✅ D1 | Espelhar obrigação paga em `expenses`? | **Não.** Cada gasto vive na sua tabela (`vehicle_obligations`, `maintenances`, `fines`, `expenses`). Views `motorcycle_cost_summary` (agregado) e `motorcycle_financial_events` (lista cross-tipo) são o ponto único de consolidação para exibição, filtros e relatórios. |
| ✅ D2 | Seguro do veículo: obrigatório ou opcional? | **Opcional.** `vehicle_obligations.type='insurance'` reusa a mesma estrutura, mas o seguro **não** é criado no bootstrap do wizard e **não** aparece nos cards default da aba "Documentação anual" — só aparece se houver pelo menos um registro. Adicionado via botão "Adicionar seguro" no detalhe da moto. |
| ✅ D3 | Multa órfã: como tratar? | **Multa pertence ao veículo** (`motorcycle_id` obrigatório, `customer_id` opcional). Atribuição de cliente acontece no form de criação OU em edição posterior do registro. Sem bloco dedicado "Aguardando identificação". |
| ✅ D4 | Alertas e controle de documentação vencida no V1? | **Fora do V1**, mas estrutura preparada. `due_date` + `status` ficam estruturados; `effectiveStatus` calcula `overdue` em runtime. Fase futura adiciona job de vencimento + cache `documentation_status` + UI de alerta. |
| ✅ D5 | Histórico de proprietários antigos? | **Não.** Apenas `previous_owner` + `previous_owner_cpf` quando `acquisition_type ≠ 'zero_km'`. Sem tabela de histórico. |
| ✅ D6 | Detectar cliente provável de multa órfã automaticamente? | **Não.** Operador escolhe manual. Sem campo `driver_identified` — presença/ausência de `customer_id` é o próprio indicador. |
| ✅ D7 | UF do veículo: enum ou texto livre? | **Texto livre** 2 chars. Sem regex bloqueante no V1; reabrir se houver dados sujos. |

---

## 14. Próximos passos

1. Escrever **ADR 0005 — Documentação do veículo como dossiê de obrigações + visão de TCO**, consolidando D1–D7.
2. Implementar **F1** (schema + core + views) como primeiro PR. Validar relatórios e filtros antes de mexer em UI.
3. Atualizar [[Roadmap]] com as 6 fases V1.
4. Pré-checagem antes da migration de `fines`: rodar `SELECT count(*) FROM fines WHERE motorcycle_id IS NULL` — se >0, corrigir antes de aplicar `SET NOT NULL`.

---

## Tags

`#prd` `#motos` `#documentacao` `#tco`
