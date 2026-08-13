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
  paid:      { label: 'Paga',      bg: 'bg-success-bg', text: 'text-success', border: 'border-success' },
  overdue:   { label: 'Vencida',   bg: 'bg-danger-bg', text: 'text-danger', border: 'border-danger' },
  pending:   { label: 'Pendente',  bg: 'bg-info-bg', text: 'text-info', border: 'border-info' },
  cancelled: { label: 'Cancelada', bg: 'bg-surface-2', text: 'text-fg-mute', border: 'border-divider' },
  prejudice: { label: 'Prejuízo',  bg: 'bg-warning-bg', text: 'text-warning', border: 'border-warning' },
}

const BILLING_TYPE_LABELS: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  deposit:       'Caução',
  down_payment:  'Entrada',
}

const SOURCE_LABELS: Record<string, string> = {
  cycle:        'Ciclo',
  rental_cycle: 'Ciclo',
  fine:         'Multa',
  maintenance:  'Manutenção',
  expense:      'Despesa',
  manual:       'Manual',
  deposit:      'Caução',
  down_payment: 'Entrada',
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
    <div className="min-h-screen bg-bg">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-divider bg-bg px-6">
        <Link href="/cobrancas" className="whitespace-nowrap text-[13px] text-fg-mute transition-colors hover:text-fg">
          ← Cobranças
        </Link>
        <span className="text-border">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-fg">
          {billing.description ?? `Cobrança #${id.slice(0, 8)}`}
        </h1>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + valor ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full border px-3 text-[13px] font-medium ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
            {statusCfg.label}
          </span>
          <span className="text-2xl font-bold text-fg">
            {formatCurrency(billing.original_amount)}
          </span>
          {billing.discount_amount ? (
            <span className="text-[14px] text-fg-mute">− {formatCurrency(billing.discount_amount)} desconto</span>
          ) : null}
          {creditApplied > 0 ? (
            <span className="text-[14px] text-fg-mute">− {formatCurrency(creditApplied)} crédito</span>
          ) : null}
          {amountDue > 0 && dynStatus !== 'paid' && dynStatus !== 'cancelled' && (
            <span className={`text-[14px] font-semibold ${dynStatus === 'overdue' ? 'text-danger' : 'text-info'}`}>
              = {formatCurrency(amountDue)} a pagar
            </span>
          )}
          {billing.charges_waived && (
            <span className="rounded-full bg-surface px-3 py-0.5 text-[12px] text-fg-mute">
              Encargos dispensados
            </span>
          )}
        </div>

        {/* ── Dados da cobrança ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">Cobrança</h2>
          <div className="overflow-hidden rounded-xl bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Tipo',           BILLING_TYPE_LABELS[billing.billing_type ?? 'one_time'] ?? '—'],
                  ['Origem',         SOURCE_LABELS[billing.source ?? ''] ?? billing.source ?? '—'],
                  ['Vencimento',     fmt(billing.due_date)],
                  ['Pago em',        billing.paid_at ? fmtDatetime(billing.paid_at) : null],
                  ['Forma de pag.',  billing.payment_method ? (PAYMENT_METHOD_LABELS[billing.payment_method] ?? billing.payment_method) : null],
                ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([label, value]) => (
                  <tr key={label} className="border-b border-divider last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-fg-mute">{label}</td>
                    <td className="h-9 px-4 text-fg">{value}</td>
                  </tr>
                ))}
                {billing.waiver_reason && (
                  <tr className="border-b border-divider last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-fg-mute">Motivo dispensa</td>
                    <td className="h-9 px-4 text-fg-mute italic">{billing.waiver_reason}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Vínculo ───────────────────────────────────────────────────── */}
        {(customer || vehicle) && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Vínculo</h2>
            <div className="grid grid-cols-2 gap-4">
              {customer && (
                <div className="space-y-1 rounded-xl bg-surface p-4">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-fg-mute">Cliente</p>
                  <p className="text-[15px] font-bold text-fg">{customer.name}</p>
                  {customer.phone && <p className="text-[13px] text-fg-mute">{customer.phone}</p>}
                  <Link href={`/clientes/${customer.id}`} className="text-[12px] text-fg-mute transition-colors hover:text-primary">
                    Ver cliente →
                  </Link>
                </div>
              )}
              {vehicle && (
                <div className="space-y-1 rounded-xl bg-surface p-4">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-fg-mute">Veículo</p>
                  <p className="font-mono text-[15px] font-bold text-primary">{vehicle.license_plate}</p>
                  <p className="text-[13px] text-fg">{vehicle.make} {vehicle.model}</p>
                  {billing.lease_id && (
                    <Link href={`/locacoes/${billing.lease_id}`} className="text-[12px] text-fg-mute transition-colors hover:text-primary">
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
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Encargos por atraso
              <span className="ml-2 text-[12px] font-normal text-fg-mute">{chargesCalc.days_overdue} dia{chargesCalc.days_overdue !== 1 ? 's' : ''} de atraso</span>
            </h2>
            <div className="overflow-hidden rounded-xl bg-surface">
              <table className="w-full text-[13px]">
                <tbody>
                  <tr className="border-b border-divider">
                    <td className="h-9 w-44 px-4 text-fg-mute">Multa</td>
                    <td className="h-9 px-4 font-mono text-fg">{formatCurrency(chargesCalc.fee)}</td>
                  </tr>
                  <tr className="border-b border-divider">
                    <td className="h-9 w-44 px-4 text-fg-mute">Juros</td>
                    <td className="h-9 px-4 font-mono text-fg">{formatCurrency(chargesCalc.interest)}</td>
                  </tr>
                  <tr>
                    <td className="h-9 w-44 px-4 font-medium text-fg">Total com encargos</td>
                    <td className="h-9 px-4 font-mono font-bold text-danger">{formatCurrency(amountDue + chargesCalc.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {chargesCalc?.grace_period_active && (
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-[13px] text-fg-mute">
              Dentro do período de carência — encargos não aplicados ainda.
            </p>
          </div>
        )}

        {/* ── Histórico de pagamentos ───────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">
            Pagamentos
            {payments.length > 0 && <span className="ml-2 text-[12px] font-normal text-fg-mute">({payments.length})</span>}
          </h2>
          {payments.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-surface py-8">
              <p className="text-[13px] text-fg-mute">Nenhum pagamento registrado.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Data</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Forma</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Valor</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 px-4 text-fg-soft">{fmtDatetime(p.paid_at)}</td>
                      <td className="h-9 px-4 text-fg-mute">{PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-success">{formatCurrency(p.amount)}</td>
                      <td className="h-9 max-w-[200px] truncate px-4 text-fg-mute">{p.notes ?? '—'}</td>
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
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Encargos registrados
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({lateCharges.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Data</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Multa</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Juros</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Total</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {lateCharges.map(lc => (
                    <tr key={lc.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 px-4 text-fg-soft">{fmtDatetime(lc.captured_at)}</td>
                      <td className="h-9 px-4 text-right font-mono text-fg">{formatCurrency(lc.fee)}</td>
                      <td className="h-9 px-4 text-right font-mono text-fg">{formatCurrency(lc.interest)}</td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-danger">{formatCurrency(lc.total)}</td>
                      <td className="h-9 px-4 text-right text-fg-mute">{lc.days_overdue}</td>
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
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Créditos aplicados
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({creditApps.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Data</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Origem</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Valor</th>
                    <th className="h-9 px-4 font-medium text-fg-mute">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {creditApps.map(ca => (
                    <tr key={ca.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 px-4 text-fg-soft">{fmt(ca.created_at)}</td>
                      <td className="h-9 px-4 text-fg-mute">
                        {ca.credit ? (CREDIT_ORIGIN_LABELS[ca.credit.origin] ?? ca.credit.origin) : '—'}
                      </td>
                      <td className="h-9 px-4 text-right font-mono font-semibold text-info">{formatCurrency(ca.amount)}</td>
                      <td className="h-9 px-4 text-fg-mute">{ca.is_auto ? 'Automático' : 'Manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Ações ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">Ações</h2>
          <BillingActions
            billingId={id}
            status={dynStatus}
            amountDue={amountDue}
            accruedCharges={0}
            isOverdue={false}
            customerId={billing.customer_id ?? ''}
            availableCredits={availableCredits}
          />
        </section>

      </div>
    </div>
  )
}
