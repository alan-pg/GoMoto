---
status: rascunho
versão: 0.1
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

> 📝 **Status: rascunho.** Versão inicial para revisão. Substitui a visão atual de "moto = registro estático" por "moto = ativo financeiro com ciclo de vida documental e operacional".

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
- ✅ Criar entidade `vehicle_obligations` para **IPVA, licenciamento, DPVAT, seguro e taxas DETRAN** — com ano de referência, vencimento, status, comprovante.
- ✅ Permitir registrar multas **sem cliente identificado** (administrativa ou pré-identificação).
- ✅ Tela de detalhe da moto com **abas**: Identificação · Documento · Documentação anual · Multas · Manutenção · Custo total.
- ✅ KPI "Documentação em dia" no Dashboard e na tela de Motos.
- ✅ Alertas de obrigação vencendo (≤30 dias) e vencida.

### 3.2 Não-objetivos (V1 — explicitamente fora do escopo)

- ❌ **Integração automática com DETRAN** (consultar IPVA/licenciamento via API estadual). Cada UF tem sistema próprio e é projeto à parte.
- ❌ **OCR do CRV** para extrair dados automaticamente do anexo.
- ❌ **Geração de boletos de IPVA**.
- ❌ **Cobrança automática do cliente** quando a empresa paga obrigação anual (rateio mensal embutido em billings). Vira PRD próprio.
- ❌ **Histórico de proprietários antigos do veículo** (antes do dono anterior conhecido). O sistema rastreia o veículo só a partir da aquisição pela empresa.
- ❌ **Reescrita das telas `/multas`, `/manutencao`, `/despesas`**. Este PRD ajusta o schema delas mas mantém UI atual; refactor de UI é incremento separado.

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
    ADD COLUMN registration_state         VARCHAR(2),     -- UF do emplacamento (ex: 'SP')
    ADD COLUMN ownership_transferred      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN ownership_transfer_date    DATE,

    -- Aquisição
    ADD COLUMN acquisition_type           VARCHAR(20) CHECK (acquisition_type IN ('purchase','consignment','lease','donation','other')) DEFAULT 'purchase',
    ADD COLUMN acquisition_amount         DECIMAL(10,2),  -- quanto a empresa pagou (≠ FIPE)

    -- Status documental derivado / cache
    ADD COLUMN documentation_status       VARCHAR(20) CHECK (documentation_status IN ('ok','warning','overdue','unknown')) DEFAULT 'unknown';
```

Observações:

- `previous_owner` e `previous_owner_cpf` **continuam** — capturam o dono anterior (quem vendeu). Não se confundem com `registered_owner_*` (que pode ser igual ao dono anterior enquanto a transferência não acontece).
- `documentation_status` é cache calculado por trigger ou job a partir de `vehicle_obligations`. Permite filtrar a listagem por "motos com documentação atrasada" sem join + agregação a cada render.

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

Permitir multa sem cliente identificado e capturar dados completos do AIT.

```sql
ALTER TABLE fines
    -- Hoje NOT NULL + CASCADE; afrouxa para permitir multa administrativa.
    ALTER COLUMN customer_id DROP NOT NULL;

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
    -- "Sem locatário identificado" — multa que chegou e ainda não sabemos quem dirigia.
    -- Quando identificarmos, basta preencher customer_id e marcar driver_identified=true.
    ADD COLUMN driver_identified   BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN ticket_url          TEXT;             -- foto/PDF do auto recebido
```

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

```sql
-- Custo total acumulado por moto (TCO).
-- Usada na listagem de Motos (KPI por linha) e na aba "Custo total" do detalhe.
CREATE OR REPLACE VIEW motorcycle_cost_summary AS
SELECT
    m.id                AS motorcycle_id,
    m.tenant_id,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0) AS obligations_paid,
    COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('pending','overdue')), 0) AS obligations_due,
    COALESCE(SUM(mt.cost) FILTER (WHERE mt.completed = true), 0) AS maintenance_cost,
    COALESCE(SUM(f.amount) FILTER (WHERE f.responsible = 'company' AND f.status = 'paid'), 0) AS fines_company_paid,
    COALESCE(SUM(e.amount) FILTER (WHERE e.payment_status = 'paid'), 0) AS expenses_paid
