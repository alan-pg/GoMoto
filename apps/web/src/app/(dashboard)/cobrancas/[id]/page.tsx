import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { calculateAmountDue, type LateChargePolicy } from '@gomoto/core'
import { formatCurrency } from '@/lib/utils'
import { calculateLateCharges } from '@gomoto/core'
import type { LateChargeConfig } from '@gomoto/core'
import { BillingActions } from './_components/BillingActions'
import { ReversePaymentButton } from './_components/ReversePaymentButton'

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

/**
 * `charge_status` da ADR 0024: open | paid | cancelled | written_off.
 * `overdue` não é status armazenado — é derivado de `due_date` (Princípio 4) e
 * entra aqui só como chave de exibição, vindo de `charge_balances.is_overdue`.
 */
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  open:        { label: 'Em aberto', bg: 'bg-info-bg',    text: 'text-info',    border: 'border-info' },
  paid:        { label: 'Paga',      bg: 'bg-success-bg', text: 'text-success', border: 'border-success' },
  overdue:     { label: 'Vencida',   bg: 'bg-danger-bg',  text: 'text-danger',  border: 'border-danger' },
  cancelled:   { label: 'Cancelada', bg: 'bg-surface-2',  text: 'text-fg-mute', border: 'border-divider' },
  written_off: { label: 'Baixada',   bg: 'bg-warning-bg', text: 'text-warning', border: 'border-warning' },
}

