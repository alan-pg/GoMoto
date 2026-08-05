import Link from 'next/link'
import {
  ChevronRight, Users, Bike,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { effectiveBillingStatus, netBillingAmount } from '@/lib/billing-status'
import { getRentalCore } from './_lib/get-rental-core'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { rental, tenantId, supabase } = await getRentalCore(id)

  const [billingsResult, depositResult] = await Promise.all([
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

  const billings    = billingsResult.data ?? []
  const deposit     = depositResult.data as { amount: number; balance: number; status: string; received_at: string } | null

  // Totais financeiros — mesma regra de @/lib/billing-status usada em /financeiro,
  // para os dois nunca mostrarem números divergentes.
  const totalPaid = billings
    .filter(b => b.status === 'paid')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const totalPending = billings
    .filter(b => effectiveBillingStatus(b) === 'pending')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const overdueBillings = billings.filter(b => effectiveBillingStatus(b) === 'overdue')
  const totalOverdue = overdueBillings.reduce((s, b) => s + netBillingAmount(b), 0)
  const overdueCount = overdueBillings.length

  return (
    <>

      {/* ── Alerta de vencidas ────────────────────────────────────────── */}
      {overdueCount > 0 && (
        <span className="inline-flex rounded-full bg-[#7c1c1c] px-3 py-0.5 text-[13px] font-semibold text-[#ff9c9a]">
          {overdueCount} cobrança{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* ── Cards de totais ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl bg-[#202020] p-4">
          <p className="text-[12px] text-[#9e9e9e]">Total pago</p>
          <p className="mt-1 text-xl font-bold text-[#229731]">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="rounded-xl bg-[#202020] p-4">
          <p className="text-[12px] text-[#9e9e9e]">Em aberto</p>
          <p className={`mt-1 text-xl font-bold ${totalPending > 0 ? 'text-[#a880ff]' : 'text-[#9e9e9e]'}`}>
            {formatCurrency(totalPending)}
          </p>
        </div>
        <div className="rounded-xl bg-[#202020] p-4">
          <p className="text-[12px] text-[#9e9e9e]">Vencido</p>
          <p className={`mt-1 text-xl font-bold ${totalOverdue > 0 ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
            {formatCurrency(totalOverdue)}
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

    </>
  )
}
