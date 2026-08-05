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
  revenue: '#BAFF1A',
  expenses: '#a880ff',
}

const STATUS_COLORS: Record<string, string> = {
  Pago: '#28b438',
  Pendente: '#BAFF1A',
  Vencido: '#ff9c9a',
}

const CHART_HEIGHT = 160

const axisTickStyle = {
  fill: '#9e9e9e',
  fontSize: 11,
}

const tooltipStyle = {
  backgroundColor: '#2a2a2a',
  border: '1px solid #474747',
  borderRadius: '8px',
  fontSize: '12px',
}

const tooltipLabelStyle = {
  color: '#f5f5f5',
  fontWeight: 'bold',
}

const tooltipItemStyle = {
  color: '#9e9e9e',
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
      <div className="rounded-2xl border border-[#474747] bg-[#202020] p-5 lg:col-span-2">
        <div className="mb-4">
          <h3 className="text-[20px] font-bold text-[#f5f5f5]">Receita × Despesas</h3>
          <p className="text-[12px] font-medium text-[#9e9e9e]">Últimos 6 meses</p>
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
            <CartesianGrid stroke="#323232" vertical={false} />
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

      <div className="rounded-2xl border border-[#474747] bg-[#202020] p-5">
        <div className="mb-4">
          <h3 className="text-[20px] font-bold text-[#f5f5f5]">Cobranças do Mês</h3>
          <p className="text-[12px] font-medium text-[#9e9e9e]">Por status</p>
        </div>

        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={billingChartData}>
            <CartesianGrid stroke="#323232" vertical={false} />
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
                  fill={STATUS_COLORS[entry.status] ?? '#474747'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
