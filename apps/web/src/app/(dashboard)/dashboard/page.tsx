import { PageTitle } from '@/components/layout/PageTitle'
import { StatCard } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DashboardCharts } from './DashboardCharts'
import { identifyCustomersWithMultipleOverdueCharges } from '@gomoto/core'
import {
  AlertTriangle,
  Bike,
  CalendarClock,
  CheckCircle2,
  Clock,
  KeyRound,
  TrendingUp,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react'

interface ActiveRental {
  id: string
  cycle_amount: number | null
  end_date: string | null
  customers: { name: string } | null
  vehicles: { model: string; make: string; license_plate: string } | null
}

interface OverdueBilling {
  id: string
  original_amount: number
  due_date: string
  customers: { name: string } | null
}

interface UpcomingMaintenance {
  id: string
  scheduled_date: string
  type: string
  vehicles: { model: string; make: string; license_plate: string } | null
}

interface QueueEntry {
  id: string
  created_at: string
  position: number
  customers: { name: string } | null
}

interface IdleVehicle {
  model: string
  make: string
  license_plate: string
}

const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Inspeção',
}

const MAINTENANCE_TYPE_COLORS: Record<string, string> = {
  preventive: 'text-primary',
  corrective: 'text-danger',
  inspection: 'text-info',
}

function daysOverdue(dueDateStr: string): number {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(dueDateStr + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24),
    ),
  )
}

function overdueAgeColor(days: number): string {
  if (days >= 30) return 'text-critical'
  if (days >= 7) return 'text-danger'
  return 'text-pending'
}

