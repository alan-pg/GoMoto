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

  // Entrada (Spec 0010) — cobrança comum em `billings`, sem tabela própria
  // (ao contrário da Caução, que tem saldo/movimentações em `deposits`).
  const downPayment = billings.find(b => b.billing_type === 'down_payment')

  return (
    <>

      {/* ── Alerta de vencidas ────────────────────────────────────────── */}
      {overdueCount > 0 && (
        <span className="inline-flex rounded-full bg-danger-bg px-3 py-0.5 text-[13px] font-semibold text-danger">
          {overdueCount} cobrança{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* ── Cards de totais ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl bg-surface p-4">
          <p className="text-[12px] text-fg-mute">Total pago</p>
          <p className="mt-1 text-xl font-bold text-success">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <p className="text-[12px] text-fg-mute">Em aberto</p>
          <p className={`mt-1 text-xl font-bold ${totalPending > 0 ? 'text-info' : 'text-fg-mute'}`}>
            {formatCurrency(totalPending)}
          </p>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <p className="text-[12px] text-fg-mute">Vencido</p>
          <p className={`mt-1 text-xl font-bold ${totalOverdue > 0 ? 'text-danger' : 'text-fg-mute'}`}>
            {formatCurrency(totalOverdue)}
          </p>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <p className="text-[12px] text-fg-mute">Caução</p>
          <p className="mt-1 text-xl font-bold text-fg">
            {deposit != null ? formatCurrency(deposit.amount) : '—'}
          </p>
          {deposit && deposit.status !== 'received' && (
            <p className="mt-0.5 text-[12px] text-fg-mute">
              Saldo: {formatCurrency(deposit.balance)}
            </p>
          )}
        </div>
        <div className="rounded-xl bg-surface p-4">
          <p className="text-[12px] text-fg-mute">Entrada</p>
          <p className="mt-1 text-xl font-bold text-fg">
            {downPayment ? formatCurrency(netBillingAmount(downPayment)) : '—'}
          </p>
          {downPayment && downPayment.status !== 'paid' && (
            <p className="mt-0.5 text-[12px] text-fg-mute">
              {effectiveBillingStatus(downPayment) === 'overdue' ? 'Vencida' : 'Pendente'}
            </p>
          )}
        </div>
      </div>

      {/* ── Vínculo: cliente + veículo ─────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-[14px] font-bold text-primary">Vínculo</h2>
        <div className="grid grid-cols-2 gap-4">

          <div className="space-y-1 rounded-xl bg-surface p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-fg-mute" />
              <p className="text-[12px] font-medium uppercase tracking-wide text-fg-mute">Cliente</p>
            </div>
            {rental.customer ? (
              <>
                <p className="text-[15px] font-bold text-fg">{rental.customer.name}</p>
                {rental.customer.phone && <p className="text-[13px] text-fg-mute">{rental.customer.phone}</p>}
                {rental.customer.cpf   && <p className="text-[13px] text-fg-mute">CPF: {rental.customer.cpf}</p>}
                <Link
                  href={`/clientes/${rental.customer.id}`}
                  className="inline-flex items-center gap-1 text-[12px] text-fg-mute transition-colors hover:text-primary"
                >
                  Ver cliente <ChevronRight className="h-3 w-3" />
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-fg-mute">Não vinculado</p>
            )}
          </div>

          <div className="space-y-1 rounded-xl bg-surface p-4">
            <div className="flex items-center gap-2">
              <Bike className="h-4 w-4 text-fg-mute" />
              <p className="text-[12px] font-medium uppercase tracking-wide text-fg-mute">Veículo</p>
            </div>
            {rental.vehicle ? (
              <>
                <p className="font-mono text-[15px] font-bold text-primary">{rental.vehicle.license_plate}</p>
                <p className="text-[13px] text-fg">{rental.vehicle.make} {rental.vehicle.model}</p>
                {rental.vehicle.year_manufacture && (
                  <p className="text-[13px] text-fg-mute">{rental.vehicle.year_manufacture} · {rental.vehicle.color}</p>
                )}
                <Link
                  href={`/veiculos/${rental.vehicle.id}`}
                  className="inline-flex items-center gap-1 text-[12px] text-fg-mute transition-colors hover:text-primary"
                >
                  Ver veículo <ChevronRight className="h-3 w-3" />
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-fg-mute">Não vinculado</p>
            )}
          </div>
        </div>
      </section>

    </>
  )
}
