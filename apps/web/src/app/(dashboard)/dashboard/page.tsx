import { Header } from '@/components/layout/Header'
import { StatCard } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DashboardCharts } from './DashboardCharts'
import { AlertTriangle, Bike, CalendarClock, Wallet } from 'lucide-react'

interface RecentContract {
  id: string
  monthly_amount: number
  end_date: string | null
  customers: { name: string } | null
  motorcycles: { model: string; make: string; license_plate: string } | null
}

interface OverdueBilling {
  id: string
  amount: number
  due_date: string
  customers: { name: string } | null
}

interface UpcomingMaintenance {
  id: string
  scheduled_date: string
  type: string
  motorcycles: { model: string; make: string; license_plate: string } | null
}

interface QueueEntry {
  id: string
  created_at: string
  position: number
  customers: { name: string } | null
}

interface IdleMotorcycle {
  model: string
  make: string
  license_plate: string
}

interface TopCustomer {
  name: string
  total: number
}

const MAINTENANCE_TYPE_LABELS = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Inspeção',
}

const MAINTENANCE_TYPE_COLORS = {
  preventive: 'text-[#BAFF1A]',
  corrective: 'text-[#ff9c9a]',
  inspection: 'text-[#a880ff]',
}

async function getDashboardData() {
  const supabase = await createClient()

  const { count: availableMotorcycles } = await supabase
    .from('motorcycles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'available')

  const { count: rentedMotorcycles } = await supabase
    .from('motorcycles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'rented')

  const { count: maintenanceMotorcycles } = await supabase
    .from('motorcycles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'maintenance')

  const { count: activeClients } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  const { data: overdueCustomersData } = await supabase
    .from('billings')
    .select('customer_id')
    .eq('status', 'overdue')

  const overduePaymentsCount = (overdueCustomersData || []).length
  const uniqueOverdueCustomers = new Set((overdueCustomersData || []).map((row) => row.customer_id)).size
  const activeClientsCount = activeClients ?? 0
  const defaultRate = activeClientsCount > 0
    ? Math.round((uniqueOverdueCustomers / activeClientsCount) * 100)
    : 0

  const overdueCountByCustomer: Record<string, number> = {}
  ;(overdueCustomersData || []).forEach((row) => {
    overdueCountByCustomer[row.customer_id] = (overdueCountByCustomer[row.customer_id] || 0) + 1
  })
  const multipleOverdueCustomerIds = Object.entries(overdueCountByCustomer)
    .filter(([, count]) => count >= 2)
    .map(([id]) => id)

  let multipleOverdueCustomers: { name: string }[] = []
  if (multipleOverdueCustomerIds.length > 0) {
    const { data: multiOverdueNames } = await supabase
      .from('customers')
      .select('name')
      .in('id', multipleOverdueCustomerIds)
    multipleOverdueCustomers = (multiOverdueNames || []) as { name: string }[]
  }

  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  const { data: recentContractsData } = await supabase
    .from('contracts')
    .select('id, monthly_amount, end_date, customers(name), motorcycles(model, make, license_plate)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: overduePaymentsData } = await supabase
    .from('billings')
    .select('id, amount, due_date, customers(name)')
    .eq('status', 'overdue')
    .order('due_date', { ascending: true })
    .limit(5)

  const today = now.toISOString().split('T')[0]
  const in15Days = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { count: expiringContractsCount } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('end_date', today)
    .lte('end_date', in15Days)

  const { data: upcomingMaintenancesData } = await supabase
    .from('maintenances')
    .select('id, scheduled_date, type, motorcycles(model, make, license_plate)')
    .eq('completed', false)
    .gte('scheduled_date', today)
    .order('scheduled_date', { ascending: true })
    .limit(5)

  const { data: queueEntriesData } = await supabase
    .from('queue_entries')
    .select('id, created_at, position, customers(name)')
    .order('created_at', { ascending: true })
    .limit(5)

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: idleMotorcyclesData } = await supabase
    .from('motorcycles')
    .select('model, make, license_plate')
    .eq('status', 'available')
    .lte('updated_at', sevenDaysAgo)
    .limit(3)
  const idleMotorcycles: IdleMotorcycle[] = (idleMotorcyclesData || []) as IdleMotorcycle[]

  const { data: topCustomersData } = await supabase
    .from('billings')
    .select('customer_id, amount, customers(name)')
    .eq('status', 'paid')

  const customerRevenue: Record<string, { name: string; total: number }> = {}
  ;(topCustomersData || []).forEach((row) => {
    const customer = Array.isArray(row.customers)
      ? row.customers[0]
      : (row.customers as { name: string } | null)
    const name = customer?.name ?? 'Cliente'
    if (!customerRevenue[row.customer_id]) {
      customerRevenue[row.customer_id] = { name, total: 0 }
    }
    customerRevenue[row.customer_id].total += Number(row.amount) || 0
  })
  const topCustomers: TopCustomer[] = Object.values(customerRevenue)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  // Last 6 months chart data
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0]

  const { data: sixMonthIncomesData } = await supabase
    .from('incomes')
    .select('amount, date')
    .gte('date', sixMonthsAgoStr)
    .lte('date', lastDay)

  const { data: sixMonthExpensesData } = await supabase
    .from('expenses')
    .select('amount, date')
    .gte('date', sixMonthsAgoStr)
    .lte('date', lastDay)

  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const revenueByMonth: Record<string, number> = {}
  const expensesByMonth: Record<string, number> = {}

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    revenueByMonth[key] = 0
    expensesByMonth[key] = 0
  }

  ;(sixMonthIncomesData || []).forEach((row) => {
    const key = row.date.substring(0, 7)
    if (key in revenueByMonth) revenueByMonth[key] += Number(row.amount) || 0
  })

  ;(sixMonthExpensesData || []).forEach((row) => {
    const key = row.date.substring(0, 7)
    if (key in expensesByMonth) expensesByMonth[key] += Number(row.amount) || 0
  })

  const monthlyChartData = Object.keys(revenueByMonth).map((key) => {
    const [, month] = key.split('-')
    return {
      month: monthLabels[parseInt(month, 10) - 1],
      revenue: revenueByMonth[key],
      expenses: expensesByMonth[key],
    }
  })

  // Billings by status this month
  const { data: billingsByStatusData } = await supabase
    .from('billings')
    .select('status, amount')
    .gte('due_date', firstDay)
    .lte('due_date', lastDay)

  const billingStatusMap: Record<string, { count: number; total: number }> = {
    paid: { count: 0, total: 0 },
    pending: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
  }

  ;(billingsByStatusData || []).forEach((row) => {
    if (row.status in billingStatusMap) {
      billingStatusMap[row.status].count++
      billingStatusMap[row.status].total += Number(row.amount) || 0
    }
  })

  const totalReceivable = billingStatusMap.pending.total + billingStatusMap.overdue.total

  const billingChartData = [
    { status: 'Pago', count: billingStatusMap.paid.count },
    { status: 'Pendente', count: billingStatusMap.pending.count },
    { status: 'Vencido', count: billingStatusMap.overdue.count },
  ]

  return {
    availableMotorcycles: availableMotorcycles ?? 0,
    rentedMotorcycles: rentedMotorcycles ?? 0,
    maintenanceMotorcycles: maintenanceMotorcycles ?? 0,
    overduePaymentsCount,
    defaultRate,
    monthlyChartData,
    billingChartData,
    totalReceivable,
    expiringContractsCount: expiringContractsCount ?? 0,
    recentContracts: (recentContractsData ?? []) as unknown as RecentContract[],
    overduePaymentsList: (overduePaymentsData ?? []) as unknown as OverdueBilling[],
    multipleOverdueCustomers,
    upcomingMaintenances: (upcomingMaintenancesData ?? []) as unknown as UpcomingMaintenance[],
    idleMotorcycles,
    topCustomers,
    queueEntries: (queueEntriesData ?? []) as unknown as QueueEntry[],
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        title="Dashboard"
        subtitle={`Visão geral — ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date())}`}
      />

      <div className="space-y-4 p-6">
        {(data.idleMotorcycles.length > 0 || data.multipleOverdueCustomers.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {data.idleMotorcycles.map((moto) => (
              <div
                key={moto.license_plate}
                className="flex items-center gap-2 rounded-full border border-[#e65e24] bg-[#3a180f] px-3 py-2"
              >
                <div className="w-1.5 h-1.5 bg-[#e65e24] rounded-full shrink-0" />
                <span className="text-[12px] text-[#e65e24] font-medium">
                  {moto.license_plate} parada há 7+ dias
                </span>
              </div>
            ))}
            {data.multipleOverdueCustomers.map((customer) => (
              <div
                key={customer.name}
                className="flex items-center gap-2 rounded-full border border-[#ff9c9a] bg-[#7c1c1c] px-3 py-2"
              >
                <div className="w-1.5 h-1.5 bg-[#ff9c9a] rounded-full shrink-0" />
                <span className="text-[12px] text-[#ff9c9a] font-medium">
                  {customer.name} 2+ cobranças vencidas
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Motos Disponíveis"
            value={data.availableMotorcycles}
            subtitle={data.rentedMotorcycles + ' alugadas · ' + data.maintenanceMotorcycles + ' manutenção'}
            icon={Bike}
          />
          <StatCard
            title="Cobranças Vencidas"
            value={data.overduePaymentsCount}
            subtitle={data.overduePaymentsCount > 0 ? `${data.defaultRate}% de inadimplência` : 'Tudo em dia'}
            icon={AlertTriangle}
          />
          <StatCard
            title="Contratos Vencendo"
            value={data.expiringContractsCount}
            subtitle="nos próximos 15 dias"
            icon={CalendarClock}
          />
          <StatCard
            title="Total a Receber"
            value={formatCurrency(data.totalReceivable)}
            subtitle="pendente + vencido no mês"
            icon={Wallet}
          />
        </div>

        <DashboardCharts
          monthlyChartData={data.monthlyChartData}
          billingChartData={data.billingChartData}
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#323232] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#f5f5f5]">Contratos Ativos</h3>
              <a href="/contratos" className="text-[12px] text-[#BAFF1A] font-bold">
                Ver todos
              </a>
            </div>
            {data.recentContracts.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-[#9e9e9e]">
                Nenhum contrato ativo.
              </div>
            ) : (
              data.recentContracts.slice(0, 4).map((contract, index, items) => (
                <div
                  key={contract.id}
                  className={`px-4 py-2.5 hover:bg-[#323232] transition-colors${index < items.length - 1 ? ' border-b border-[#323232]' : ''}`}
                >
                  <p className="text-[12px] font-medium text-[#f5f5f5] truncate">
                    {contract.customers?.name ?? 'Cliente'}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[12px] text-[#9e9e9e] truncate">
                      {contract.motorcycles?.license_plate ?? '-'}
                    </p>
                    <p className="text-[12px] text-[#9e9e9e]">
                      {formatCurrency(contract.monthly_amount)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#323232] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#f5f5f5]">Cobranças Vencidas</h3>
              <a href="/cobrancas" className="text-[12px] text-[#BAFF1A] font-bold">
                Ver todas
              </a>
            </div>
            {data.overduePaymentsList.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#9e9e9e]">Tudo em dia!</div>
            ) : (
              data.overduePaymentsList.slice(0, 4).map((payment, index, items) => {
                const daysOverdue = Math.max(
                  0,
                  Math.floor(
                    (new Date().getTime() -
                      new Date(payment.due_date + 'T12:00:00').getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                )

                return (
                  <div
                    key={payment.id}
                    className={`px-4 py-2.5 hover:bg-[#323232] transition-colors${index < items.length - 1 ? ' border-b border-[#323232]' : ''}`}
                  >
                    <p className="text-[12px] font-medium text-[#f5f5f5] truncate">
                      {payment.customers?.name ?? 'Cliente'}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-[12px] text-[#ff9c9a]">
                        {formatCurrency(payment.amount)}
                      </p>
                      <p className="text-[12px] text-[#9e9e9e]">{daysOverdue} dias</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#323232] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#f5f5f5]">Fila de Espera</h3>
              <a href="/fila" className="text-[12px] text-[#BAFF1A] font-bold">
                Ver fila
              </a>
            </div>
            {data.queueEntries.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#9e9e9e]">Fila vazia</div>
            ) : (
              data.queueEntries.slice(0, 4).map((entry, index, items) => {
                const waitDays = Math.floor(
                  (new Date().getTime() - new Date(entry.created_at).getTime()) /
                    (1000 * 60 * 60 * 24)
                )

                return (
                  <div
                    key={entry.id}
                    className={`px-4 py-2.5 hover:bg-[#323232] transition-colors${index < items.length - 1 ? ' border-b border-[#323232]' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-[#BAFF1A] text-[#121212] rounded-full w-5 h-5 inline-flex items-center justify-center text-[12px] font-bold">
                        {entry.position}
                      </span>
                      <p className="text-[12px] font-medium text-[#f5f5f5] truncate">
                        {entry.customers?.name ?? 'Cliente'}
                      </p>
                    </div>
                    <p className="mt-1 text-[12px] text-[#9e9e9e]">{waitDays} dias</p>
                  </div>
                )
              })
            )}
          </div>

          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#323232] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#f5f5f5]">Manutenções</h3>
              <a href="/manutencao" className="text-[12px] text-[#BAFF1A] font-bold">
                Ver todas
              </a>
            </div>
            {data.upcomingMaintenances.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#9e9e9e]">
                Nenhuma agendada
              </div>
            ) : (
              data.upcomingMaintenances.slice(0, 4).map((maintenance, index, items) => {
                return (
                  <div
                    key={maintenance.id}
                    className={`px-4 py-2.5 hover:bg-[#323232] transition-colors${index < items.length - 1 ? ' border-b border-[#323232]' : ''}`}
                  >
                    <p className="text-[12px] font-medium text-[#f5f5f5] truncate">
                      {maintenance.motorcycles?.license_plate ?? '-'}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p
                        className={`text-[12px] ${MAINTENANCE_TYPE_COLORS[maintenance.type as keyof typeof MAINTENANCE_TYPE_COLORS] ?? 'text-[#9e9e9e]'}`}
                      >
                        {MAINTENANCE_TYPE_LABELS[maintenance.type as keyof typeof MAINTENANCE_TYPE_LABELS] ??
                          maintenance.type}
                      </p>
                      <p className="text-[12px] text-[#9e9e9e]">
                        {formatDate(maintenance.scheduled_date)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#323232] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#f5f5f5]">Top Clientes</h3>
              <a href="/clientes" className="text-[12px] text-[#BAFF1A] font-bold hover:underline">Ver todos</a>
            </div>
            {data.topCustomers.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#9e9e9e]">Sem dados ainda</div>
            ) : (
              data.topCustomers.map((customer, index) => (
                <div
                  key={`${customer.name}-${index}`}
                  className={`px-4 py-2.5 hover:bg-[#323232] transition-colors${index < data.topCustomers.length - 1 ? ' border-b border-[#323232]' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-[#BAFF1A] shrink-0">{index + 1}º</span>
                    <p className="text-[12px] font-medium text-[#f5f5f5] truncate">{customer.name}</p>
                  </div>
                  <p className="text-[12px] text-[#9e9e9e]">{formatCurrency(customer.total)} total</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