async function getDashboardData() {
  const supabase = await createClient()

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const in15Days = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0]
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    vehicleTotalRes,
    vehicleAvailableRes,
    vehicleRentedRes,
    vehicleMaintenanceRes,
    activeClientsRes,
    overdueCustomersRes,
    allReceivableRes,
    overdueListRes,
    paidThisMonthRes,
    activeRentalsRes,
    forecastRentalsRes,
    pendingApprovalsRes,
    expiringRentalsRes,
    dueTodayRes,
    dueTomorrowRes,
    idleVehiclesRes,
    upcomingMaintenancesRes,
    queueEntriesRes,
    sixMonthPaymentsRes,
    sixMonthExpensesRes,
    billingsByStatusRes,
  ] = await Promise.all([
    supabase.from('vehicles').select('*', { count: 'exact', head: true }),
    supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('status', 'available'),
    supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('status', 'rented'),
    supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('status', 'maintenance'),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('active', true),
    // Caução fica fora destas agregações: é garantia/depósito, não receita
    // operacional, e um caução vencida não deve marcar o cliente como inadimplente.
    // Atraso derivado: `is_overdue` compara due_date com hoje. Antes a query
    // fazia esse OR porque nada gravava status='overdue' (F-04/F-12).
    // Só a lista de clientes com 2+ vencidas usa as LINHAS; contagem e valor
    // saem de `receivables_summary`. Fica com `.limit()` explícito: acima disso
    // o PostgREST cortaria em 1000 em silêncio, e o alerta de inadimplência
    // deixaria clientes de fora sem dizer nada.
    supabase.from('charge_balances').select('customer_id').eq('is_overdue', true).limit(2000),
    // Agregado no BANCO. Antes trazia as linhas e somava aqui — e PostgREST
    // corta em 1000 sem erro: passando disso, "Total a Receber" e "Em Atraso"
    // exibiriam a soma de um pedaço da carteira, com cara de número certo.
    supabase.from('receivables_summary').select('open_total, overdue_total, overdue_count, overdue_customers').maybeSingle(),
    supabase.from('charge_balances').select('charge_id, open_amount, due_date, customer_id').eq('is_overdue', true).order('days_overdue', { ascending: false }).limit(5),
    supabase.from('receivables_by_month').select('paid_total').eq('month', firstDayOfMonth).maybeSingle(),
    supabase.from('rentals').select('id, cycle_amount, end_date, customers(name), vehicles(model, make, license_plate)').eq('status', 'active').order('created_at', { ascending: false }).limit(5),
    // A previsão precisa de TODAS as ativas, não das 5 da lista acima. A
    // consulta é separada de propósito: `monthlyForecast` somava a lista, e a
    // `.limit(5)` dela — que existe para a tabela "locações recentes" — fazia o
    // KPI "soma das locações ativas" mostrar R$ 2.650 onde a frota rendia
    // R$ 27.750. Reaproveitar uma query paginada para agregar é o tipo de erro
    // que nenhum portão pega: o número existe, é plausível, e está errado.
    supabase.from('rentals').select('cycle_amount').eq('status', 'active'),
    supabase.from('maintenance_records').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('status', 'active').gte('end_date', today).lte('end_date', in15Days),
    supabase.from('charge_balances').select('*', { count: 'exact', head: true }).eq('status', 'open').eq('due_date', today),
    supabase.from('charge_balances').select('*', { count: 'exact', head: true }).eq('status', 'open').eq('due_date', tomorrow),
    supabase.from('vehicles').select('model, make, license_plate').eq('status', 'available').lte('updated_at', sevenDaysAgo).limit(3),
    supabase.from('maintenances').select('id, scheduled_date, type, vehicles(model, make, license_plate)').eq('completed', false).gte('scheduled_date', today).lte('scheduled_date', in7Days).order('scheduled_date', { ascending: true }).limit(5),
    supabase.from('queue_entries').select('id, created_at, position, customers(name)').order('position', { ascending: true }).limit(5),
    supabase.from('payments').select('amount, paid_at').gte('paid_at', sixMonthsAgo).lte('paid_at', lastDayOfMonth),
    supabase.from('payables').select('amount, customer_amount, competence_date').gte('competence_date', sixMonthsAgo).lte('competence_date', lastDayOfMonth),
    supabase.from('charge_balances').select('status, total_amount, due_date, is_overdue').gte('due_date', firstDayOfMonth).lte('due_date', lastDayOfMonth),
  ])

  // Fleet
  const totalVehicles = vehicleTotalRes.count ?? 0
  const availableVehicles = vehicleAvailableRes.count ?? 0
  const rentedVehicles = vehicleRentedRes.count ?? 0
  const maintenanceVehicles = vehicleMaintenanceRes.count ?? 0
  const utilizationPct = totalVehicles > 0 ? Math.round((rentedVehicles / totalVehicles) * 100) : 0

  // Financial — a carteira inteira, agregada no banco (todos os meses).
  // Saldo em aberto vem derivado; nada aqui recompõe valor a partir de
  // desconto ou crédito, e o atraso não é recalculado na tela (Princípio 4).
  const receivables = allReceivableRes.data as {
    open_total: number; overdue_total: number
    overdue_count: number; overdue_customers: number
  } | null

  const totalReceivable = Number(receivables?.open_total ?? 0)
  const overdueTotal    = Number(receivables?.overdue_total ?? 0)
  const paidThisMonth   = Number(
    (paidThisMonthRes.data as { paid_total: number } | null)?.paid_total ?? 0,
  )
  const monthlyForecast = (forecastRentalsRes.data ?? []).reduce(
    (sum, rental) => sum + (Number(rental.cycle_amount) || 0),
    0,
  )

  // Inadimplência
  const overdueCustomersData = overdueCustomersRes.data ?? []
  const overduePaymentsCount   = Number(receivables?.overdue_count ?? overdueCustomersData.length)
  const uniqueOverdueCustomers = Number(receivables?.overdue_customers
    ?? new Set(overdueCustomersData.map((row) => row.customer_id)).size)
  const activeClientsCount = activeClientsRes.count ?? 0
  const defaultRate =
    activeClientsCount > 0
      ? Math.round((uniqueOverdueCustomers / activeClientsCount) * 100)
      : 0

  // Multiple overdue customers alert (conditional second query)
  // A query já filtra `is_overdue`; as linhas vão direto, sem inventar status.
  const multipleOverdueCustomerIds = identifyCustomersWithMultipleOverdueCharges(overdueCustomersData)
  let multipleOverdueCustomers: { name: string }[] = []
  if (multipleOverdueCustomerIds.length > 0) {
    const { data } = await supabase
      .from('customers')
      .select('name')
      .in('id', multipleOverdueCustomerIds)
    multipleOverdueCustomers = (data ?? []) as { name: string }[]
  }

  // Attention items
  const dueTodayCount = dueTodayRes.count ?? 0
  const dueTomorrowCount = dueTomorrowRes.count ?? 0
  const pendingApprovals = pendingApprovalsRes.count ?? 0
  const expiringRentalsCount = expiringRentalsRes.count ?? 0

  const queueEntries = (queueEntriesRes.data ?? []) as unknown as QueueEntry[]
  const longWaitQueueCount = queueEntries.filter((e) => {
    const days = Math.floor(
      (now.getTime() - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    return days >= 30
  }).length

  // Charts
  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const revenueByMonth: Record<string, number> = {}
  const expensesByMonth: Record<string, number> = {}
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    revenueByMonth[key] = 0
    expensesByMonth[key] = 0
  }
  ;(sixMonthPaymentsRes.data ?? []).forEach((row) => {
    const key = (row.paid_at as string).substring(0, 7)
    if (key in revenueByMonth) revenueByMonth[key] += Number(row.amount) || 0
  })
  ;(sixMonthExpensesRes.data ?? []).forEach((row) => {
    const key = row.competence_date.substring(0, 7)
    // Custo da EMPRESA: o total menos a parte repassada ao cliente. Somar
    // `amount` cheio contaria como custo o que é recuperado (R-03).
    const companyShare = Number(row.amount ?? 0) - Number(row.customer_amount ?? 0)
    if (key in expensesByMonth) expensesByMonth[key] += companyShare
  })
  const monthlyChartData = Object.keys(revenueByMonth).map((key) => {
    const [, month] = key.split('-')
    return {
      month: monthLabels[parseInt(month, 10) - 1],
      revenue: revenueByMonth[key],
      expenses: expensesByMonth[key],
    }
  })

  const billingStatusMap: Record<string, { count: number; total: number }> = {
    paid: { count: 0, total: 0 },
    pending: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
  }
  ;(billingsByStatusRes.data ?? []).forEach((row) => {
    // 'open' + is_overdue → vencida; 'open' sem atraso → pendente.
    const effectiveStatus = row.is_overdue ? 'overdue' : row.status === 'open' ? 'pending' : row.status
    if (effectiveStatus in billingStatusMap) {
      billingStatusMap[effectiveStatus].count++
      billingStatusMap[effectiveStatus].total += Number(row.total_amount) || 0
    }
  })
  const billingChartData = [
    { status: 'Pago', count: billingStatusMap.paid.count },
    { status: 'Pendente', count: billingStatusMap.pending.count },
    { status: 'Vencido', count: billingStatusMap.overdue.count },
  ]

  return {
    // Fleet
    totalVehicles,
    availableVehicles,
    rentedVehicles,
    maintenanceVehicles,
    utilizationPct,
    // Financial
    totalReceivable,
    overdueTotal,
    paidThisMonth,
    monthlyForecast,
    overduePaymentsCount,
    defaultRate,
    // Attention
    dueTodayCount,
    dueTomorrowCount,
    pendingApprovals,
    expiringRentalsCount,
    longWaitQueueCount,
    // Alerts
    idleVehicles: (idleVehiclesRes.data ?? []) as IdleVehicle[],
    multipleOverdueCustomers,
    // Widgets
    activeRentals: (activeRentalsRes.data ?? []) as unknown as ActiveRental[],
    overduePaymentsList: (overdueListRes.data ?? []) as unknown as OverdueBilling[],
    upcomingMaintenances: (upcomingMaintenancesRes.data ?? []) as unknown as UpcomingMaintenance[],
    queueEntries,
    // Charts
    monthlyChartData,
    billingChartData,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  const attentionItems = [
    data.dueTodayCount > 0 && {
      label: `${data.dueTodayCount} cobranças vencem hoje`,
      href: '/cobrancas',
      color: 'red' as const,
    },
    data.dueTomorrowCount > 0 && {
      label: `${data.dueTomorrowCount} cobranças vencem amanhã`,
      href: '/cobrancas',
      color: 'orange' as const,
    },
    data.pendingApprovals > 0 && {
      label: `${data.pendingApprovals} aprovações pendentes`,
      href: '/aprovacoes',
      color: 'orange' as const,
    },
    data.expiringRentalsCount > 0 && {
      label: `${data.expiringRentalsCount} locações vencem em 15 dias`,
      href: '/locacoes',
      color: 'yellow' as const,
    },
    data.longWaitQueueCount > 0 && {
      label: `${data.longWaitQueueCount} na fila há 30+ dias`,
      href: '/locacoes/fila',
      color: 'yellow' as const,
    },
  ].filter(Boolean) as { label: string; href: string; color: 'red' | 'orange' | 'yellow' }[]

  const attentionColorMap = {
    red: {
      bg: 'bg-warning-bg',
      border: 'border-danger',
      dot: 'bg-danger',
      text: 'text-danger',
    },
    orange: {
      bg: 'bg-pending-bg',
      border: 'border-pending/50',
      dot: 'bg-pending',
      text: 'text-pending',
    },
    yellow: {
      bg: 'bg-primary-tint',
      border: 'border-primary',
      dot: 'bg-primary',
      text: 'text-primary',
    },
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageTitle
        title="Dashboard"
        subtitle={`Visão geral — ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date())}`}
      />

      <div className="space-y-4 p-6">

        {/* Risk alerts */}
        {(data.idleVehicles.length > 0 || data.multipleOverdueCustomers.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {data.idleVehicles.map((v) => (
              <div
                key={v.license_plate}
                className="flex items-center gap-2 rounded-full border border-warning bg-warning-bg px-3 py-2"
              >
                <div className="w-1.5 h-1.5 bg-warning rounded-full shrink-0" />
                <span className="text-[12px] text-warning font-medium">
                  {v.license_plate} parada há 7+ dias
                </span>
              </div>
            ))}
            {data.multipleOverdueCustomers.map((c) => (
              <div
                key={c.name}
                className="flex items-center gap-2 rounded-full border border-danger bg-danger-bg px-3 py-2"
              >
                <div className="w-1.5 h-1.5 bg-danger rounded-full shrink-0" />
                <span className="text-[12px] text-danger font-medium">
                  {c.name} — 2+ cobranças vencidas
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Fleet KPIs */}
        <div>
          <p className="text-[11px] font-semibold text-fg-mute uppercase tracking-widest px-1 mb-2">
            Frota
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Utilization — custom card */}
            <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-6 py-4">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-normal text-fg-mute">Utilização</p>
                <p className="text-[28px] font-bold text-fg">{data.utilizationPct}%</p>
                <div className="mt-2 w-full max-w-[100px] h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(data.utilizationPct, 100)}%` }}
                  />
                </div>
                <p className="text-[12px] mt-1 text-fg-mute">
                  {data.rentedVehicles} de {data.totalVehicles} motos
                </p>
              </div>
              <div className="rounded-full bg-surface-2 p-3 text-primary ml-4 shrink-0">
                <TrendingUp className="h-6 w-6" />
              </div>
            </div>

            <StatCard
              title="Em Locação"
              value={data.rentedVehicles}
              subtitle={`${data.totalVehicles} no total da frota`}
              icon={KeyRound}
            />
            <StatCard
              title="Disponíveis"
              value={data.availableVehicles}
              subtitle="prontas para locar"
              icon={Bike}
            />
            <StatCard
              title="Em Manutenção"
              value={data.maintenanceVehicles}
              subtitle="aguardando serviço"
              icon={Wrench}
            />
          </div>
        </div>

        {/* Financial KPIs */}
        <div>
          <p className="text-[11px] font-semibold text-fg-mute uppercase tracking-widest px-1 mb-2">
            Financeiro
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              title="Total a Receber"
              value={formatCurrency(data.totalReceivable)}
              subtitle="pendente + vencido (todos os meses)"
              icon={Wallet}
            />
            <StatCard
              title="Em Atraso"
              value={formatCurrency(data.overdueTotal)}
              subtitle={
                data.overduePaymentsCount > 0
                  ? `${data.overduePaymentsCount} cobranças · ${data.defaultRate}% inadimplência`
                  : 'Nenhuma cobrança em atraso'
              }
              icon={AlertTriangle}
            />
            <StatCard
              title="Recebido no Mês"
              value={formatCurrency(data.paidThisMonth)}
              subtitle="cobranças pagas este mês"
              icon={CheckCircle2}
            />
            <StatCard
              title="Previsão Mensal"
              value={formatCurrency(data.monthlyForecast)}
              subtitle="soma das locações ativas"
              icon={CalendarClock}
            />
          </div>
        </div>

        {/* Attention Now */}
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="text-[13px] font-semibold text-fg">Atenção Agora</h3>
          </div>
          {attentionItems.length === 0 ? (
            <p className="text-[13px] text-success">Tudo em dia — nenhuma pendência crítica.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {attentionItems.map((item) => {
                const colors = attentionColorMap[item.color]
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${colors.bg} ${colors.border} hover:brightness-110 transition-all`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
                    <span className={`text-[12px] font-medium ${colors.text}`}>{item.label}</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>

        {/* Charts */}
        <DashboardCharts
          monthlyChartData={data.monthlyChartData}
          billingChartData={data.billingChartData}
        />

        {/* Widgets */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Active Rentals */}
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-fg">Locações Ativas</h3>
              <a href="/locacoes" className="text-[12px] text-primary font-bold">
                Ver todas
              </a>
            </div>
            {data.activeRentals.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-fg-mute">
                Nenhuma locação ativa.
              </div>
            ) : (
              data.activeRentals.slice(0, 4).map((rental, index, items) => (
                <div
                  key={rental.id}
                  className={`px-4 py-2.5 hover:bg-surface-2 transition-colors${index < items.length - 1 ? ' border-b border-divider' : ''}`}
                >
                  <p className="text-[12px] font-medium text-fg truncate">
                    {rental.customers?.name ?? 'Cliente'}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[12px] text-fg-mute truncate">
                      {rental.vehicles?.license_plate ?? '—'}
                    </p>
                    <p className="text-[12px] text-fg-mute">
                      {rental.cycle_amount != null ? formatCurrency(rental.cycle_amount) : '—'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Overdue billings with aging */}
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-fg">Cobranças Vencidas</h3>
              <a href="/cobrancas" className="text-[12px] text-primary font-bold">
                Ver todas
              </a>
            </div>
            {data.overduePaymentsList.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-fg-mute">Tudo em dia!</div>
            ) : (
              data.overduePaymentsList.slice(0, 4).map((payment, index, items) => {
                const days = daysOverdue(payment.due_date)
                const ageColor = overdueAgeColor(days)
                return (
                  <div
                    key={payment.id}
                    className={`px-4 py-2.5 hover:bg-surface-2 transition-colors${index < items.length - 1 ? ' border-b border-divider' : ''}`}
                  >
                    <p className="text-[12px] font-medium text-fg truncate">
                      {payment.customers?.name ?? 'Cliente'}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className={`text-[12px] font-medium ${ageColor}`}>
                        {formatCurrency(payment.original_amount)}
                      </p>
                      <p className={`text-[11px] ${ageColor}`}>{days}d atraso</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Upcoming maintenances (7 days) */}
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-fg">Manutenções</h3>
              <a href="/manutencao" className="text-[12px] text-primary font-bold">
                Ver todas
              </a>
            </div>
            {data.upcomingMaintenances.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-fg-mute">
                Nenhuma nos próximos 7 dias
              </div>
            ) : (
              data.upcomingMaintenances.slice(0, 4).map((m, index, items) => (
                <div
                  key={m.id}
                  className={`px-4 py-2.5 hover:bg-surface-2 transition-colors${index < items.length - 1 ? ' border-b border-divider' : ''}`}
                >
                  <p className="text-[12px] font-medium text-fg truncate">
                    {m.vehicles?.license_plate ?? '—'}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p
                      className={`text-[12px] ${MAINTENANCE_TYPE_COLORS[m.type] ?? 'text-fg-mute'}`}
                    >
                      {MAINTENANCE_TYPE_LABELS[m.type] ?? m.type}
                    </p>
                    <p className="text-[12px] text-fg-mute">{formatDate(m.scheduled_date)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Queue */}
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-fg">Fila de Espera</h3>
              <a href="/locacoes/fila" className="text-[12px] text-primary font-bold">
                Ver fila
              </a>
            </div>
            {data.queueEntries.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-fg-mute">Fila vazia</div>
            ) : (
              data.queueEntries.slice(0, 4).map((entry, index, items) => {
                const waitDays = Math.floor(
                  (Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24),
                )
                const isLongWait = waitDays >= 30
                return (
                  <div
                    key={entry.id}
                    className={`px-4 py-2.5 hover:bg-surface-2 transition-colors${index < items.length - 1 ? ' border-b border-divider' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-primary text-bg rounded-full w-5 h-5 inline-flex items-center justify-center text-[11px] font-bold shrink-0">
                        {entry.position}
                      </span>
                      <p className="text-[12px] font-medium text-fg truncate">
                        {entry.customers?.name ?? 'Cliente'}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Clock className={`w-3 h-3 shrink-0 ${isLongWait ? 'text-pending' : 'text-fg-mute'}`} />
                      <p className={`text-[12px] ${isLongWait ? 'text-pending' : 'text-fg-mute'}`}>
                        {waitDays} dias na fila
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
