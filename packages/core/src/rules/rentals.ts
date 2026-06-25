/**
 * @file rules/rentals.ts
 * @description Regras de negócio puras para locações (rentals).
 *
 * Estende/substitui contracts.ts para o módulo de locação automática
 * (Spec 0004). Nada aqui pode importar Supabase, React ou UI.
 */

export {
  CONTRACT_TERMINATION_FINE_BRL,
  addMonths,
  addYears,
  parseIsoDate,
  calculateMinimumEndDate,
  calculateExpectedEndDate,
  getContractValidityLevel,
  isTerminationWithinMinimum,
} from './contracts'

import { parseIsoDate, addMonths, addYears, isTerminationWithinMinimum } from './contracts'
import { CONTRACT_TERMINATION_FINE_BRL } from './contracts'

// ---------------------------------------------------------------------------
// Tipos e constantes específicos do módulo de locação
// ---------------------------------------------------------------------------

export type RentalType = 'rental' | 'rent_to_own'
export type RentalStatus = 'active' | 'closed' | 'transferred'
export type RentalCycle = 'weekly' | 'monthly'
export type BillingType = 'cycle' | 'one_time' | 'complementary'
export type PaymentMethod = 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer'

/** Duração mínima por tipo (spec RN-034/RN-035). Usa 'rent_to_own' em vez de 'loyalty'. */
export const RENTAL_MINIMUM_DURATION = {
  rental:      { months: 3 },
  rent_to_own: { years: 2 },
} as const

// ---------------------------------------------------------------------------
// CycleCharge: output da geração de cobranças
// ---------------------------------------------------------------------------

export interface CycleCharge {
  due_date:     string
  amount:       number
  billing_type: BillingType
}

export interface CycleChargeInput {
  start_date:   string        // ISO YYYY-MM-DD
  end_date:     string        // ISO YYYY-MM-DD
  cycle:        RentalCycle
  due_day:      number        // 1-7 para weekly (1=seg); 1-28 para monthly
  cycle_amount: number
  use_pro_rata: boolean
}

// ---------------------------------------------------------------------------
// Helpers internos (não exportados)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

function dateDiffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

function formatIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Primeira data >= start com o due_day informado. */
function firstDueDate(start: Date, cycle: RentalCycle, dueDay: number): Date {
  if (cycle === 'weekly') {
    // dueDay: 1=seg, ..., 7=dom → JS: 1=seg, ..., 6=sáb, 0=dom
    const dueDayJS = dueDay === 7 ? 0 : dueDay
    const startDayJS = start.getDay()
    const daysUntil = (dueDayJS - startDayJS + 7) % 7
    const d = new Date(start)
    d.setDate(d.getDate() + daysUntil)
    return d
  }
  // Monthly: primeiro dia >= start com dia do mês == dueDay
  const d = new Date(start)
  if (start.getDate() <= dueDay) {
    d.setDate(dueDay)
  } else {
    d.setMonth(d.getMonth() + 1)
    d.setDate(dueDay)
  }
  return d
}

/** Próximo vencimento regular após current. */
function nextDueDate(current: Date, cycle: RentalCycle, dueDay: number): Date {
  if (cycle === 'weekly') {
    const d = new Date(current)
    d.setDate(d.getDate() + 7)
    return d
  }
  const d = new Date(current)
  d.setMonth(d.getMonth() + 1)
  d.setDate(dueDay)
  return d
}

/** Duração do ciclo em dias a partir de fromDate. */
function cycleLengthDays(cycle: RentalCycle, fromDate: Date, dueDay: number): number {
  if (cycle === 'weekly') return 7
  return dateDiffDays(fromDate, nextDueDate(fromDate, 'monthly', dueDay))
}

// ---------------------------------------------------------------------------
// calculateProRataValue
// ---------------------------------------------------------------------------

/**
 * Calcula o valor pro rata com arredondamento de 2 casas decimais (RN-012).
 */
export function calculateProRataValue(
  amount: number,
  days: number,
  cycleDays: number,
): number {
  return Math.round((days / cycleDays) * amount * 100) / 100
}

// ---------------------------------------------------------------------------
// generateCycleCharges
// ---------------------------------------------------------------------------

/**
 * Gera o array de cobranças de ciclo a partir dos parâmetros da locação.
 *
 * Regras:
 * - Se use_pro_rata = false: todas as cobranças pelo valor integral (RN-011)
 * - Primeira cobrança: pro rata se início != vencimento (RN-008)
 * - Última cobrança: pro rata se fim != vencimento (RN-009)
 * - Intermediárias: sempre valor integral (RN-010)
 */