FROM motorcycles m
LEFT JOIN vehicle_obligations o ON o.motorcycle_id = m.id
LEFT JOIN maintenances mt        ON mt.motorcycle_id = m.id
LEFT JOIN fines f                ON f.motorcycle_id = m.id
LEFT JOIN expenses e             ON e.motorcycle_id = m.id
GROUP BY m.id, m.tenant_id;

-- Função que atualiza motorcycles.documentation_status com base nas obrigações.
-- Chamada por trigger em vehicle_obligations e por job de vencimento diário.
CREATE OR REPLACE FUNCTION recompute_documentation_status(p_motorcycle_id UUID)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    has_overdue BOOLEAN;
    has_warning BOOLEAN;
    has_any     BOOLEAN;
BEGIN
    SELECT
        EXISTS (SELECT 1 FROM vehicle_obligations
                WHERE motorcycle_id = p_motorcycle_id
                  AND status = 'overdue'),
        EXISTS (SELECT 1 FROM vehicle_obligations
                WHERE motorcycle_id = p_motorcycle_id
                  AND status = 'pending'
                  AND due_date <= CURRENT_DATE + INTERVAL '30 days'),
        EXISTS (SELECT 1 FROM vehicle_obligations
                WHERE motorcycle_id = p_motorcycle_id)
    INTO has_overdue, has_warning, has_any;

    UPDATE motorcycles
       SET documentation_status =
           CASE
               WHEN has_overdue THEN 'overdue'
               WHEN has_warning THEN 'warning'
               WHEN has_any     THEN 'ok'
               ELSE 'unknown'
           END
     WHERE id = p_motorcycle_id;
