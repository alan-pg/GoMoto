# 🗄️ Banco de Dados — [[GoMoto]]

Backend [[Supabase]] (PostgreSQL). Local: `http://127.0.0.1:54321` (Docker). Cloud: produção, só recebe mudança via `supabase db push` controlado por humano.

> 🚧 **Redesenho financeiro em andamento.** O domínio financeiro está sendo substituído por um ledger de movimentos com contrapartida — ver [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]] e [[Specs/0014-redesenho-financeiro|Spec 0014]]. As tabelas marcadas ⛔ abaixo serão removidas. Esta nota descreve o estado **atual** e é atualizada conforme as migrations avançam.

## Panorama

45 objetos em `public` (43 tabelas + 2 views), 94 migrations versionadas em `supabase/migrations/`.

## Multi-tenancy

Implementado (fase 5). Toda tabela de domínio tem `tenant_id NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, RLS habilitada e política `tenant_isolation_*` via a função `get_user_tenants()`.

Exceções deliberadas — catálogos globais sem `tenant_id`: `permission_modules`, `permissions`, `role_permissions`.

| Tabela | Função |
|---|---|
| `tenants` | Empresas (locadoras) |
| `tenant_members` | Vínculo usuário ↔ tenant, com papel e ciclo de vida |
| `platform_admins` | Administradores da plataforma (control plane) |
| `platform_audit_logs` | Auditoria de ações do control plane |

## Core do negócio

| Tabela | Função |
|---|---|
| `vehicles` | Frota (renomeada de `motorcycles` na ADR 0012) |
| `vehicle_photos` | Galeria por slot (ADR 0010) |
| `vehicle_documents` | Documentação do veículo |
| `vehicle_status_history` | Histórico append-only de status (ADR 0011) |
| `customers` | Clientes PF e PJ, com vínculo opcional a `auth.users` |
| `clients_documents` | Documentos do cliente |
| `rentals` | Locações |
| `queue_entries` | Fila de espera |
| `contract_templates` | Modelos `.docx` de contrato |
| `settings` | Config por tenant, key/value |
| `processes` | Base de conhecimento Q&A interna |
| `audit_logs` | Log de ações (`logAction`) |

## Financeiro (estado atual)

| Tabela | Função | Destino |
|---|---|---|
| `billings` | Cobranças ao cliente | ⛔ → `charges` + `charge_items` |
| `payments` | Recibo de quitação, 1:1 com cobrança | ↻ recriada sem `UNIQUE(billing_id)` |
| `expenses` | Despesas da empresa | ⛔ → `payables` |
| `deposits` / `deposit_movements` | Caução com saldo em coluna | ↻ saldo passa a ser derivado |
| `customer_credits` / `credit_applications` | Créditos do cliente | ↻ saldo derivado |
| `late_charges` | Snapshot único de encargo | ⛔ encargo passa a ser calculado |
| `billing_pix` | Cobrança PIX (acoplada ao Mercado Pago) | ⛔ → `payment_intents` |
| `payment_connections` | Credenciais MP, uma por tenant | ⛔ → `payment_provider_accounts` |
| `rental_adjustments` | Histórico de reajuste | ↻ passa a atuar sobre cronograma |
| `delinquency_blocks` | Bloqueio manual de cliente | ✓ permanece |
| `vehicle_obligations` | IPVA, licenciamento, taxas | ↻ perde colunas de dinheiro |

**Views:** `vehicle_cost_summary` e `vehicle_financial_events` — ambas ⛔. A primeira tem bug de fan-out confirmado (cruza 4 `LEFT JOIN` irmãos e soma; erro medido de 5×).

## Operações

| Tabela | Função |
|---|---|
| `maintenances` | Manutenções (preventiva e corretiva) |
| `maintenance_items` | Itens padrão de manutenção |
| `maintenance_plans` / `maintenance_plan_items` | Planos preventivos (ADR 0006) |
| `maintenance_records` | Registro enviado pelo cliente, com aprovação |
| `fines` | Multas, com campos de NA/NP (PRD 0013) |
| `fine_attachments` | Anexos da multa |
| `inspections` | Vistorias |
| `inspection_profiles` + `inspection_profile_*_items` | Perfis de vistoria (ADR 0015) |
| `inspection_schedules` | Agendamento de vistoria periódica |

## Controle de acesso

`permission_modules`, `permissions`, `role_permissions` — catálogo global semeado (ADR 0022). Nesta versão é seed sem consumidor em runtime; a autorização efetiva usa `tenant_members.role` e `platform_admins.role`.

## Convenções obrigatórias

Toda tabela nova de domínio precisa de:

- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- RLS habilitada + política `tenant_isolation_<tabela>` via `get_user_tenants()`
- Trigger `update_updated_at_column` em `BEFORE UPDATE`
- Identificadores em inglês

Views devem usar `WITH (security_invoker = true)` para herdar o isolamento das tabelas base.

## Workflow

- `pnpm db:reset` — zera e roda o seed (`supabase/seed.sql`)
- `pnpm db:diff <nome>` — gera migration a partir de mudanças no Studio local
- `supabase migration new <nome>` — cria migration vazia

Detalhes em [[Desenvolvimento Local]].

## Tags

`#projeto/banco` `#stack/supabase`
