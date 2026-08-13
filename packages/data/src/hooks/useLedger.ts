/**
 * Hooks de leitura do domínio financeiro (Spec 0014).
 *
 * Toda agregação vem de view. O único cálculo feito aqui é `calculateAmountDue`,
 * de @gomoto/core — a MESMA função consumida pelo Route Handler do mobile e
 * pela criação de intent no gateway. É o que impede a divergência de F-05, em
 * que a mesma cobrança tinha três valores devidos diferentes.
 */

import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  calculateAmountDue,
  classifyCustomerDelinquency,
  contractedBacklog,
  DEFAULT_DELINQUENCY_POLICY,
  type DelinquencyStatus,
  type LateChargePolicy,
} from '@gomoto/core'
import {
  listOpenCharges,
  listChargesForCockpit,
  listPayables,
  listProviderAccounts,
  getChargeBalance,
  listChargeItems,
  listReceivables,
  listOverdueCharges,
  getCustomerDelinquency,
  listDelinquentCustomers,
  getDepositBalance,
  getCustomerCreditBalance,
  getVehiclePosition,
  listVehiclePositions,
  getRentalResult,
  listIncomeStatement,
  listRentalSchedule,
  getActiveLateChargePolicy,
  getActiveDelinquencyPolicy,
  type ChargeBalanceRow,
} from '../repositories/ledger'

const KEY = {
  charges: 'charges',
  chargeItems: 'charge-items',
  receivables: 'receivables',
  overdue: 'overdue-charges',
  delinquency: 'delinquency',
  deposit: 'deposit-balance',
  credit: 'credit-balance',
  vehicle: 'vehicle-position',
  rental: 'rental-result',
  dre: 'income-statement',
  schedule: 'rental-schedule',
  policy: 'financial-policy',
} as const

function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ============================================================
// Cobranças
// ============================================================

export type ChargeWithDue = ChargeBalanceRow & {
  accrued_total: number
  amount_due: number
}

/**
 * Cobranças em aberto do cliente, já com encargo aplicado.
 *
 * `amount_due` é o valor a apresentar e a cobrar — não `open_amount`.
 */
export function useOpenCharges(customerId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery<ChargeWithDue[]>({
    queryKey: [KEY.charges, 'open', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const [charges, policy] = await Promise.all([
        listOpenCharges(supabase, customerId!),
        getActiveLateChargePolicy(supabase, today()),
      ])

      const p: LateChargePolicy | null = policy
        ? {
            fee_type: policy.fee_type,
            fee_value: policy.fee_value,
            daily_interest_rate: policy.daily_interest_rate,
            grace_period_days: policy.grace_period_days,
            min_amount: policy.min_amount,
          }
        : null

      return charges.map((c) => {
        const { accrued, amount_due } = calculateAmountDue(c, p)
        return { ...c, accrued_total: accrued.total, amount_due }
      })
    },
  })
}

export function useChargeDetail(chargeId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.charges, chargeId],
    enabled: !!chargeId,
    queryFn: async () => {
      const [balance, items, policy] = await Promise.all([
        getChargeBalance(supabase, chargeId!),
        listChargeItems(supabase, chargeId!),
        getActiveLateChargePolicy(supabase, today()),
      ])

      if (!balance) return null

      const p: LateChargePolicy | null = policy
        ? {
            fee_type: policy.fee_type,
            fee_value: policy.fee_value,
            daily_interest_rate: policy.daily_interest_rate,
            grace_period_days: policy.grace_period_days,
            min_amount: policy.min_amount,
          }
        : null

      const { accrued, amount_due } = calculateAmountDue(balance, p)
      return { ...balance, items, accrued, amount_due }
    },
  })
}

/**
 * Listagem do cockpit, com encargo aplicado a cada linha.
 *
 * `amount_due` é o valor a apresentar e a cobrar; `open_amount` é só o
 * principal em aberto.
 */
export function useChargesList() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.charges, 'cockpit'],
    queryFn: async () => {
      const [rows, policy] = await Promise.all([
        listChargesForCockpit(supabase),
        getActiveLateChargePolicy(supabase, today()),
      ])

      const p: LateChargePolicy | null = policy
        ? {
            fee_type: policy.fee_type,
            fee_value: policy.fee_value,
            daily_interest_rate: policy.daily_interest_rate,
            grace_period_days: policy.grace_period_days,
            min_amount: policy.min_amount,
          }
        : null

      return rows.map((r) => {
        const { accrued, amount_due } = calculateAmountDue(r, p)
        return { ...r, accrued_total: accrued.total, amount_due }
      })
    },
  })
}