END;
$$;
```

---

## 6. Regras de negócio

### 6.1 Estados de obrigação

```text
pending ── due_date < hoje ──→ overdue
pending ── marcada como paga ──→ paid
pending ── isenta (DPVAT 2026, p.ex.) ──→ exempt
qualquer ── erro de lançamento ──→ cancelled (não afeta TCO)
```

- Job diário (Edge Function ou cron) executa `UPDATE vehicle_obligations SET status='overdue' WHERE status='pending' AND due_date < CURRENT_DATE`.
- Mudança de status dispara `recompute_documentation_status(motorcycle_id)`.

### 6.2 Documento vigente

- Ao marcar um `vehicle_documents` como `is_current = true`, o anterior do mesmo `(motorcycle_id, type)` é automaticamente rebaixado para `is_current = false`. O índice parcial garante a regra; a Server Action faz a transição em transação.
- Ao registrar **transferência** (`motorcycles.ownership_transferred = true`):
  1. Cria novo `vehicle_documents` (type='crv', is_current=true) com `registered_owner_*` = empresa.
  2. Atualiza `motorcycles.registered_owner_*` para os dados da empresa.
  3. Marca `motorcycles.ownership_transfer_date = hoje`.
  4. CRV anterior vira histórico (`is_current=false`).

### 6.3 Bootstrap de obrigações ao cadastrar moto

No wizard de criação (passo 2 — ver §7.1), o operador pode opcionalmente preencher:

- IPVA do ano corrente: valor + vencimento + status (paid se já quitado pelo vendedor; pending caso contrário).
- Licenciamento: idem.
- DPVAT: idem (default exempt se o ano corrente estiver suspenso).

Sistema cria as 3 linhas em `vehicle_obligations`. Se o operador deixar tudo em branco, o sistema cria 0 linhas e marca `motorcycles.documentation_status = 'unknown'`.

### 6.4 Multas sem cliente identificado

Operador pode criar `fines` com `customer_id = NULL` e `driver_identified = false`. Tela `/multas` mostra essas multas em **bloco separado**: "Aguardando identificação do locatário". Ao identificar:

1. Operador busca contratos cujo período cobria `infraction_date` para essa moto.
2. Seleciona o cliente.
3. Sistema preenche `customer_id`, marca `driver_identified = true` e propõe responsabilidade `customer`.
4. Audit log: `fine.driver_identified` com snapshot antes/depois.

### 6.5 TCO por moto

A view `motorcycle_cost_summary` é o ponto único de verdade. UI consome via hook `useMotorcycleCostSummary(motorcycleId)` em `@gomoto/data`. Cards de TCO mostram:

- **Aquisição** = `motorcycles.acquisition_amount`
- **Documentação paga (ano corrente)** = soma de obligations.amount WHERE reference_year=YYYY AND status='paid'
- **Manutenção (12m)** = soma de maintenances.cost últimos 12 meses
- **Multas empresa (12m)** = soma de fines.amount com responsible='company' últimos 12m
- **Despesas operacionais (12m)** = soma de expenses.amount últimos 12m
- **Total** = soma dos 5

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
| **Aquisição** | tipo de aquisição (select), data da compra, valor pago (R$), valor FIPE (R$) |
| **Dono anterior** | nome, CPF/CNPJ (mantido do esquema atual) |
| **CRV atual** | proprietário registrado (nome + CPF/CNPJ), UF de registro, nº CRV, ano-exercício, transferência feita? (toggle), data da transferência, upload do CRV (PDF/foto) |
| **Documentação anual (opcional)** | 3 linhas pré-criadas: IPVA, Licenciamento, DPVAT — cada uma com valor, vencimento, status (pending/paid/exempt), comprovante. Operador pode pular qualquer uma. |

#### Passo 3 — Bootstrap de manutenção

Idêntico ao atual passo 2 (13 itens). Sem mudança.

### 7.2 Detalhe da moto (nova tela / drawer)

Rota: `/motos/[id]` ou drawer modal em `/motos`. Layout:

- **Header**: foto + placa + marca/modelo + StatusBadge + DocumentationBadge (verde/amarelo/vermelho/cinza).
- **Abas**:
  1. **Identificação** — todos os dados técnicos + dono anterior.
  2. **Documento** — CRV vigente em destaque + histórico de documentos. Botão "Registrar transferência".
  3. **Documentação anual** — lista por ano (accordion). Cada ano: cards de IPVA, Licenciamento, DPVAT, Seguro com status e comprovante.
  4. **Multas** — `fines` da moto (todas, mesmo sem cliente).
  5. **Manutenção** — `maintenances` da moto.
  6. **Custo total** — cards de TCO (ver §6.5) + gráfico de barras "gasto por mês".

### 7.3 Tela `/documentacao` (nova)

Visão consolidada de obrigações anuais cross-frota.

- **KPI cards**: Vencendo em 30d · Vencidas · Pagas no ano · Total a pagar.
- **Filtros**: ano (default: ano corrente), tipo (IPVA/Licenciamento/...), status.
- **Tabela** agrupada por moto: placa, IPVA, Licenciamento, DPVAT, Seguro — cada coluna é um chip clicável com status (Pago / Pendente / Vencido / Isento).
- **CRUD** de obrigação via modal (criar/editar/marcar como paga + upload de comprovante).
- **Ação em lote**: "Lançar IPVA 2027 para toda a frota" com modal que pré-popula vencimento e deixa o valor em branco para preenchimento individual.

### 7.4 Tela `/multas` — ajustes

- Novo bloco no topo: **"Aguardando identificação"** com multas onde `driver_identified = false`.
- Form de criação: tornar cliente **opcional** + adicionar campos AIT (`ait_number`, `infraction_code`, `infraction_location`, `points`, `source`).
- Fluxo "Identificar locatário" via modal (ver §6.4).

### 7.5 KPI no Dashboard

Adicionar card **"Documentação atrasada"** com contagem de motos onde `documentation_status = 'overdue'`. Link para `/documentacao?status=overdue`.

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
  1. INSERT motorcycles (... ownership_transferred=false, registered_owner_*=João, documentation_status='unknown')
  2. INSERT vehicle_documents (type='crv', is_current=true, registered_owner_name='João Vendedor', file_url=...)
  3. INSERT vehicle_obligations × 2 (IPVA pending, Licenciamento pending)
  4. INSERT maintenances × 13 (preventiva)
  5. recompute_documentation_status(motorcycle_id) → 'warning' (IPVA vence em <30d)
[Resultado] Moto aparece no `/motos` com badge amarela de doc; alerta no Dashboard.
```

