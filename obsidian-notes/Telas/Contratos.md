# 📄 Tela: Contratos — [[GoMoto]]

Rota: `/contratos/modelos` | Tipo: Client Component

> ⚠️ O item "Contratos" da sidebar aponta para [[Locações]] (`/locacoes`, contratos de locação já fechados). Esta nota cobre **`/contratos/modelos`** — o CRUD de modelos de contrato com editor de texto rico (Tiptap) e variáveis dinâmicas. Desde 2026-07-26 a geração real (dados de uma locação de verdade, não amostra) acontece em `/locacoes/nova` (Step 2 "Resumo do contrato") — ver [[Locações]].

## Arquivos

```
contratos/modelos/page.tsx                                  # listagem (grid de cards)
contratos/modelos/actions.ts                                # Server Actions: create/update/deleteContractTemplate
contratos/modelos/novo/page.tsx                              # criação
contratos/modelos/[id]/page.tsx                              # detalhe
contratos/modelos/[id]/editar/page.tsx                       # edição
contratos/modelos/[id]/editar/_components/EditTemplateForm.tsx
contratos/modelos/[id]/_components/TemplatePreview.tsx       # preview com dados de amostra + impressão
contratos/modelos/_components/ContractTemplateEditor.tsx     # editor Tiptap
contratos/modelos/_components/contractPageExtension.ts       # extensão Tiptap de paginação A4
```

Catálogo de variáveis `{{...}}`, `buildSampleData`, `substituteVariables` e `resolveContractVariables` moveram para `packages/core/src/rules/contract-variables.ts` (2026-07-26) — é lógica pura sem I/O, e `RentalForm.tsx` (rota diferente) também precisa dela. `apps/web/lib/contract-render.ts` (`renderContractTemplateHtml`) e `apps/web/lib/contract-print.ts` (`printHtmlDocument`) extraem o Tiptap→HTML e o iframe+`window.print()` que antes viviam inline em `TemplatePreview.tsx` — reaproveitados por `RentalForm.tsx` para gerar o contrato de uma locação real.

## Banco de dados

Tabela `contract_templates` (recriada em `20260706100000_contract_templates_rewrite.sql`):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | FK `tenants(id)`, RLS via `get_user_tenants()` |
| `name` | text | Nome do modelo |
| `description` | text | Opcional |
| `content` | jsonb | Documento Tiptap (rich text) |
| `created_at` / `updated_at` | timestamptz | Trigger `update_updated_at_column` |

Não há tabela/catálogo de variáveis no banco — a lista de variáveis é hardcoded em `packages/core/src/rules/contract-variables.ts`.

## Variáveis Dinâmicas Suportadas (`contract-variables.ts`)

`substituteVariables(html, data)` faz replace de `{{chave}}` via regex. `resolveContractVariables(input)` resolve o dicionário a partir de dados reais (usado por `RentalForm.tsx`); `buildSampleData()` continua gerando os dados fictícios do preview. Categorias e chaves atuais:

| Categoria | Chave | Fonte real de dado |
|---|---|---|
| Cliente | `nome_cliente` | `customers.name` |
| Cliente | `cpf_cliente` | `customers.cpf` (com `applyCpfMask`) |
| Cliente | `rg_cliente` | `customers.rg` (sem órgão emissor — coluna não existe) |
| Cliente | `cnh_cliente` | `customers.drivers_license` |
| Cliente | `categoria_cnh` | `customers.drivers_license_category` |
| Cliente | `endereco_cliente` | composto de `street`/`street_number`/`complement`/`neighborhood`/`city`/`state`/`zip_code` |
| Cliente | `cep_cliente` | `customers.zip_code` (com `applyZipMask`) |
| Veículo | `marca_veiculo` | `vehicles.make` |
| Veículo | `modelo_veiculo` | `vehicles.make` + `vehicles.model` |
| Veículo | `ano_fabricacao_veiculo` | `vehicles.year_manufacture` |
| Veículo | `ano_modelo_veiculo` | `vehicles.year_model` |
| Veículo | `ano_fab_mod_veiculo` | concatenação de `year_manufacture`/`year_model` |
| Veículo | `renavam_veiculo` | `vehicles.renavam` (com `formatRenavam`) |
| Veículo | `placa_veiculo` | `vehicles.license_plate` |
| Veículo | `chassi_veiculo` | `vehicles.chassis` |
| Veículo | `cor_veiculo` | `vehicles.color` |
| Veículo | `combustivel_veiculo` | `vehicles.fuel` |
| Veículo | `km_inicial` | `vehicles.km_current` (decisão: KM atual do veículo, não `km_entry` — que é KM de entrada na frota, não desta locação) |
| Financeiro | `valor_ciclo` (nome canônico) / `valor_semanal` (alias legado) | valor do ciclo da locação por extenso, via `currencyToExtensoPtBr` (`packages/core/src/utils/currency-words.ts`) |
| Financeiro | `ciclo_cobranca` | "Mensal"/"Semanal" |
| Financeiro | `dia_vencimento` | `formatDueDay` (`packages/core/src/rules/rentals.ts`) |
| Financeiro | `caucao` | valor da caução por extenso, ou `"Não há caução"` |
| Datas | `data_inicio` / `data_fim` | `rentals.start_date`/`end_date` por extenso, via `formatDateExtensoPtBr` (`packages/core/src/utils/date-words.ts`) |
| Datas | `data_hoje` | computado em runtime, não é coluna |
| Empresa | `nome_empresa` | `tenants.legal_name` (fallback `tenants.name`) |

> As chaves de veículo usavam sufixo `_moto` (`placa_moto`, `marca_moto`, etc.) até 2026-07-26, quando foram renomeadas para `_veiculo` para alinhar com a generalização `motorcycle → vehicle` do [[0007-generalizacao-entidade-veiculo]]. Modelos já salvos no banco com `{{placa_moto}}` etc. ficam com o placeholder não substituído — só afeta modelos antigos não migrados manualmente.

## Preview (`TemplatePreview.tsx`)

`substituteVariables(html, buildSampleData())` — sempre com dados **fictícios fixos** (`sample:` de cada variável), nunca com dados reais de uma locação (isso é papel de `RentalForm.tsx`, ver [[Locações]]).

## Fluxo de CRUD

1. `page.tsx`: lista via `useContractTemplates()` (`@gomoto/data`), busca por nome/descrição, exclui via `deleteContractTemplate` (Server Action).
2. `novo/page.tsx` e `[id]/editar/`: editor Tiptap (`ContractTemplateEditor.tsx`) com toolbar de formatação + dropdown "Variável" (insere `{{chave}}` no cursor, agrupado por `VARIABLE_CATEGORIES`).
3. `actions.ts`: cada mutação resolve `tenant_id` server-side, valida com `ContractTemplateSchema` (`@gomoto/core`), grava, `logAction`, `revalidatePath`.

## Tags
`#projeto/tela` `#gomoto/contratos`
