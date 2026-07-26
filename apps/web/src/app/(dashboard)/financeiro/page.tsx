import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

function calcBillingStatus(status: string, dueDate: string) {
  if (status === 'paid')      return 'paid'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'prejudice') return 'prejudice'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  return due < today ? 'overdue' : 'pending'
}

type BillingRow = {
  id: string
  status: string
  original_amount: number
  discount_amount: number | null
  credit_applied: number | null
  due_date: string
  description: string | null
  billing_type: string | null
  source: string | null
  customer: { id: string; name: string } | null
  rental: { vehicle: { id: string; license_plate: string } | null } | null
  lease_id: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  cycle:       'Ciclo',
  fine:        'Multa',
  maintenance: 'Manutenção',
  expense:     'Despesa',
  manual:      'Manual',
  deposit:     'Caução',
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  paid:      { bg: 'bg-[#0e2f13]', text: 'text-[#229731]', label: 'Paga' },
  overdue:   { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', label: 'Vencida' },
  pending:   { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', label: 'Pendente' },
  cancelled: { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Cancelada' },
  prejudice: { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', label: 'Prejuízo' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FinancialDashboardPage() {
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const now   = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const monthEnd   = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

  const [monthBillingsResult, overdueBillingsResult, vehiclesResult, delinquentResult] = await Promise.all([
    // Cobranças do mês corrente — caução fica de fora: é garantia/depósito,
    // não receita operacional, e já tem exibição própria em /locacoes/[id].
    supabase
      .from('billings')
      .select('id, status, original_amount, discount_amount, credit_applied, due_date, description, billing_type, source, lease_id, customer:customers(id,name), rental:rentals(vehicle:vehicles(id,license_plate))')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .neq('billing_type', 'deposit')
      .gte('due_date', monthStart)
      .lt('due_date', monthEnd)
      .order('due_date', { ascending: true }),
    // Cobranças vencidas (qualquer mês) — mesma exclusão de caução
    supabase
      .from('billings')
      .select('id, status, original_amount, discount_amount, credit_applied, due_date, description, billing_type, source, lease_id, customer:customers(id,name), rental:rentals(vehicle:vehicles(id,license_plate))')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .neq('billing_type', 'deposit')
      .lt('due_date', monthStart)
      .order('due_date', { ascending: true })
      .limit(50),
    // Veículos com aquisição cadastrada (para ROI)
    supabase
      .from('vehicles')
      .select('id, license_plate, make, model, acquisition_value, sale_value, sold_at')
      .eq('tenant_id', tenantId)
      .not('acquisition_value', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10),
    // Clientes inadimplentes
    supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('delinquency_status', 'blocked'),
  ])

  const monthBillings = (monthBillingsResult.data ?? []) as unknown as BillingRow[]
  const overdueBillings = (overdueBillingsResult.data ?? []) as unknown as BillingRow[]
  const vehicles = vehiclesResult.data ?? []
  const delinquentCustomers = delinquentResult.data ?? []

  // KPIs do mês
  const totalBilledMonth  = monthBillings.reduce((s, b) => s + b.original_amount, 0)
  const totalPaidMonth    = monthBillings.filter(b => b.status === 'paid').reduce((s, b) => s + b.original_amount, 0)
  const totalPendingMonth = monthBillings.filter(b => calcBillingStatus(b.status, b.due_date) === 'pending').reduce((s, b) => {
    const base = b.original_amount - (b.discount_amount ?? 0) - (b.credit_applied ?? 0)
    return s + Math.max(0, base)
  }, 0)
  const totalOverdueAll = overdueBillings.reduce((s, b) => {
    const base = b.original_amount - (b.discount_amount ?? 0) - (b.credit_applied ?? 0)
    return s + Math.max(0, base)
  }, 0)

  const monthLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center border-b border-[#323232] bg-[#121212] px-6">
        <h1 className="text-[15px] font-bold text-[#f5f5f5] capitalize">{monthLabel}</h1>
        <span className="ml-2 text-[13px] text-[#9e9e9e]">— Painel financeiro</span>
      </div>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">

        {/* ── KPIs do mês ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Emitido no mês</p>
            <p className="mt-1 text-xl font-bold text-[#f5f5f5]">{formatCurrency(totalBilledMonth)}</p>
            <p className="mt-0.5 text-[12px] text-[#616161]">{monthBillings.length} cobranças</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Recebido no mês</p>
            <p className="mt-1 text-xl font-bold text-[#229731]">{formatCurrency(totalPaidMonth)}</p>
            <p className="mt-0.5 text-[12px] text-[#616161]">{monthBillings.filter(b => b.status === 'paid').length} pagas</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Pendente no mês</p>
            <p className="mt-1 text-xl font-bold text-[#a880ff]">{formatCurrency(totalPendingMonth)}</p>
            <p className="mt-0.5 text-[12px] text-[#616161]">{monthBillings.filter(b => calcBillingStatus(b.status, b.due_date) === 'pending').length} pendentes</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Vencidas (total)</p>
            <p className={`mt-1 text-xl font-bold ${overdueBillings.length > 0 ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
              {formatCurrency(totalOverdueAll)}
            </p>
            <p className="mt-0.5 text-[12px] text-[#616161]">{overdueBillings.length} cobranças</p>
          </div>
        </div>

        {/* ── Cobranças vencidas ────────────────────────────────────────── */}
        {overdueBillings.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-[#BAFF1A]">
                Cobranças vencidas
                <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({overdueBillings.length})</span>
              </h2>
              <Link href="/cobrancas" className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
                Ver em cobranças →
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Cliente</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Veículo</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Origem</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Vencimento</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueBillings.map(b => {
                    const net = Math.max(0, b.original_amount - (b.discount_amount ?? 0) - (b.credit_applied ?? 0))
                    return (
                      <tr key={b.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                        <td className="h-9 px-4">
                          {b.customer ? (
                            <Link href={`/clientes/${b.customer.id}`} className="text-[#c7c7c7] hover:text-[#BAFF1A]">
                              {b.customer.name}
                            </Link>
                          ) : <span className="text-[#616161]">—</span>}
                        </td>
                        <td className="h-9 px-4 font-mono text-[#9e9e9e]">{b.rental?.vehicle?.license_plate ?? '—'}</td>
                        <td className="h-9 px-4 text-[#9e9e9e]">{SOURCE_LABELS[b.source ?? ''] ?? '—'}</td>
                        <td className="h-9 px-4 text-[#ff9c9a]">{fmt(b.due_date)}</td>
                        <td className="h-9 px-4 text-right font-mono font-semibold text-[#ff9c9a]">{formatCurrency(net)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Cobranças do mês ──────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#BAFF1A]">
              Cobranças do mês
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({monthBillings.length})</span>
            </h2>
            <Link href="/cobrancas" className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
              Ver todas →
            </Link>
          </div>
          {monthBillings.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-[#202020] py-10">
              <p className="text-[13px] text-[#616161]">Nenhuma cobrança neste mês.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Cliente</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Veículo</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Vencimento</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {monthBillings.map(b => {
                    const dynStatus = calcBillingStatus(b.status, b.due_date)
                    const badge     = STATUS_BADGE[dynStatus] ?? STATUS_BADGE.pending
                    return (
                      <tr key={b.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                        <td className="h-9 px-4">
                          {b.customer ? (
                            <Link href={`/cobrancas/${b.id}`} className="text-[#c7c7c7] hover:text-[#BAFF1A]">
                              {b.customer.name}
                            </Link>
                          ) : (
                            <Link href={`/cobrancas/${b.id}`} className="text-[#616161] hover:text-[#BAFF1A]">
                              {b.description ?? '—'}
                            </Link>
                          )}
                        </td>
                        <td className="h-9 px-4 font-mono text-[#9e9e9e]">{b.rental?.vehicle?.license_plate ?? '—'}</td>
                        <td className="h-9 px-4 text-[#c7c7c7]">{fmt(b.due_date)}</td>
                        <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">{formatCurrency(b.original_amount)}</td>
                        <td className="h-9 px-4">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Clientes bloqueados ───────────────────────────────────────── */}
        {delinquentCustomers.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Clientes bloqueados
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({delinquentCustomers.length})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {delinquentCustomers.map(c => (
                <Link
                  key={c.id}
                  href={`/clientes/${c.id}`}
                  className="inline-flex h-8 items-center rounded-full border border-[#ff9c9a]/30 bg-[#7c1c1c]/50 px-3 text-[13px] text-[#ff9c9a] transition-colors hover:bg-[#7c1c1c]"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── ROI de veículos ───────────────────────────────────────────── */}
        {vehicles.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-[#BAFF1A]">ROI de veículos</h2>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Veículo</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Aquisição</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Venda</th>
                    <th className="h-9 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => (
                    <tr key={v.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 px-4">
                        <Link href={`/financeiro/veiculos/${v.id}`} className="flex items-center gap-2 hover:text-[#BAFF1A]">
                          <span className="font-mono text-[#BAFF1A]">{v.license_plate}</span>
                          <span className="text-[#9e9e9e]">{v.make} {v.model}</span>
                        </Link>
                      </td>
                      <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">
                        {v.acquisition_value != null ? formatCurrency(v.acquisition_value) : '—'}
                      </td>
                      <td className="h-9 px-4 text-right font-mono text-[#9e9e9e]">
                        {v.sale_value != null ? formatCurrency(v.sale_value) : '—'}
                      </td>
                      <td className="h-9 px-4 text-right">
                        <Link href={`/financeiro/veiculos/${v.id}`} className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
                          Ver ROI →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}