### 8.2 Pagamento de IPVA

```
[Operador] /documentacao → linha "Honda CG 160 — IPVA 2026 pending"
  → "Marcar como paga"
  → preenche data pagamento, método (pix), nº autenticação, anexa comprovante
[Server Action payObligation]
  1. UPDATE vehicle_obligations SET status='paid', paid_at=..., payment_method='pix', receipt_url=...
  2. recompute_documentation_status(motorcycle_id)
  3. (opcional) INSERT expenses com category='Documentação', motorcycle_id, payment_status='paid' — para refletir na contabilidade. **Decisão D2**.
  4. audit_logs (action='obligation.paid')
[Resultado] Badge de documentação fica verde; TCO ano-corrente sobe.
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

### 8.4 Multa chega sem identificação

```
Correios → escritório → operador abre AIT em papel
[Operador] /multas → Nova multa
  - cliente: deixa em branco
  - moto: placa do AIT
  - infraction_date: data do AIT
  - amount, ait_number, infraction_code, infraction_location, points
  - source: 'detran'
  - driver_identified: false
[Sistema]
  1. INSERT fines (customer_id=NULL, ..., driver_identified=false)
  2. Aparece no bloco "Aguardando identificação"

[Dias depois] Operador consulta histórico de contratos:
  SELECT * FROM contracts
    WHERE motorcycle_id=? AND start_date <= infraction_date
                          AND (end_date IS NULL OR end_date >= infraction_date);
  → identifica cliente Pedro

[Operador] /multas → multa "Aguardando" → "Identificar locatário"
  → seleciona Pedro
[Server Action identifyFineDriver]
  UPDATE fines SET customer_id=Pedro, driver_identified=true, responsible='customer'
  audit_logs (action='fine.driver_identified', metadata={before, after})
