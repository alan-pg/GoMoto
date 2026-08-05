# 🏍️ Tela: Motos — [[GoMoto]]

Rota: `/motos` | Tipo: Client Component (`'use client'`)

## Layout

- **Mapa Leaflet** (460px altura, SSR=false, isolate z-index) — sempre visível no topo
- **Barra de filtros** abaixo do mapa: 4 pílulas de status + busca textual
- **Tabela** com 7 colunas

## Filtros

| Filtro | Valores | Campo |
|---|---|---|
| Pílulas de status | Todas / Disponíveis / Alugadas / Em Manutenção | `status` |
| Busca textual | Placa, modelo, marca ou cor (case-insensitive) | `license_plate`, `model`, `make`, `color` |

Cada pílula exibe **contador dinâmico**.

## Colunas da Tabela

| Coluna | Conteúdo |
|---|---|
| Placa | Placa + ponto colorido de status (verde/roxo/laranja/cinza) |
| Motocicleta | `{make} {model}` |
| Cliente | Nome do cliente com contrato ativo, ou "Sem locatário" em cinza |
| Valor/Semana | `monthly_amount` formatado — verde `#BAFF1A` se há contrato |
| Endereço | Endereço do cliente (truncado 180px), vazio se sem contrato |
| Status | `<StatusBadge status={...} />` |
| Ações | Eye (detalhes), Edit2 (editar), Trash2 (excluir) |

Clicar na linha → seleciona/centraliza moto no mapa.

## Formulário — Passo 1 (Dados Técnicos)

> Wizard 2 passos na **criação**. Edição pula direto pro passo 1 sem passo 2.

| Campo | Tipo | Required | Obs |
|---|---|---|---|
| Placa | text | ✓ | `.toUpperCase()` ao salvar |
| RENAVAM | text | ✓ | — |
| Marca | text | ✓ | `.toUpperCase()` |
| Modelo | text | ✓ | — |
| Ano (Fab/Mod) | text | ✓ | String simples |
| Cor | text | ✓ | `.toUpperCase()` |
| Combustível | select | — | GASOLINA / ÁLCOOL+GASOLINA / ELÉTRICO (default: GASOLINA) |
| Chassi | text | ✓ | `.toUpperCase()` |
| Cilindrada | text | — | Ex: 162cc |
| Dono Anterior | text | — | Nome conforme documento |
| CPF do Vendedor | text | — | — |
| Data da Compra | date | — | — |
| Valor FIPE (R$) | text | — | Sanitização: remove `.` milhar, troca `,` por `.`, parseFloat |
| Status na Frota | select | — | available / rented / maintenance / inactive |
| KM de Entrada | number | — | **Apenas criação** — zerado na edição propositalmente |
| Observações | textarea | — | 4 linhas, laudo de vistoria |

## Formulário — Passo 2 (Bootstrap de Manutenção)

Exibido **apenas na criação**. 13 itens de manutenção preventiva:

| Item | Intervalo |
|---|---|
| Troca de óleo | 1.000 km |
| Filtro de óleo | 4.000 km |
| Troca da relação (corrente/coroa/pinhão) | 12.000 km |
| Lona de freio traseira | 12.000 km |
| Pastilha de freio dianteira | 8.000 km |
| Pneu dianteiro | 12.000 km |
| Pneu traseiro | 8.000 km |
| Filtro de ar | 7.000 km |
| Velas de ignição | 10.000 km |
| Amortecedores | 25.000 km |
| Vistoria mensal | 30 dias |

Cada item tem input de KM (tipo km) ou data (tipo data). Ao salvar: cria 13 registros em `maintenances` com `predicted_km` ou `scheduled_date` calculados. Itens vencidos recebem observação de aviso.

## Queries Supabase

```sql
-- Fetch inicial (paralelo)
SELECT * FROM motorcycles ORDER BY created_at DESC
SELECT *, customer:customers(*) FROM contracts WHERE status = 'active'

-- Criar moto
INSERT INTO motorcycles (..., km_current) RETURNING id

-- Bootstrap (logo após criar)
INSERT INTO maintenances (...) -- múltiplos registros

-- Editar
UPDATE motorcycles SET (...) WHERE id = ?  -- sem km_current

-- Deletar
DELETE FROM motorcycles WHERE id = ?
```

## Estados

| Estado | Renderização |
|---|---|
| loading | Spinner + "Carregando frota..." |
| fetchError | Banner vermelho `bg-[#7c1c1c]` + botão "Tentar novamente" |
| Vazio | Ícone Bike + "Nenhum veículo encontrado." + "Limpar filtros" |
| saving | `Button loading={true}` no modal |

## Lógica Especial

- **`contractByMotoId`** (useMemo): Map `motorcycle_id → contrato+cliente`, O(1) lookup na tabela
- **`filteredMotorcycles`** (useMemo): cascata status → busca; recalcula só quando dados/filtros mudam
- **`visibleMotoIds`**: apenas motos da lista filtrada aparecem no mapa
- **Cores do ponto de status:** available `#28b438` · rented `#a880ff` · maintenance `#e65e24` · inactive `#474747`

## Histórico de Vistorias (Spec 0009, 2026-07-30)

Esta nota cobre só a lista (`/motos`); a tela de **detalhe** (`apps/web/src/app/(dashboard)/veiculos/[id]/page.tsx`, sem nota própria ainda) ganhou uma seção "Histórico de Vistorias" — agrega `inspections` de todas as locações do veículo (`rental:rentals!inner(vehicle_id)`, RF-023/RN-012), com link para `/vistorias/execute/[id]`.

## Tags
`#projeto/tela` `#gomoto/motos`