/** Fora destes, a cobrança saiu de contas a receber e não há o que cobrar. */
const TERMINAL_STATUSES = new Set(['paid', 'cancelled', 'written_off'])

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
  // Abatimento por crédito grava `method = 'credit'` em `payments`. Faltava
  // aqui, então a linha aparecia como "credit" cru ao lado de "PIX" traduzido.
  credit:            'Crédito do cliente',
  deposit_retention: 'Retenção de caução',
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

  // Spec 0014: saldo e atraso vêm de `charge_balances`, derivados. A composição
  // do documento são os ITENS — `late_charges` e `credit_applications` deixaram
  // de existir: encargo é calculado até ser realizado (R-06), e aplicação de
  // crédito é transação no ledger.
  const [balanceResult, itemsResult, allocationsResult] = await Promise.all([
    supabase
      .from('charge_balances')
      .select('*')
      .eq('charge_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('charge_items')
      .select('id, description, credit_account_code, quantity, unit_amount, amount, source_module, created_at')
      .eq('charge_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    supabase
      .from('payment_allocations')
      .select('id, amount, created_at, payment:payments(id, amount, method, paid_at, notes, reversed_at)')
      .eq('charge_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ])

  if (balanceResult.error || !balanceResult.data) notFound()

  const balance = balanceResult.data as unknown as {
    charge_id: string; customer_id: string; rental_id: string | null
    charge_number: number; status: 'open' | 'paid' | 'cancelled' | 'written_off'
    issue_date: string; due_date: string
    total_amount: number; paid_amount: number; open_amount: number
    is_overdue: boolean; days_overdue: number
  }

  const items = (itemsResult.data ?? []) as unknown as {
    id: string; description: string; credit_account_code: string
    quantity: number; unit_amount: number; amount: number
    source_module: string; created_at: string
  }[]

  type AllocRow = {
    id: string; amount: number; created_at: string
    payment: { id: string; amount: number; method: string; paid_at: string; notes: string | null; reversed_at: string | null }
      | { id: string; amount: number; method: string; paid_at: string; notes: string | null; reversed_at: string | null }[]
      | null
  }
  const payments = ((allocationsResult.data ?? []) as unknown as AllocRow[]).map((a) => {
    const p = Array.isArray(a.payment) ? a.payment[0] : a.payment
    return {
      // `id` aqui é o da ALOCAÇÃO, e a linha da tabela é por alocação. O
      // estorno age sobre o PAGAMENTO — passar um pelo outro dá "pagamento não
      // encontrado" com os dois campos parecendo igualmente plausíveis.
      id: a.id,
      payment_id: p?.id ?? null,
      amount: a.amount,
      payment_method: p?.method ?? '—',
      paid_at: p?.paid_at ?? a.created_at,
      notes: p?.notes ?? null,
      reversed: !!p?.reversed_at,
    }
  })

  // Cliente e veículo em consulta separada: `charge_balances` agrega por
  // cobrança, e juntar tabelas ali reintroduziria o fan-out de F-01.
  const [customerRes, rentalRes] = await Promise.all([
    supabase.from('customers').select('id, name, phone').eq('id', balance.customer_id).maybeSingle(),
    balance.rental_id
      ? supabase.from('rentals').select('id, vehicles(id, license_plate, make, model)').eq('id', balance.rental_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const customer = customerRes.data as { id: string; name: string; phone: string | null } | null
  type RentalVehicle = { id: string; vehicles: { id: string; license_plate: string; make: string; model: string } | { id: string; license_plate: string; make: string; model: string }[] | null }
  const rentalRow = rentalRes.data as unknown as RentalVehicle | null
  const vehicle = rentalRow
    ? (Array.isArray(rentalRow.vehicles) ? rentalRow.vehicles[0] : rentalRow.vehicles)
    : null

  // Saldo de crédito do cliente — derivado, não coluna.
  const { data: creditBalanceRow } = await supabase
    .from('customer_credit_balances')
    .select('balance')
    .eq('customer_id', balance.customer_id)
    .maybeSingle()

  const creditBalance = (creditBalanceRow as { balance: number } | null)?.balance ?? 0

  const { data: creditRows } = await supabase
    .from('customer_credits')
    .select('id, amount, origin, reason, expires_at')
    .eq('customer_id', balance.customer_id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  const availableCredits = ((creditRows ?? []) as { id: string; amount: number; origin: string; reason: string }[])
    .map((c) => ({ ...c, available_balance: creditBalance }))

  // Encargo acumulado: projetado até ser consolidado (R-06).
  const { data: chargeRow } = await supabase
    .from('charges')
    .select('late_charge_policy_id')
    .eq('id', id)
    .maybeSingle()

  const policyId = (chargeRow as { late_charge_policy_id: string | null } | null)?.late_charge_policy_id
  let policy: LateChargePolicy | null = null

  if (policyId) {
    const { data: policyRow } = await supabase
      .from('late_charge_policies')
      .select('fee_type, fee_value, daily_interest_rate, grace_period_days, min_amount')
      .eq('id', policyId)
      .maybeSingle()

    policy = (policyRow ?? null) as LateChargePolicy | null
  }

  // Quanto esta cobrança deve — pela função canônica, a mesma que a LISTA de
  // cobranças e o app do cliente usam.
  //
  // Aqui a conta era refeita à mão: `isTerminal ? 0 : max(0, open + accrued)`.
  // Aritmeticamente igual, menos por um detalhe — a cópia perdeu o `round2`, e
  // devolvia resíduo de ponto flutuante (250.00000000000003 onde a lista dava
  // 250,00). Esse número vira o TETO do campo de recebimento, então as duas
  // telas discordavam sobre o valor exato que quita a dívida.
  //
  // A regra de status terminal continua valendo e agora vive num lugar só:
  // `charge_balances.open_amount` é a aritmética do documento (total − alocado)
  // e devolve o saldo de uma cobrança baixada — correto para registrar a perda,
  // errado de exibir como "a pagar".
  const { accrued, amount_due: amountDue } = calculateAmountDue(balance, policy)
  const isTerminal = TERMINAL_STATUSES.has(balance.status)
  const statusCfg = STATUS_CONFIG[balance.is_overdue ? 'overdue' : balance.status] ?? STATUS_CONFIG.open
  const isOverdue = balance.is_overdue

  // Encargo já calculado acima a partir da política fixada na emissão.
  const lateChargesList: { id: string; fee: number; interest: number; total: number; days_overdue: number; captured_at: string }[] = []
  const creditAppsList: { id: string; amount: number; is_auto: boolean; created_at: string; credit: { origin: string; reason: string } | null }[] = []
  const chargesCalc = accrued.total > 0 ? accrued : null

  // Alias com a forma que o JSX desta página consome. O item de maior valor
  // representa a cobrança no título — no modelo novo a descrição vive nos
  // ITENS, não no documento.
  const principalItem = [...items].sort((a, b) => b.amount - a.amount)[0]
  const billing = {
    id: balance.charge_id,
    charge_number: balance.charge_number,
    // billing_type e source saíram: a origem vive nos ITENS. O item principal
    // representa a cobrança quando a tela precisa de um rótulo único (F-11).
    billing_type: balance.rental_id ? 'cycle' : 'one_time',
    source: principalItem?.source_module ?? 'manual',
    paid_at: balance.status === 'paid' ? balance.due_date : null,
    payment_method: null as string | null,
    // Dispensa de encargo não existe mais: o encargo é projetado e só vira
    // receita quando consolidado (R-06) — não há o que dispensar.
    waiver_reason: null as string | null,
    lease_id: balance.rental_id,
    description: principalItem?.description ?? `Cobrança #${balance.charge_number}`,
    original_amount: balance.total_amount,
    discount_amount: 0,
    credit_applied: 0,
    due_date: balance.due_date,
    status: balance.status,
    customer_id: balance.customer_id,
    charges_waived: false,
  }
  const baseAmount = balance.total_amount
  const creditApplied = 0

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
          {amountDue > 0 && (balance.is_overdue ? 'overdue' : balance.status) !== 'paid' && (balance.is_overdue ? 'overdue' : balance.status) !== 'cancelled' && (
            <span className={`text-[14px] font-semibold ${(balance.is_overdue ? 'overdue' : balance.status) === 'overdue' ? 'text-danger' : 'text-info'}`}>
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
                    {/* `amountDue` JÁ inclui o encargo acumulado (saldo +
                        acréscimo). Somar de novo aqui exibia o encargo em
                        dobro: R$ 532,88 no bloco contra R$ 516,44 no cabeçalho,
                        dois números para a mesma coisa na mesma tela. */}
                    <td className="h-9 px-4 font-mono font-bold text-danger">{formatCurrency(amountDue)}</td>
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
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 px-4 text-fg-soft">{fmtDatetime(p.paid_at)}</td>
                      <td className="h-9 px-4 text-fg-mute">{PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                      <td className={`h-9 px-4 text-right font-mono font-semibold ${
                        p.reversed ? 'text-fg-mute line-through' : 'text-success'
                      }`}>
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="h-9 max-w-[200px] truncate px-4 text-fg-mute">{p.notes ?? '—'}</td>
                      <td className="h-9 px-4 text-right">
                        {p.reversed
                          ? <span className="text-[12px] text-fg-mute">Estornado</span>
                          : p.payment_id
                            ? <ReversePaymentButton paymentId={p.payment_id} amount={p.amount} />
                            : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Encargos capturados ───────────────────────────────────────── */}
        {lateChargesList.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Encargos registrados
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({lateChargesList.length})</span>
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
                  {lateChargesList.map(lc => (
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
        {creditAppsList.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Créditos aplicados
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({creditAppsList.length})</span>
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
                  {creditAppsList.map(ca => (
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
          {/* Valores reais. Estavam fixos em `accruedCharges={0}` e
              `isOverdue={false}`, e a condição do botão "Consolidar encargo" é
              `isOverdue && accruedCharges > 0` — ou seja, ele NUNCA era
              renderizado, e realizar o encargo era inalcançável pela tela. */}
          <BillingActions
            billingId={id}
            status={(balance.is_overdue ? 'overdue' : balance.status)}
            amountDue={amountDue}
            customerId={billing.customer_id ?? ''}
            availableCredits={availableCredits}
          />
        </section>

      </div>
    </div>
  )
}