export function generateCycleCharges(input: CycleChargeInput): CycleCharge[] {
  const charges: CycleCharge[] = []
  const start = parseIsoDate(input.start_date)
  const end   = parseIsoDate(input.end_date)

  if (end <= start) return charges

  const first = firstDueDate(start, input.cycle, input.due_day)

  // Coleta todos os vencimentos dentro de [first, end]
  const dueDates: Date[] = []
  let cur = first
  while (cur.getTime() <= end.getTime()) {
    dueDates.push(new Date(cur))
    cur = nextDueDate(cur, input.cycle, input.due_day)
  }

  if (dueDates.length === 0) {
    // Nenhum vencimento cai dentro do período — gera uma cobrança de encerramento
    if (input.use_pro_rata) {
      const cycleDays = cycleLengthDays(input.cycle, first, input.due_day)
      const days = dateDiffDays(start, end)
      charges.push({
        due_date:     formatIsoDate(first),
        amount:       calculateProRataValue(input.cycle_amount, days, cycleDays),
        billing_type: 'cycle',
      })
    } else {
      charges.push({ due_date: formatIsoDate(first), amount: input.cycle_amount, billing_type: 'cycle' })
    }
    return charges
  }

  const lastDue = dueDates[dueDates.length - 1]!

  for (let i = 0; i < dueDates.length; i++) {
    const due    = dueDates[i]!
    const isFirst = i === 0
    const isLast  = i === dueDates.length - 1

    let amount: number

    if (!input.use_pro_rata) {
      amount = input.cycle_amount
    } else if (isFirst && isLast) {
      // Único vencimento: cobre start → end
      const cycleDays = cycleLengthDays(input.cycle, due, input.due_day)
      const totalDays = dateDiffDays(start, end)
      amount = calculateProRataValue(input.cycle_amount, totalDays, cycleDays)
    } else if (isFirst && start.getTime() < due.getTime()) {
      // Pro rata inicial: start → firstDue
      const cycleDays = cycleLengthDays(input.cycle, due, input.due_day)
      const days = dateDiffDays(start, due)
      amount = calculateProRataValue(input.cycle_amount, days, cycleDays)
    } else if (isLast && lastDue.getTime() < end.getTime()) {
      // Pro rata final: lastDue → end
      const next = nextDueDate(lastDue, input.cycle, input.due_day)
      const cycleDays = dateDiffDays(lastDue, next)
      const days = dateDiffDays(lastDue, end)
      amount = calculateProRataValue(input.cycle_amount, days, cycleDays)
    } else {
      amount = input.cycle_amount
    }

    charges.push({ due_date: formatIsoDate(due), amount, billing_type: 'cycle' })
  }

  return charges
}

// ---------------------------------------------------------------------------
// isTerminationWithinMinimumForRental (versão rent_to_own-aware)
// ---------------------------------------------------------------------------

/**
 * `true` se o encerramento ocorreria dentro da vigência mínima para o
 * tipo de locação informado ('rental' | 'rent_to_own').
 */
export function isRentalTerminationWithinMinimum(
  input: { start_date: string; rental_type?: RentalType },
  today: Date = new Date(),
): boolean {
  const type = input.rental_type ?? 'rental'
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  const start = parseIsoDate(input.start_date)

  let minEnd: Date
  if (type === 'rent_to_own') {
    minEnd = addYears(start, RENTAL_MINIMUM_DURATION.rent_to_own.years)
  } else {
    minEnd = addMonths(start, RENTAL_MINIMUM_DURATION.rental.months)
  }

  return todayMidnight < minEnd
}

/** Data mínima de encerramento sem multa para o tipo de locação. */
export function calculateMinimumEndDateForRental(
  startDate: string,
  rentalType: RentalType = 'rental',
): Date {
  const start = parseIsoDate(startDate)
  if (rentalType === 'rent_to_own') {
    return addYears(start, RENTAL_MINIMUM_DURATION.rent_to_own.years)
  }
  return addMonths(start, RENTAL_MINIMUM_DURATION.rental.months)
}

// ---------------------------------------------------------------------------
// EarlyTerminationImpact
// ---------------------------------------------------------------------------

export interface EarlyTerminationImpact {
  /** Cobranças pendentes com due_date < today (permanecerão abertas). */
  overdue_count: number
  /** Cobranças pendentes com due_date >= today (serão canceladas). */
  future_count: number
  /** Encerramento dentro da vigência mínima (multa aplicável). */
  within_minimum: boolean
  /** Valor da multa (R$ 1.000 se within_minimum, 0 caso contrário). */
  fine_amount: number
}

/**
 * Calcula o impacto do encerramento antecipado de uma locação.
 * Usado pelo UI antes da confirmação (RF-037, RF-039).
 */
export function getEarlyTerminationImpact(
  charges: Array<{ due_date: string; status: string }>,
  today: Date,
  startDate: string,
  rentalType: RentalType = 'rental',
): EarlyTerminationImpact {
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)

  const pendingCharges = charges.filter(c => c.status === 'pending' || c.status === 'overdue')

  const overdue_count = pendingCharges.filter(
    c => parseIsoDate(c.due_date).getTime() < todayMidnight.getTime(),
  ).length

  const future_count = pendingCharges.filter(
    c => parseIsoDate(c.due_date).getTime() >= todayMidnight.getTime(),
  ).length

  const within_minimum = isRentalTerminationWithinMinimum(
    { start_date: startDate, rental_type: rentalType },
    today,
  )

  return {
    overdue_count,
    future_count,
    within_minimum,
    fine_amount: within_minimum ? CONTRACT_TERMINATION_FINE_BRL : 0,
  }
}
