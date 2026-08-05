# 📊 Tela: Dashboard — [[GoMoto]]

Rota: `/dashboard` | Tipo: **Server Component** (assíncrono, sem `'use client'`)

> Única página do sistema que usa RSC — todas as queries rodam no servidor em paralelo (`Promise.all`).

## Seção 1 — Alertas de Risco

### Veículos Ociosos
- Critério: `status='available' AND updated_at <= 7 dias atrás`
- Exibe até 3: `"{license_plate} parada há 7+ dias"`
- Visual: chip com borda `#e65e24`, fundo `#3a180f`

### Clientes com Múltiplas Cobranças Vencidas
- Critério: customer_ids com 2+ registros `status='overdue'` (via `identifyCustomersWithMultipleOverdueCharges`)
- Visual: chip com borda `#ff9c9a`, fundo `#7c1c1c`

## Seção 2 — KPIs de Frota (4 cards)

| Card | Cálculo |
|---|---|
| **Utilização** | `rentedVehicles / totalVehicles * 100` + barra de progresso `#BAFF1A` |
| **Em Locação** | `COUNT vehicles WHERE status='rented'` |
| **Disponíveis** | `COUNT vehicles WHERE status='available'` |
| **Em Manutenção** | `COUNT vehicles WHERE status='maintenance'` |

## Seção 3 — KPIs Financeiros (4 cards)

| Card | Cálculo |
|---|---|
| **Total a Receber** | `SUM billings.original_amount - discount_amount WHERE status IN ('pending','overdue')` — **todos os meses** |
| **Em Atraso** | Subconjunto overdue do total a receber + `{count} cobranças · {rate}% inadimplência` |
| **Recebido no Mês** | `SUM billings.original_amount WHERE status='paid' AND due_date BETWEEN firstDay AND lastDay` |
| **Previsão Mensal** | `SUM rentals.cycle_amount WHERE status='active'` |

### Cálculo de Inadimplência %
```javascript
uniqueOverdueCustomers / activeClientsCount * 100
```

## Seção 4 — Atenção Agora

Chips clicáveis com link direto para a tela relevante. Sumidos quando não há pendências.

| Condição | Destino |
|---|---|
| Cobranças vencendo hoje | `/cobrancas` — chip vermelho |
| Cobranças vencendo amanhã | `/cobrancas` — chip laranja |
| Aprovações pendentes (mobile) | `/aprovacoes` — chip laranja |
| Locações vencendo em 15 dias | `/locacoes` — chip amarelo |
| Clientes na fila há 30+ dias | `/locacoes/fila` — chip amarelo |

## Seção 5 — Gráficos (via `<DashboardCharts />`)

### Gráfico 1 — Receita × Despesas (AreaChart — Recharts)
- **Período:** últimos 6 meses (`now - 5 meses` até fim do mês atual)
- **Dados:** `SUM incomes.amount` e `SUM expenses.amount` por mês
- **Visual:** área `#BAFF1A` (receita) e `#a880ff` (despesas), gradient 15%→0%, strokeWidth=2

### Gráfico 2 — Cobranças do Mês (BarChart — Recharts)
- **Dados:** billings do mês atual agrupados por status
- **Cores:** Pago `#28b438` · Pendente `#BAFF1A` · Vencido `#ff9c9a`

## Seção 6 — Widgets (grid `grid-cols-2 lg:grid-cols-4`)

### Widget 1 — Locações Ativas
```sql
SELECT id, cycle_amount, end_date, customers(name), vehicles(model, make, license_plate)
FROM rentals WHERE status='active' ORDER BY created_at DESC LIMIT 5
```

### Widget 2 — Cobranças Vencidas (com aging)
```sql
SELECT id, original_amount, due_date, customers(name)
FROM billings WHERE status='overdue' ORDER BY due_date ASC LIMIT 5
```
Dias de atraso coloridos: <7d `#ffba49` · 7-30d `#ff9c9a` · 30d+ `#c41e1e`

### Widget 3 — Manutenções (próximos 7 dias)
```sql
SELECT id, scheduled_date, type, vehicles(license_plate)
FROM maintenances WHERE completed=false AND scheduled_date BETWEEN hoje AND hoje+7d
```

### Widget 4 — Fila de Espera
```sql
SELECT id, created_at, position, customers(name)
FROM queue_entries ORDER BY position ASC LIMIT 5
```
Clientes com 30+ dias na fila recebem ícone de clock laranja.

## Queries (20 em paralelo via `Promise.all`)

| Tabela | Filtro | Para que |
|---|---|---|
| vehicles | count total | KPI utilização |
| vehicles | status='available' count | KPI frota |
| vehicles | status='rented' count | KPI frota |
| vehicles | status='maintenance' count | KPI frota |
| customers | active=true count | Inadimplência |
| billings | status='overdue', customer_id | Inadimplência + alerta múltiplos |
| billings | status in (pending, overdue) | KPI total a receber + em atraso |
| billings | status='overdue' LIMIT 5 | Widget vencidas |
| billings | status='paid', mês atual | KPI recebido no mês |
| rentals | status='active' LIMIT 5 | KPI previsão + widget locações |
| maintenance_records | status='pending' count | Atenção aprovações |
| rentals | status='active', end_date próximos 15d count | Atenção locações vencendo |
| billings | status='pending', due_date=hoje count | Atenção vencendo hoje |
| billings | status='pending', due_date=amanhã count | Atenção vencendo amanhã |
| vehicles | status='available', updated_at<=7d | Alerta ociosas |
| maintenances | completed=false, scheduled_date próximos 7d | Widget manutenções |
| queue_entries | ORDER BY position LIMIT 5 | Widget fila |
| incomes | date>=6meses | Gráfico receita |
| expenses | date>=6meses | Gráfico despesas |
| billings | due_date=mês atual | Gráfico status |

## Tags
`#projeto/tela` `#gomoto/dashboard`
