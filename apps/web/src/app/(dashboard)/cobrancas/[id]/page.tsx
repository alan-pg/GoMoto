import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import { calculateLateCharges } from '@gomoto/core'
import type { LateChargeConfig } from '@gomoto/core'
import { BillingActions } from './_components/BillingActions'

// ─── Local types ──────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string
  amount: number
  payment_method: string
  paid_at: string
  notes: string | null
}

type LateChargeRow = {
  id: string
  fee: number
  interest: number
  total: number
  days_overdue: number
  captured_at: string
}

type CreditApplicationRow = {
  id: string
  amount: number
  is_auto: boolean
  created_at: string
  credit: { origin: string; reason: string } | null
}

type CreditRow = {
  id: string
  amount: number
  available_balance: number
  origin: string
  reason: string
}

type BillingRow = {
  id: string
  status: string
  original_amount: number
  discount_amount: number | null
  credit_applied: number | null
  charges_waived: boolean | null
  waiver_reason: string | null
  late_charge_config: LateChargeConfig | null
  due_date: string
  billing_type: string | null
  source: string | null
  description: string | null
  lease_id: string | null
  customer_id: string | null
  paid_at: string | null
  payment_method: string | null
  rental: {
    id: string
    customer: { id: string; name: string; phone: string | null } | null
    vehicle: { id: string; license_plate: string; make: string; model: string } | null
  } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

function fmtDatetime(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function calcStatus(status: string, dueDate: string) {
  if (status === 'paid')      return 'paid'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'prejudice') return 'prejudice'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  return due < today ? 'overdue' : 'pending'
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  paid:      { label: 'Paga',      bg: 'bg-[#0e2f13]', text: 'text-[#229731]', border: 'border-[#229731]/30' },
  overdue:   { label: 'Vencida',   bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', border: 'border-[#ff9c9a]/30' },
  pending:   { label: 'Pendente',  bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', border: 'border-[#a880ff]/30' },
  cancelled: { label: 'Cancelada', bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', border: 'border-[#323232]' },
  prejudice: { label: 'Prejuízo',  bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', border: 'border-[#e65e24]/30' },
}

const BILLING_TYPE_LABELS: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  deposit:       'Caução',
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix:              'PIX',
  cash:             'Dinheiro',
  credit_card:      'Cartão de crédito',
  debit_card:       'Cartão de débito',
  bank_transfer:    'Transferência',
  other:            'Outro',
}

const CREDIT_ORIGIN_LABELS: Record<string, string> = {
  maintenance_refund: 'Estorno manutenção',
  reversal:          'Estorno',
  manual_adjustment: 'Ajuste manual',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BillingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [billingResult, paymentsResult, lateChargesResult, creditAppsResult] = await Promise.all([
    supabase
      .from('billings')
      .select('*, rental:rentals(id, customer:customers(id,name,phone), vehicle:vehicles(id,license_plate,make,model))')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('payments')
      .select('id, amount, payment_method, paid_at, notes')
      .eq('billing_id', id)
      .eq('tenant_id', tenantId)
      .order('paid_at', { ascending: false }),
    supabase
      .from('late_charges')
      .select('id, fee, interest, total, days_overdue, captured_at')
      .eq('billing_id', id)
      .eq('tenant_id', tenantId)
      .order('captured_at', { ascending: false }),
    supabase
      .from('credit_applications')
      .select('id, amount, is_auto, created_at, credit:customer_credits(origin, reason)')
      .eq('billing_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ])

  if (billingResult.error || !billingResult.data) notFound()

  const billing = billingResult.data as unknown as BillingRow
  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[]
  const lateCharges = (lateChargesResult.data ?? []) as unknown as LateChargeRow[]
  const creditApps = (creditAppsResult.data ?? []) as unknown as CreditApplicationRow[]

  // Fetch available credits for this customer
  let availableCredits: CreditRow[] = []
  if (billing.customer_id) {
    const { data } = await supabase
      .from('customer_credits')
      .select('id, amount, available_balance, origin, reason')
      .eq('customer_id', billing.customer_id)
      .eq('tenant_id', tenantId)
      .gt('available_balance', 0)
      .order('created_at', { ascending: true })
    availableCredits = (data ?? []) as unknown as CreditRow[]
  }

  const dynStatus = calcStatus(billing.status, billing.due_date)
  const statusCfg = STATUS_CONFIG[dynStatus] ?? STATUS_CONFIG.pending
  const baseAmount = billing.original_amount - (billing.discount_amount ?? 0)
  const creditApplied = billing.credit_applied ?? 0
  const amountDue = Math.max(0, baseAmount - creditApplied)

  // On-the-fly charges calculation
  const isOverdue = dynStatus === 'overdue'
  const chargesCalc = (isOverdue && billing.late_charge_config && !billing.charges_waived)
    ? calculateLateCharges(billing.late_charge_config, baseAmount, billing.due_date)
    : null

  const customer = billing.rental?.customer ?? null
  const vehicle  = billing.rental?.vehicle ?? null

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-[#323232] bg-[#121212] px-6">
        <Link href="/cobrancas" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Cobranças
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          {billing.description ?? `Cobrança #${id.slice(0, 8)}`}
        </h1>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + valor ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full border px-3 text-[13px] font-medium ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
            {statusCfg.label}
          </span>
          <span className="text-2xl font-bold text-[#f5f5f5]">
            {formatCurrency(billing.original_amount)}
          </span>
          {billing.discount_amount ? (
            <span className="text-[14px] text-[#9e9e9e]">− {formatCurrency(billing.discount_amount)} desconto</span>
          ) : null}
          {creditApplied > 0 ? (
            <span className="text-[14px] text-[#9e9e9e]">− {formatCurrency(creditApplied)} crédito</span>
          ) : null}
          {amountDue > 0 && dynStatus !== 'paid' && dynStatus !== 'cancelled' && (
            <span className={`text-[14px] font-semibold ${dynStatus === 'overdue' ? 'text-[#ff9c9a]' : 'text-[#a880ff]'}`}>
              = {formatCurrency(amountDue)} a pagar
            </span>
          )}
          {billing.charges_waived && (
            <span className="rounded-full bg-[#202020] px-3 py-0.5 text-[12px] text-[#9e9e9e]">
              Encargos dispensados
            </span>
          )}
        </div>

        {/* ── Dados da cobrança ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Cobrança</h2>
          <div className="overflow-hidden rounded-xl bg-[#202020]">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Tipo',           BILLING_TYPE_LABELS[billing.billing_type ?? 'one_time'] ?? '—'],
                  ['Origem',         SOURCE_LABELS[billing.source ?? ''] ?? billing.source ?? '—'],
                  ['Vencimento',     fmt(billing.due_date)],
                  ['Pago em',        billing.paid_at ? fmtDatetime(billing.paid_at) : null],
                  ['Forma de pag.',  billing.payment_method ? (PAYMENT_METHOD_LABELS[billing.payment_method] ?? billing.payment_method) : null],
                ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([label, value]) => (
                  <tr key={label} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value}</td>
                  </tr>
                ))}
                {billing.waiver_reason && (
                  <tr className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">Motivo dispensa</td>
                    <td className="h-9 px-4 text-[#9e9e9e] italic">{billing.waiver_reason}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Vínculo ───────────────────────────────────────────────────── */}
        {(customer || vehicle) && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Vínculo</h2>
            <div className="grid grid-cols-2 gap-4">
              {customer && (
                <div className="space-y-1 rounded-xl bg-[#202020] p-4">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Cliente</p>
                  <p className="text-[15px] font-bold text-[#f5f5f5]">{customer.name}</p>
                  {customer.phone && <p className="text-[13px] text-[#9e9e9e]">{customer.phone}</p>}
                  <Link href={`/clientes/${customer.id}`} className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
                    Ver cliente →
                  </Link>
                </div>
              )}
              {vehicle && (
                <div className="space-y-1 rounded-xl bg-[#202020] p-4">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Veículo</p>
                  <p className="font-mono text-[15px] font-bold text-[#BAFF1A]">{vehicle.license_plate}</p>
                  <p className="text-[13px] text-[#f5f5f5]">{vehicle.make} {vehicle.model}</p>
                  {billing.lease_id && (
                    <Link href={`/locacoes/${billing.lease_id}`} className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]">
                      Ver locação →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Encargos atuais ───────────────────────────────────────────── */}
        {chargesCalc && !chargesCalc.grace_period_active && chargesCalc.total > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Encargos por atraso
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">{chargesCalc.days_overdue} dia{chargesCalc.days_overdue !== 1 ? 's' : ''} de atraso</span>
            </h2>
            <div className="overflow-hidden rounded-xl bg-[#202020]">
              <table className="w-full text-[13px]">
                <tbody>
                  <tr className="border-b border-[#323232]">
                    <td className="h-9 w-44 px-4 text-[#9e9e9e]">Multa</td>
                    <td className="h-9 px-4 font-mono text-[#f5f5f5]">{formatCurrency(chargesCalc.fee)}</td>
                  </tr>
                  <tr className="border-b border-[#323232]">
                    <td className="h-9 w-44 px-4 text-[#9e9e9e]">Juros</td>
                    <td className="h-9 px-4 font-mono text-[#f5f5f5]">{formatCurrency(chargesCalc.interest)}</td>
                  </tr>
                  <tr>
                    <td className="h-9 w-44 px-4 font-medium text-[#f5f5f5]">Total com encargos</td>
                    <td className="h-9 px-4 font-mono font-bold text-[#ff9c9a]">{formatCurrency(amountDue + chargesCalc.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {chargesCalc?.grace_period_active && (
          <div className="rounded-xl border border-[#474747] bg-[#202020] px-4 py-3">
            <p className="text-[13px] text-[#9e9e9e]">
              Dentro do período de carência — encargos não aplicados ainda.
            </p>
          </div>
        )}

        {/* ── Histórico de pagamentos ───────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
            Pagamentos
            {payments.length > 0 && <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({payments.length})</span>}
          </h2>
          {payments.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-[#202020] py-8">
              <p className="text-[13px] text-[#616161]">Nenhum pagamento registrado.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Forma</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 px-4 text-[#c7c7c7]">{fmtDatetime(p.paid_at)}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-[#229731]">{formatCurrency(p.amount)}</td>
                      <td className="h-9 max-w-[200px] truncate px-4 text-[#616161]">{p.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Encargos capturados ───────────────────────────────────────── */}
        {lateCharges.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Encargos registrados
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({lateCharges.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Multa</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Juros</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Total</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {lateCharges.map(lc => (
                    <tr key={lc.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 px-4 text-[#c7c7c7]">{fmtDatetime(lc.captured_at)}</td>
                      <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">{formatCurrency(lc.fee)}</td>
                      <td className="h-9 px-4 text-right font-mono text-[#f5f5f5]">{formatCurrency(lc.interest)}</td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-[#ff9c9a]">{formatCurrency(lc.total)}</td>
                      <td className="h-9 px-4 text-right text-[#9e9e9e]">{lc.days_overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Créditos aplicados ────────────────────────────────────────── */}
        {creditApps.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Créditos aplicados
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({creditApps.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Origem</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 font-medium text-[#9e9e9e]">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {creditApps.map(ca => (
                    <tr key={ca.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 px-4 text-[#c7c7c7]">{fmt(ca.created_at)}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">
                        {ca.credit ? (CREDIT_ORIGIN_LABELS[ca.credit.origin] ?? ca.credit.origin) : '—'}
                      </td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-[#60a5fa]">{formatCurrency(ca.amount)}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{ca.is_auto ? 'Automático' : 'Manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Ações ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Ações</h2>
          <BillingActions
            billingId={id}
            status={dynStatus}
            amountDue={amountDue}
            chargesWaived={billing.charges_waived ?? false}
            availableCredits={availableCredits}
          />
        </section>

      </div>
    </div>
  )
}
