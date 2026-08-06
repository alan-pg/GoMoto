'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface MonthlyData {
  month: string
  revenue: number
  expenses: number
}

export interface BillingStatusData {
  status: string
  count: number
}

export interface DashboardChartsProps {
  monthlyChartData: MonthlyData[]
  billingChartData: BillingStatusData[]
}

const CHART_COLORS = {
  revenue: 'var(--primary)',
  expenses: 'var(--info)',
}

const STATUS_COLORS: Record<string, string> = {
  Pago: 'var(--success)',
  Pendente: 'var(--primary)',
  Vencido: 'var(--danger)',
}

const CHART_HEIGHT = 160

const axisTickStyle = {
  fill: 'var(--fg-mute)',
  fontSize: 11,
}

const tooltipStyle = {
  backgroundColor: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
}

const tooltipLabelStyle = {
  color: 'var(--fg)',
  fontWeight: 'bold',
}

const tooltipItemStyle = {
  color: 'var(--fg-mute)',
}

function formatCurrencyShort(value: number) {
  if (value >= 1000) {
    return `R$${Math.round(value / 1000)}k`
  }

  return `R$${Math.round(value)}`
}

export function DashboardCharts({
  monthlyChartData,
  billingChartData,
}: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
        <div className="mb-4">
          <h3 className="text-[20px] font-bold text-fg">Receita × Despesas</h3>
          <p className="text-[12px] font-medium text-fg-mute">Últimos 6 meses</p>
        </div>

        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={monthlyChartData}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.15} />
                <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.expenses} stopOpacity={0.15} />
                <stop offset="95%" stopColor={CHART_COLORS.expenses} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatCurrencyShort}
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="revenue"
              name="Receita"
              stroke={CHART_COLORS.revenue}
              fill="url(#colorRevenue)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="expenses"
              name="Despesas"
              stroke={CHART_COLORS.expenses}
              fill="url(#colorExpenses)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4">
          <h3 className="text-[20px] font-bold text-fg">Cobranças do Mês</h3>
          <p className="text-[12px] font-medium text-fg-mute">Por status</p>
        </div>

        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={billingChartData}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="status"
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
            />
            <YAxis allowDecimals={false} tick={axisTickStyle} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
            />
            <Bar dataKey="count" name="Quantidade" radius={[4, 4, 0, 0]}>
              {billingChartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={STATUS_COLORS[entry.status] ?? 'var(--border)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
