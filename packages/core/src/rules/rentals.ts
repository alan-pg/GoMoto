/**
 * @file rules/rentals.ts
 * @description Regras de negócio puras para locações (rentals).
 * Nada aqui pode importar Supabase, React ou UI.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const CONTRACT_TERMINATION_FINE_BRL = 1000

export const RENTAL_MINIMUM_DURATION = {
  rental:      { months: 3 },
  rent_to_own: { years: 2 },
} as const

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type RentalType    = 'rental' | 'rent_to_own'
export type RentalStatus  = 'active' | 'closed' | 'transferred'
export type RentalCycle   = 'weekly' | 'monthly'
export type BillingType   = 'cycle' | 'one_time' | 'complementary'
export type PaymentMethod = 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer'

export type RentalValidityLevel = 'red' | 'orange' | 'green'

export interface RentalValidityInput {
  status:         string
  start_date:     string
  end_date?:      string | null
  contract_type?: RentalType | null
}

// ---------------------------------------------------------------------------
// Utilitários de data
// ---------------------------------------------------------------------------

/**
 * Adiciona meses preservando o dia (usa setMonth — pode rolar para o próximo
 * mês quando o dia não existe; comportamento aceito pelo produto).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function addYears(date: Date, years: number): Date {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + years)
  return d
}

/** Converte string ISO YYYY-MM-DD em Date local sem deslocamento de fuso. */
export function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

// ---------------------------------------------------------------------------
// Vigência de locações
// ---------------------------------------------------------------------------

/** Data mínima de encerramento sem multa para o tipo de locação. */
export function calculateMinimumEndDate(
  startDate: string,
  rentalType: RentalType = 'rental',
): Date {
  const start = parseIsoDate(startDate)
  if (rentalType === 'rent_to_own') {
    return addYears(start, RENTAL_MINIMUM_DURATION.rent_to_own.years)
  }
  return addMonths(start, RENTAL_MINIMUM_DURATION.rental.months)
}

/** Alias explícito de calculateMinimumEndDate. */
export const calculateMinimumEndDateForRental = calculateMinimumEndDate

/**
 * Data esperada de término:
 * - rent_to_own: sempre start + 2 anos (ignora end_date)
 * - rental:      usa end_date informado, ou null se ausente
 */
export function calculateExpectedEndDate(input: RentalValidityInput): Date | null {
  const type: RentalType = input.contract_type ?? 'rental'
  if (type === 'rent_to_own') {
    return addYears(parseIsoDate(input.start_date), RENTAL_MINIMUM_DURATION.rent_to_own.years)
  }
  return input.end_date ? parseIsoDate(input.end_date) : null
}

/**
 * Classifica a vigência de uma locação ativa em três níveis:
 * - 'red'    → passou da data de encerramento prevista
 * - 'orange' → dentro da vigência mínima (rescisão gera multa)
 * - 'green'  → vigência mínima cumprida
 *
 * Retorna null quando a locação não está ativa.
 */
export function getRentalValidityLevel(
  input: RentalValidityInput,
  today: Date = new Date(),
): RentalValidityLevel | null {
  if (input.status !== 'active') return null

  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)

  const minEnd      = calculateMinimumEndDate(input.start_date, input.contract_type ?? 'rental')
  const contractEnd = input.end_date ? parseIsoDate(input.end_date) : null

  if (contractEnd && todayMidnight > contractEnd) return 'red'
  if (todayMidnight < minEnd) return 'orange'
  return 'green'
}

/** true se o encerramento hoje ocorre dentro da vigência mínima (multa aplicável). */
export function isTerminationWithinMinimum(
  input: Pick<RentalValidityInput, 'start_date' | 'contract_type'>,
  today: Date = new Date(),
): boolean {
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  const minEnd = calculateMinimumEndDate(input.start_date, input.contract_type ?? 'rental')
  return todayMidnight < minEnd
}

/** Versão com nomenclatura de campo explícita (rental_type) usada nas actions. */
export function isRentalTerminationWithinMinimum(
  input: { start_date: string; rental_type?: RentalType },
  today: Date = new Date(),
): boolean {
  return isTerminationWithinMinimum(
    { start_date: input.start_date, contract_type: input.rental_type },
    today,
  )
}

// ---------------------------------------------------------------------------
// CycleCharge: output da geração de cobranças
// ---------------------------------------------------------------------------

export interface CycleCharge {
  due_date:     string
  amount:       number
  billing_type: BillingType
}

export interface CycleChargeInput {
  start_date:   string       // ISO YYYY-MM-DD
  end_date:     string       // ISO YYYY-MM-DD
  cycle:        RentalCycle
  due_day:      number       // 1-7 para weekly (1=seg); 1-28 para monthly
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
    const dueDayJS  = dueDay === 7 ? 0 : dueDay
    const startDayJS = start.getDay()
    const daysUntil = (dueDayJS - startDayJS + 7) % 7
    const d = new Date(start)
    d.setDate(d.getDate() + daysUntil)
    return d
  }
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

/** Calcula o valor pro rata com arredondamento de 2 casas decimais (RN-012). */
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
 * - Se use_pro_rata = false: todas pelo valor integral (RN-011)
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

  const dueDates: Date[] = []
  let cur = first
  while (cur.getTime() <= end.getTime()) {
    dueDates.push(new Date(cur))
    cur = nextDueDate(cur, input.cycle, input.due_day)
  }

  if (dueDates.length === 0) {
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
      const cycleDays = cycleLengthDays(input.cycle, due, input.due_day)
      const totalDays = dateDiffDays(start, end)
      amount = calculateProRataValue(input.cycle_amount, totalDays, cycleDays)
    } else if (isFirst && start.getTime() < due.getTime()) {
      const cycleDays = cycleLengthDays(input.cycle, due, input.due_day)
      const days = dateDiffDays(start, due)
      amount = calculateProRataValue(input.cycle_amount, days, cycleDays)
    } else if (isLast && lastDue.getTime() < end.getTime()) {
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
// isRentalTerminationWithinMinimum (versão rent_to_own-aware)
// ---------------------------------------------------------------------------
// (já definida acima junto com as outras funções de vigência)

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