```

---

## 9. Impacto em código existente

| Componente | Mudança |
|---|---|
| `supabase/migrations/<ts>_motorcycle_documentation.sql` | Migration nova: altera `motorcycles`, cria `vehicle_documents`, `vehicle_obligations`, view, função. |
| `supabase/migrations/<ts>_fines_extend.sql` | Migration nova: afrouxa `customer_id`, adiciona campos AIT. |
| `supabase/migrations/<ts>_expenses_payment_status.sql` | Migration nova: adiciona payment_status/paid_at/updated_at. |
| `supabase/seed.sql` | Acrescentar: 1-2 obrigações por moto seed, 1 CRV vigente por moto seed. |
| `packages/core/src/schemas/index.ts` | Nova `VehicleDocumentSchema`, `VehicleObligationSchema`; ampliar `MotorcycleSchema` com campos novos; ampliar `FineSchema` (customer_id opcional, novos campos AIT). |
| `packages/core/src/rules/documentation.ts` | **Novo módulo**: `calculateObligationStatus(due_date, status)`, `summarizeDocumentation(obligations[])`, `nextObligationDue(obligations[])`. |
| `packages/core/src/rules/motorcycles.ts` | Acrescentar `calculateTotalCost(summary)`. |
| `packages/data/src/queries` | Hooks novos: `useVehicleDocuments`, `useVehicleObligations`, `useMotorcycleCostSummary`. |
| `apps/web/src/app/(dashboard)/motos/page.tsx` | Wizard passa a 3 passos; badge de documentação na tabela. |
| `apps/web/src/app/(dashboard)/motos/[id]/page.tsx` | **Nova** tela de detalhe (ou drawer). |
| `apps/web/src/app/(dashboard)/documentacao/page.tsx` | **Nova** tela. |
| `apps/web/src/app/(dashboard)/multas/page.tsx` | Bloco "Aguardando identificação", form com cliente opcional, campos AIT. |
| `apps/web/src/app/(dashboard)/page.tsx` (Dashboard) | KPI "Documentação atrasada". |
| `apps/web/src/components/layout/Sidebar` | Item novo "Documentação". |
| Storage | Buckets `vehicle-documents` e `vehicle-obligation-receipts` (privados, 10MB max, accept `pdf,jpg,png,webp`). |
| Edge Function `mark-overdue-obligations` | Job diário (cron 06:00 BRT) que vira `pending → overdue` e recalcula `documentation_status`. |

---

## 10. Migração de dados existentes

A frota atual (seed + dados produção das locadoras) tem motos sem nenhuma obrigação cadastrada. Estratégia:

1. Migration adiciona colunas/tabelas **sem backfill** — `documentation_status` fica `unknown`, `registered_owner_*` fica NULL.
2. **Aviso na UI**: nas motos com `documentation_status='unknown'`, exibir banner "Complete a documentação desta moto" com CTA para a aba Documento.
3. Operador completa cadastro retrospectivamente (sem prazo forçado).
4. Após 30 dias, mover `documentation_status='unknown'` para card de pendência no Dashboard.

Multas existentes mantêm `customer_id NOT NULL` na prática (já preenchidas); o afrouxamento da constraint só beneficia inserts futuros.

---

## 11. Critérios de aceite (V1)

**Schema:**

- [ ] Migrations sobem limpo em `pnpm db:reset`; seed produz pelo menos 1 obrigação e 1 CRV vigente por moto seed.
- [ ] `vehicle_obligations` e `vehicle_documents` têm RLS habilitada e filtram por `get_user_tenants()`.
- [ ] Índice parcial garante 1 documento vigente por `(moto, tipo)`.
- [ ] View `motorcycle_cost_summary` retorna 1 linha por moto com totais zerados quando não há dados.

**Cadastro de moto:**

- [ ] Wizard 3 passos: criar moto preenchendo CRV no passo 2 cria 1 linha em `vehicle_documents` (is_current=true) + N linhas em `vehicle_obligations` conforme preenchido.
- [ ] Criar moto sem informar nada de documentação não falha; moto fica `documentation_status='unknown'`.
- [ ] Upload do CRV vai para bucket `vehicle-documents` e fica acessível via signed URL.

**Documentação anual:**

- [ ] `/documentacao` lista todas as obrigações da frota, filtrável por ano/tipo/status.
- [ ] Marcar como paga registra `paid_at`, `payment_method`, `receipt_url` e dispara `recompute_documentation_status`.
- [ ] Job diário move `pending → overdue` quando `due_date < hoje`; Dashboard reflete contagem.

**Transferência:**

- [ ] Registrar transferência cria novo CRV vigente e rebaixa o anterior; histórico mostra os dois.
- [ ] `motorcycles.registered_owner_*` atualiza para os dados da empresa.

**Multas:**

- [ ] Criar multa sem cliente é aceito; aparece no bloco "Aguardando identificação".
- [ ] Identificar locatário preenche `customer_id` e marca `driver_identified=true`; audit log registra.

**TCO:**

- [ ] Aba "Custo total" da moto soma corretamente obrigações pagas, manutenção concluída, multas-empresa pagas e despesas pagas dos últimos 12 meses.

**Geral:**

- [ ] `pnpm build` verde; `pnpm test` verde (regras puras do `documentation.ts` com cobertura Vitest).
- [ ] Notas Obsidian atualizadas: `Telas/Motos`, `Telas/Multas`, `Banco de Dados`, `Fluxos de Negócio`, `Estado Atual`.
- [ ] ADR 0005 escrito formalizando o modelo (vehicle_documents vs reaproveitar expenses).

---

## 12. Faseamento sugerido

| Fase | Escopo | Esforço |
|---|---|---|
| **F1 — Schema + core** | Migrations das 3 tabelas/colunas, schemas Zod, regras puras em `@gomoto/core/rules/documentation`, hooks de leitura em `@gomoto/data`. | 1-2 dias |
| **F2 — Wizard de motos repensado** | 3 passos, captura CRV + obrigações iniciais, upload de anexo. | 1-2 dias |
| **F3 — Tela de detalhe da moto** | `/motos/[id]` com 6 abas; reaproveita componentes existentes. | 2 dias |
| **F4 — Tela `/documentacao`** | Listagem cross-frota, CRUD obrigações, ações em lote. | 2 dias |
| **F5 — Ajustes em `/multas`** | Cliente opcional, bloco "Aguardando", form AIT, identificar locatário. | 1 dia |
| **F6 — TCO e KPIs** | View + cards na aba "Custo total" + KPI no Dashboard. | 1 dia |
| **F7 — Job de vencimento** | Edge Function `mark-overdue-obligations` agendada via cron Supabase. | 0.5 dia |

**Total V1 (F1-F7):** 8-10 dias focados, sem dependência da plataforma admin.

**Ordem de prioridade:**
- **F1 → F2 → F3** desbloqueia o fluxo principal (cadastrar moto com CRV + ver detalhe).
- **F4 → F7** robustece a operação anual.
- **F5 → F6** podem ir em paralelo após F1.

---

## 13. Decisões em aberto

| # | Pergunta | Hipóteses |
|---|---|---|
| D1 | Ao marcar uma `vehicle_obligation` como paga, criar automaticamente uma `expenses` espelho? | (A) Não — TCO vem da view, sem duplicar lançamentos. (B) Sim — `expenses` continua sendo a "verdade contábil". (C) Híbrido: flag por tenant em `settings`. |
| D2 | Seguro do veículo é obrigação anual ou contrato separado? | (A) Tratar como `vehicle_obligation type='insurance'` (mesma estrutura). (B) Tabela própria `vehicle_insurances` com apólice, vigência, cobertura. **Recomendação:** começar com (A) e migrar se UX provar limitação. |
| D3 | Multa sem locatário identificado — onde fica a UI principal? | (A) Bloco fixo no topo de `/multas` (visível imediato). (B) Filtro dedicado oculto até existir multa órfã. **Recomendação:** (A). |
| D4 | Documentação anual cobra automaticamente do cliente? | **Fora do V1** (mencionado em §3.2). Vira PRD próprio quando houver pricing model. |
| D5 | Modelar histórico de proprietários antes do dono anterior? | (A) Não — `previous_owner` cobre só o vendedor. (B) Sim — tabela `motorcycle_ownership_history`. **Recomendação:** (A); reabrir se compliance/seguradora exigir. |
| D6 | Detectar automaticamente o cliente provável de uma multa órfã via `contracts`? | (A) Sugestão UI com confiança calculada (1 contrato cobrindo a data → sugere com selo "Provável"; >1 → exige escolha manual). (B) Operador sempre escolhe manual. **Recomendação:** (A) — economiza tempo do operador comum (1 contrato cobre 90% dos casos). |
| D7 | UF do veículo é livre ou enum das 27 UFs? | (A) Texto livre 2 chars + regex `^[A-Z]{2}$`. (B) Enum no banco. **Recomendação:** (A) — regex já em `@gomoto/core/schemas` (vide `stateField`). |

---

## 14. Próximos passos

1. Revisão humana deste rascunho (Alan).
2. Fechar **D1, D2, D3, D6** antes de iniciar F1 (impactam o schema).
3. Escrever **ADR 0005 — Documentação do veículo como dossiê de obrigações + visão de TCO**.
4. Implementar **F1** (schema + core) como primeiro PR.
5. Atualizar [[Roadmap]] com as 7 fases.

---

## Tags

`#prd` `#motos` `#documentacao` `#tco`
