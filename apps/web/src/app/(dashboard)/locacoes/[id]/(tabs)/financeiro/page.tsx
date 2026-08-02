import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import {
  effectiveBillingStatus, netBillingAmount, BILLING_STATUS_BADGE, BILLING_TYPE_LABEL,
} from '@/lib/billing-status'
import { getRentalCore } from '../_lib/get-rental-core'
import { fmt } from '../_lib/shared'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDatetime(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

type BillingRow = {
  id: string
  status: string
  original_amount: number
  discount_amount: number | null
  credit_applied: number | null
  due_date: string
  billing_type: string | null
  source: string | null
  description: string | null
}

type DepositMovementRow = {
  id: string
  movement_type: string
  amount: number
  reason: string | null
  created_at: string
}

type AdjustmentRow = {
  id: string
  justification: string
  previous_cycle_amount: number
  new_cycle_amount: number
  adjusted_at: string
}

const SOURCE_LABELS: Record<string, string> = {
  cycle:        'Ciclo',
  rental_cycle: 'Ciclo',
  fine:         'Multa',
  maintenance:  'Manutenção',
  expense:      'Despesa',
  manual:       'Manual',
  deposit:      'Caução',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RentalFinancialTab({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { tenantId, supabase } = await getRentalCore(id)

  const [billingsResult, depositResult, depositMovementsResult, adjustmentsResult] = await Promise.all([
    supabase
      .from('billings')
      .select('id, status, original_amount, discount_amount, credit_applied, due_date, billing_type, source, description')
      .eq('lease_id', id)
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true }),
    supabase
      .from('deposits')
      .select('amount, balance, status')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'received'])
      .maybeSingle(),
    supabase
      .from('deposit_movements')
      .select('id, movement_type, amount, reason, created_at')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('rental_adjustments')
      .select('id, justification, previous_cycle_amount, new_cycle_amount, adjusted_at')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .order('adjusted_at', { ascending: false }),
  ])

  const deposit = depositResult.data as { amount: number; balance: number; status: string } | null
  const billings = (billingsResult.data ?? []) as unknown as BillingRow[]
  const depositMovements = (depositMovementsResult.data ?? []) as unknown as DepositMovementRow[]
  const adjustments = (adjustmentsResult.data ?? []) as unknown as AdjustmentRow[]

  // ── Totais ────────────────────────────────────────────────────────────────
  // Mesma regra de @/lib/billing-status usada em /locacoes/[id], para os dois
  // nunca mostrarem números divergentes.
  const totalPaid = billings
    .filter(b => b.status === 'paid')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const totalPending = billings
    .filter(b => effectiveBillingStatus(b) === 'pending')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const totalOverdue = billings
    .filter(b => effectiveBillingStatus(b) === 'overdue')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const totalBilled = billings.reduce((s, b) => s + b.original_amount, 0)

  // Caução: usa deposits.amount/balance como source of truth; deposit_movements para histórico detalhado.
  // Se ainda pendente (cobrança não paga), nada foi recebido de fato — mesmo a
  // linha em `deposits` já existindo com o valor contratado.
  const depositReceived  = deposit != null
    ? (deposit.status === 'pending' ? 0 : deposit.amount)
    : depositMovements.filter(m => m.movement_type === 'received').reduce((s, m) => s + m.amount, 0)
  const depositReturned  = depositMovements.filter(m => ['returned', 'partial_return'].includes(m.movement_type)).reduce((s, m) => s + m.amount, 0)
  const depositRetained  = depositMovements.filter(m => m.movement_type === 'retained').reduce((s, m) => s + m.amount, 0)
  const depositBalance   = deposit?.balance ?? (depositReceived - depositReturned - depositRetained)

  const MOVEMENT_TYPE_LABELS: Record<string, string> = {
    received:       'Recebida',
    returned:       'Devolvida',
    partial_return: 'Devolução parcial',
    retained:       'Retida',
    forfeited:      'Perdida',
  }

  return (
    <>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl bg-[#202020] p-4">
          <p className="text-[12px] text-[#9e9e9e]">Total emitido</p>
          <p className="mt-1 text-xl font-bold text-[#f5f5f5]">{formatCurrency(totalBilled)}</p>
          <p className="mt-0.5 text-[12px] text-[#616161]">{billings.length} cobranças</p>
        </div>
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
      </div>

      {/* ── Caução ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Caução</h2>
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          <table className="w-full text-[13px]">
            <tbody>
              <tr className="border-b border-[#323232]">
                <td className="h-9 w-52 px-4 text-[#9e9e9e]">Valor contratado</td>
                <td className="h-9 px-4 font-mono text-[#f5f5f5]">
                  {deposit != null ? formatCurrency(deposit.amount) : '—'}
                </td>
              </tr>
              <tr className="border-b border-[#323232]">
                <td className="h-9 w-52 px-4 text-[#9e9e9e]">Recebido</td>
                <td className="h-9 px-4 font-mono text-[#229731]">{formatCurrency(depositReceived)}</td>
              </tr>
              {depositReturned > 0 && (
                <tr className="border-b border-[#323232]">
                  <td className="h-9 w-52 px-4 text-[#9e9e9e]">Devolvido</td>
                  <td className="h-9 px-4 font-mono text-[#9e9e9e]">− {formatCurrency(depositReturned)}</td>
                </tr>
              )}
              {depositRetained > 0 && (
                <tr className="border-b border-[#323232]">
                  <td className="h-9 w-52 px-4 text-[#9e9e9e]">Retido</td>
                  <td className="h-9 px-4 font-mono text-[#e65e24]">− {formatCurrency(depositRetained)}</td>
                </tr>
              )}
              <tr>
                <td className="h-9 w-52 px-4 font-medium text-[#f5f5f5]">Saldo</td>
                <td className={`h-9 px-4 font-mono font-bold ${depositBalance > 0 ? 'text-[#BAFF1A]' : 'text-[#9e9e9e]'}`}>
                  {formatCurrency(depositBalance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Movimentações de caução ───────────────────────────────────── */}
      {depositMovements.length > 0 && (
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
            Movimentações de caução
            <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({depositMovements.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-[#323232]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tipo</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {depositMovements.map(m => (
                  <tr key={m.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                    <td className="h-9 px-4 text-[#c7c7c7]">{MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}</td>
                    <td className="h-9 px-4 text-[#9e9e9e]">{fmtDatetime(m.created_at)}</td>
                    <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">{formatCurrency(m.amount)}</td>
                    <td className="h-9 max-w-[200px] truncate px-4 text-[#9e9e9e]">{m.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Ajustes de mensalidade ───────────────────────────────────── */}
      {adjustments.length > 0 && (
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
            Ajustes de mensalidade
            <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({adjustments.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-[#323232]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Motivo</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Anterior</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Novo</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map(a => (
                  <tr key={a.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                    <td className="h-9 px-4 text-[#9e9e9e]">{fmt(a.adjusted_at)}</td>
                    <td className="h-9 max-w-[180px] truncate px-4 text-[#c7c7c7]">{a.justification}</td>
                    <td className="h-9 px-4 text-right font-mono text-[#9e9e9e]">{formatCurrency(a.previous_cycle_amount)}</td>
                    <td className="h-9 px-4 text-right font-mono font-semibold text-[#f5f5f5]">{formatCurrency(a.new_cycle_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Cobranças ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">
            Cobranças
            <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({billings.length})</span>
          </h2>
          <Link href="/cobrancas" className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
            Ver em cobranças →
          </Link>
        </div>
        {billings.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl bg-[#202020] py-8">
            <p className="text-[13px] text-[#616161]">Nenhuma cobrança.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#323232]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Vencimento</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tipo</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Origem</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  <th className="h-9 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {billings.map(b => {
                  const dynStatus = effectiveBillingStatus(b)
                  const badge     = BILLING_STATUS_BADGE[dynStatus] ?? BILLING_STATUS_BADGE.pending
                  return (
                    <tr key={b.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 px-4 text-[#c7c7c7]">{fmt(b.due_date)}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{BILLING_TYPE_LABEL[b.billing_type ?? 'one_time'] ?? '—'}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{SOURCE_LABELS[b.source ?? ''] ?? '—'}</td>
                      <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">{formatCurrency(b.original_amount)}</td>
                      <td className="h-9 px-4">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="h-9 px-4 text-right">
                        <Link href={`/cobrancas/${b.id}`} className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </>
  )
}
