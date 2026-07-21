import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Edit2, X, RotateCcw, Zap, ChevronRight, Users, Bike,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
}

function calcBillingStatus(billing: { status: string; due_date: string }) {
  if (billing.status === 'paid')      return 'paid'
  if (billing.status === 'cancelled') return 'cancelled'
  if (billing.status === 'prejudice') return 'prejudice'
  const today = new Date(); today.setHours(0,0,0,0)
  const [y,m,d] = billing.due_date.split('-').map(Number)
  const due = new Date(y, m-1, d)
  if (due < today) return 'overdue'
  return 'pending'
}

const BILLING_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  paid:      { bg: 'bg-[#0e2f13]', text: 'text-[#229731]', label: 'Paga'       },
  overdue:   { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', label: 'Vencida'    },
  pending:   { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', label: 'Pendente'   },
  cancelled: { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Cancelada' },
  prejudice: { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', label: 'Prejuízo'  },
}

const BILLING_TYPE_LABEL: Record<string, string> = {
  cycle:        'Ciclo',
  one_time:     'Avulsa',
  complementary:'Complementar',
}

const CONTRACT_LABEL: Record<string, string> = {
  rental:      'Locação',
  rent_to_own: 'Compra Programada',
}

const CYCLE_LABEL: Record<string, string> = {
  weekly:  'Semanal',
  monthly: 'Mensal',
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:      { bg: 'bg-[#BAFF1A22]', text: 'text-[#BAFF1A]', label: 'Ativa'       },
  closed:      { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Encerrada'   },
  transferred: { bg: 'bg-[#60a5fa22]', text: 'text-[#60a5fa]', label: 'Transferida' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase  = await createClient()
  const tenantId  = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [rentalResult, billingsResult, depositResult] = await Promise.all([
    supabase
      .from('rentals')
      .select('*, customer:customers(id,name,phone,cpf), vehicle:vehicles(id,license_plate,make,model,year_manufacture,color)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('billings')
      .select('*')
      .eq('lease_id', id)
      .eq('tenant_id', tenantId)
      .order('due_date', { ascending: true }),
    supabase
      .from('deposits')
      .select('amount, balance, status, received_at')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  if (rentalResult.error || !rentalResult.data) notFound()

  const rental   = rentalResult.data
  const billings = billingsResult.data ?? []
  const deposit  = depositResult.data as { amount: number; balance: number; status: string; received_at: string } | null
  const statusCfg = STATUS_BADGE[rental.status] ?? STATUS_BADGE.closed
  const isActive  = rental.status === 'active'

  // Totais financeiros
  const totalPaid    = billings.filter(b => b.status === 'paid').reduce((s, b) => s + (b.original_amount ?? b.amount ?? 0), 0)
  const totalPending = billings.filter(b => ['pending','overdue'].includes(b.status)).reduce((s, b) => {
    const base    = b.original_amount ?? b.amount ?? 0
    const discount = b.discount_amount ?? 0
    return s + Math.max(0, base - discount)
  }, 0)
  const overdueCount = billings.filter(b => calcBillingStatus(b) === 'overdue').length

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-[#323232] bg-[#121212] px-6">
        <Link href="/locacoes" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Locações
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          {rental.customer?.name ?? '—'} · {rental.vehicle?.license_plate ?? '—'}
        </h1>

        <div className="flex items-center gap-2">
          {isActive && (
            <>
              <Link
                href={`/locacoes/${id}/cobranca-avulsa`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
                title="Cobrança Avulsa"
              >
                <Zap className="h-4 w-4" />
                Cobrança avulsa
              </Link>
              <Link
                href={`/locacoes/${id}/renovar`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
                title="Renovar"
              >
                <RotateCcw className="h-4 w-4" />
                Renovar
              </Link>
              <Link
                href={`/locacoes/${id}/encerrar`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#ff9c9a]/30 bg-[#7c1c1c] px-3 text-[13px] text-[#ff9c9a] transition-colors hover:bg-[#9c2c2c]"
                title="Encerrar"
              >
                <X className="h-4 w-4" />
                Encerrar
              </Link>
            </>
          )}
          <Link
            href={`/locacoes/${id}/financeiro`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
          >
            Financeiro
          </Link>
          <Link
            href={`/locacoes/${id}/editar`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#323232] px-3 text-[13px] text-[#f5f5f5] transition-colors hover:bg-[#474747]"
          >
            <Edit2 className="h-4 w-4" />
            Editar
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + resumo financeiro ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full border border-transparent px-3 text-[13px] font-medium ${statusCfg.bg} ${statusCfg.text}`}>
            {statusCfg.label}
          </span>
          <span className="text-2xl font-bold text-[#f5f5f5]">
            {rental.cycle_amount != null ? formatCurrency(rental.cycle_amount) : '—'}
            <span className="ml-1 text-[14px] font-normal text-[#9e9e9e]">/{CYCLE_LABEL[rental.cycle ?? 'monthly'] ?? 'ciclo'}</span>
          </span>
          {overdueCount > 0 && (
            <span className="rounded-full bg-[#7c1c1c] px-3 py-0.5 text-[13px] font-semibold text-[#ff9c9a]">
              {overdueCount} cobrança{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Cards de totais ───────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Total pago</p>
            <p className="mt-1 text-xl font-bold text-[#229731]">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Em aberto</p>
            <p className={`mt-1 text-xl font-bold ${totalPending > 0 ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
              {formatCurrency(totalPending)}
            </p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Caução</p>
            <p className="mt-1 text-xl font-bold text-[#f5f5f5]">
              {deposit != null ? formatCurrency(deposit.amount) : '—'}
            </p>
            {deposit && deposit.status !== 'received' && (
              <p className="mt-0.5 text-[12px] text-[#9e9e9e]">
                Saldo: {formatCurrency(deposit.balance)}
              </p>
            )}
          </div>
        </div>

        {/* ── Dados do contrato ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Contrato</h2>
          <div className="overflow-hidden rounded-xl bg-[#202020]">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Tipo',        CONTRACT_LABEL[rental.contract_type ?? 'rental']],
                  ['Ciclo',       CYCLE_LABEL[rental.cycle ?? 'monthly']],
                  ['Vencimento',  `Dia ${rental.due_day ?? '—'}`],
                  ['Início',      fmt(rental.start_date)],
                  ['Fim',         fmt(rental.end_date)],
                  ['Pro rata',    rental.use_pro_rata ? 'Sim' : 'Não'],
                  ...(rental.observations ? [['Observações', rental.observations]] : []),
                ] as [string, string][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Vínculo: cliente + veículo ─────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Vínculo</h2>
          <div className="grid grid-cols-2 gap-4">

            <div className="space-y-1 rounded-xl bg-[#202020] p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#9e9e9e]" />
                <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Cliente</p>
              </div>
              {rental.customer ? (
                <>
                  <p className="text-[15px] font-bold text-[#f5f5f5]">{rental.customer.name}</p>
                  {rental.customer.phone && <p className="text-[13px] text-[#9e9e9e]">{rental.customer.phone}</p>}
                  {rental.customer.cpf   && <p className="text-[13px] text-[#9e9e9e]">CPF: {rental.customer.cpf}</p>}
                  <Link
                    href={`/clientes/${rental.customer.id}`}
                    className="inline-flex items-center gap-1 text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                  >
                    Ver cliente <ChevronRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-[#616161]">Não vinculado</p>
              )}
            </div>

            <div className="space-y-1 rounded-xl bg-[#202020] p-4">
              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4 text-[#9e9e9e]" />
                <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Veículo</p>
              </div>
              {rental.vehicle ? (
                <>
                  <p className="font-mono text-[15px] font-bold text-[#BAFF1A]">{rental.vehicle.license_plate}</p>
                  <p className="text-[13px] text-[#f5f5f5]">{rental.vehicle.make} {rental.vehicle.model}</p>
                  {rental.vehicle.year_manufacture && (
                    <p className="text-[13px] text-[#9e9e9e]">{rental.vehicle.year_manufacture} · {rental.vehicle.color}</p>
                  )}
                  <Link
                    href={`/veiculos/${rental.vehicle.id}`}
                    className="inline-flex items-center gap-1 text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                  >
                    Ver veículo <ChevronRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-[#616161]">Não vinculado</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Timeline de cobranças ─────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#BAFF1A]">
              Cobranças
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({billings.length})</span>
            </h2>
            <Link
              href={`/cobrancas`}
              className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
            >
              Ver em cobranças →
            </Link>
          </div>

          {billings.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-[#202020] py-10">
              <p className="text-[13px] text-[#616161]">Nenhuma cobrança registrada.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#323232] bg-[#1a1a1a]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Vencimento</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tipo</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Descrição</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Desconto</th>
                    <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billings.map(b => {
                    const dynStatus = calcBillingStatus(b)
                    const badge     = BILLING_BADGE[dynStatus] ?? BILLING_BADGE.pending
                    return (
                      <tr key={b.id} className="h-9 border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                        <td className="px-4 text-[#c7c7c7]">{fmt(b.due_date)}</td>
                        <td className="px-4 text-[#9e9e9e]">
                          {BILLING_TYPE_LABEL[b.billing_type ?? 'cycle'] ?? '—'}
                        </td>
                        <td className="px-4 max-w-[200px] truncate text-[#c7c7c7]">
                          {b.description ?? '—'}
                        </td>
                        <td className="px-4 text-right font-mono text-[#f5f5f5]">
                          {formatCurrency(b.original_amount ?? b.amount ?? 0)}
                        </td>
                        <td className="px-4 text-right font-mono text-[#9e9e9e]">
                          {b.discount_amount ? `- ${formatCurrency(b.discount_amount)}` : '—'}
                        </td>
                        <td className="px-4">
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

      </div>
    </div>
  )
}