/** Contas a receber: emitido e não pago. Não inclui cronograma futuro. */
export function useReceivables() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.receivables],
    queryFn: () => listReceivables(supabase),
  })
}

export function useOverdueCharges() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.overdue],
    queryFn: () => listOverdueCharges(supabase),
  })
}

// ============================================================
// Inadimplência
// ============================================================

export type CustomerDelinquencyResult = {
  status: DelinquencyStatus
  overdue_count: number
  max_days_overdue: number
  overdue_amount: number
}

/**
 * Situação do cliente, derivada na leitura.
 *
 * @param manualBlock Bloqueio explícito em `delinquency_blocks` — decisão
 *                    humana, vence a derivação.
 */
export function useCustomerDelinquency(customerId: string | undefined, manualBlock = false) {
  const supabase = useSupabaseContext()

  return useQuery<CustomerDelinquencyResult>({
    queryKey: [KEY.delinquency, customerId, manualBlock],
    enabled: !!customerId,
    queryFn: async () => {
      const [facts, policy] = await Promise.all([
        getCustomerDelinquency(supabase, customerId!),
        getActiveDelinquencyPolicy(supabase, today()),
      ])

      const status = classifyCustomerDelinquency(
        facts,
        policy ?? DEFAULT_DELINQUENCY_POLICY,
        manualBlock,
      )

      return {
        status,
        overdue_count: facts?.overdue_count ?? 0,
        max_days_overdue: facts?.max_days_overdue ?? 0,
        overdue_amount: facts?.overdue_amount ?? 0,
      }
    },
  })
}

export function useDelinquentCustomers() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.delinquency, 'list'],
    queryFn: () => listDelinquentCustomers(supabase),
  })
}

// ============================================================
// Saldos
// ============================================================

export function useDepositBalance(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.deposit, rentalId],
    enabled: !!rentalId,
    queryFn: () => getDepositBalance(supabase, rentalId!),
  })
}

export function useCustomerCreditBalance(customerId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.credit, customerId],
    enabled: !!customerId,
    queryFn: () => getCustomerCreditBalance(supabase, customerId!),
  })
}

// ============================================================
// Veículo, locação e DRE
// ============================================================

export function useVehiclePosition(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.vehicle, vehicleId],
    enabled: !!vehicleId,
    queryFn: () => getVehiclePosition(supabase, vehicleId!),
  })
}

export function useVehiclePositions() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.vehicle, 'list'],
    queryFn: () => listVehiclePositions(supabase),
  })
}

export function useRentalResult(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.rental, rentalId],
    enabled: !!rentalId,
    queryFn: () => getRentalResult(supabase, rentalId!),
  })
}

export function useIncomeStatement(fromPeriod: string, toPeriod: string) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.dre, fromPeriod, toPeriod],
    queryFn: () => listIncomeStatement(supabase, fromPeriod, toPeriod),
  })
}

// ============================================================
// Cronograma
// ============================================================

/**
 * Cronograma da locação, com a carteira contratada calculada.
 *
 * `contracted_backlog` é o que ainda não virou documento. Métrica legítima —
 * e distinta de contas a receber, que é `useReceivables` (F-10).
 */
export function useRentalSchedule(rentalId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.schedule, rentalId],
    enabled: !!rentalId,
    queryFn: async () => {
      const lines = await listRentalSchedule(supabase, rentalId!)
      return { lines, contracted_backlog: contractedBacklog(lines) }
    },
  })
}

// ============================================================
// Contas a pagar
// ============================================================

/**
 * Despesas da empresa.
 *
 * `company_amount` é derivado do rateio: o que sobra depois da parte do
 * cliente. Guardar os dois seria a mesma denormalização que o redesenho
 * eliminou.
 */
export function usePayables() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: ['payables'],
    queryFn: async () => {
      const rows = await listPayables(supabase)
      return rows.map((p) => ({
        ...p,
        company_amount: Math.round((p.amount - p.customer_amount) * 100) / 100,
      }))
    },
  })
}

// ============================================================
// Gateway
// ============================================================

/**
 * Provedores conectados.
 *
 * Substitui `usePaymentConnection`, que assumia um único provedor por tenant —
 * o `UNIQUE(tenant_id)` de `payment_connections` impedia um segundo (F-13).
 */
export function useProviderAccounts() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: ['payment-provider-accounts'],
    queryFn: async () => {
      const accounts = await listProviderAccounts(supabase)
      return {
        accounts,
        is_connected: accounts.length > 0,
        default_provider: accounts.find((a) => a.is_default)?.provider ?? null,
      }
    },
  })
}
