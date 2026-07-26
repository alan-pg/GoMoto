# 📄 Tela: Contratos — [[GoMoto]]

Rota: `/contratos/modelos` | Tipo: Client Component

> ⚠️ O item "Contratos" da sidebar aponta para [[Locações]] (`/locacoes`, contratos de locação já fechados). Esta nota cobre **`/contratos/modelos`** — o CRUD de modelos de contrato com editor de texto rico (Tiptap) e variáveis dinâmicas. Não existe hoje uma tela que gere um contrato preenchido a partir de uma locação real — apenas preview com dados de amostra (ver seção Preview).

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
contratos/modelos/_components/variables.ts                   # catálogo de variáveis {{...}} do template
```

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

Não há tabela/catálogo de variáveis no banco — a lista de variáveis é hardcoded no frontend (`variables.ts`).

## Variáveis Dinâmicas Suportadas (`variables.ts`)

`substituteVariables(html, data)` faz replace de `{{chave}}` via regex. Categorias e chaves atuais:

| Categoria | Chave | Fonte real de dado (quando implementada) |
|---|---|---|
| Cliente | `nome_cliente` | `customers.name` |
| Cliente | `cpf_cliente` | `customers.cpf` |
| Cliente | `rg_cliente` | `customers.rg` (não há coluna de órgão emissor) |
| Cliente | `cnh_cliente` | `customers.drivers_license` |
| Cliente | `categoria_cnh` | `customers.drivers_license_category` |
| Cliente | `endereco_cliente` | sem coluna única — compor `street`/`street_number`/`neighborhood`/`city`/`state` |
| Cliente | `cep_cliente` | `customers.zip_code` |
| Veículo | `marca_veiculo` | `vehicles.make` |
| Veículo | `modelo_veiculo` | `vehicles.make` + `vehicles.model` |
| Veículo | `ano_fabricacao_veiculo` | `vehicles.year_manufacture` |
| Veículo | `ano_modelo_veiculo` | `vehicles.year_model` |
| Veículo | `ano_fab_mod_veiculo` | concatenação de `year_manufacture`/`year_model` |
| Veículo | `renavam_veiculo` | `vehicles.renavam` |
| Veículo | `placa_veiculo` | `vehicles.license_plate` |
| Veículo | `chassi_veiculo` | `vehicles.chassis` |
| Veículo | `cor_veiculo` | `vehicles.color` |
| Veículo | `combustivel_veiculo` | `vehicles.fuel` |
| Veículo | `km_inicial` | ambíguo: `vehicles.km_entry` vs. KM de checklist de entrega da locação |
| Financeiro | `valor_semanal` | `rentals.cycle_amount` — precisa conversão "por extenso" (não implementada) |
| Datas | `data_inicio` | `rentals.start_date` — precisa conversão "por extenso" (não implementada) |
| Datas | `data_hoje` | computado em runtime, não é coluna |
| Empresa | `nome_empresa` | `tenants.legal_name` ou `settings.value WHERE key='company_name'` |

> As chaves de veículo usavam sufixo `_moto` (`placa_moto`, `marca_moto`, etc.) até 2026-07-26, quando foram renomeadas para `_veiculo` para alinhar com a generalização `motorcycle → vehicle` do [[0007-generalizacao-entidade-veiculo]]. Modelos já salvos no banco com `{{placa_moto}}` etc. ficam com o placeholder não substituído — aceito porque a geração real (preenchimento com dados de uma locação) ainda não existe, só preview com dados de amostra.

## Preview (`TemplatePreview.tsx`)

`substituteVariables(html, buildSampleData())` — sempre com dados **fictícios fixos** (`sample:` de cada variável em `variables.ts`), nunca com dados reais de uma locação. Ainda não existe função de resolução real (`rentals`/`vehicles`/`customers` → variáveis).

## Fluxo de CRUD

1. `page.tsx`: lista via `useContractTemplates()` (`@gomoto/data`), busca por nome/descrição, exclui via `deleteContractTemplate` (Server Action).
2. `novo/page.tsx` e `[id]/editar/`: editor Tiptap (`ContractTemplateEditor.tsx`) com toolbar de formatação + dropdown "Variável" (insere `{{chave}}` no cursor, agrupado por `VARIABLE_CATEGORIES`).
3. `actions.ts`: cada mutação resolve `tenant_id` server-side, valida com `ContractTemplateSchema` (`@gomoto/core`), grava, `logAction`, `revalidatePath`.

## Tags
`#projeto/tela` `#gomoto/contratos`
