import type { LateChargeConfig, LateChargesCalculation } from '../types/financial'

/**
 * Calcula multa e juros sobre uma cobrança vencida (RN-008 a RN-015).
 *
 * @param config     Snapshot de taxas fixado na criação da cobrança (RN-013).
 * @param baseAmount Valor líquido da cobrança = original_amount − discount_amount (RN-012).
 * @param dueDate    Data de vencimento no formato YYYY-MM-DD.
 * @param now        Data atual (injetada para facilitar testes).
 */
export function calculateLateCharges(
  config: LateChargeConfig | null | undefined,
  baseAmount: number,
  dueDate: string,
  now: Date = new Date(),
): LateChargesCalculation {
  const zero: LateChargesCalculation = {
    grace_period_active: false,
    fee: 0,
    interest: 0,
    total: 0,
    days_since_due: 0,
    days_overdue: 0,
  }

  if (!config || baseAmount <= 0) return zero

  // Dias corridos desde o vencimento (data local sem fuso)
  const due = parseDateLocal(dueDate)
  const today = toDateOnly(now)
  const days_since_due = Math.floor((today.getTime() - due.getTime()) / MS_PER_DAY)

  if (days_since_due <= 0) return zero

  // Período de carência (RN-009): conta a partir do dia seguinte ao vencimento
  const days_overdue = Math.max(0, days_since_due - config.grace_period_days)

  if (days_overdue === 0) {
    return { ...zero, grace_period_active: true, days_since_due }
  }

  // Multa: aplicada uma única vez (RN-010)
  const fee =
    config.late_fee_type === 'percentage'
      ? round2(baseAmount * (config.late_fee_value / 100))
      : round2(config.late_fee_value)

  // Juros: acumulam diariamente (RN-011)
  const interest = round2(baseAmount * config.daily_interest_rate * days_overdue)

  const total = round2(fee + interest)

  return { grace_period_active: false, fee, interest, total, days_since_due, days_overdue }
}

const MS_PER_DAY = 86_400_000

function parseDateLocal(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
