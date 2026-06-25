/**
 * @file rules/billings.ts
 * @description Regras puras para cobranças (billings/charges).
 *
 * As regras lidam só com dados — não tocam Supabase ou UI.
 */

import type { ChargeStatus } from '../types/index'
import { parseIsoDate } from './contracts'

export interface ChargeSummary {
  status: ChargeStatus
  amount: number
  due_date: string
  payment_date?: string | null
  customer_id?: string
}

// ---------------------------------------------------------------------------
// Novas regras de ciclo de vida de cobranças (Spec 0004)
// ---------------------------------------------------------------------------

export type BillingActionResult = { ok: true } | { ok: false; errorCode: string }

/**
 * Verifica se uma cobrança pode receber baixa (RN-015, RN-016, RN-017).
 */
export function canRegisterPayment(status: string): BillingActionResult {
  if (status === 'paid')      return { ok: false, errorCode: 'BILLING_ALREADY_PAID' }
  if (status === 'cancelled') return { ok: false, errorCode: 'BILLING_CANCELLED' }
  if (status === 'prejudice') return { ok: false, errorCode: 'BILLING_CANCELLED' }
  return { ok: true }
}

/**
 * Verifica se um desconto pode ser aplicado (RN-016, RN-018).
 */
export function canApplyDiscount(
  status: string,
  discountAmount: number,
  originalAmount: number,
): BillingActionResult {
  if (status === 'cancelled' || status === 'prejudice') {
    return { ok: false, errorCode: 'BILLING_CANCELLED' }
  }
  if (discountAmount > originalAmount) {
    return { ok: false, errorCode: 'DISCOUNT_EXCEEDS_AMOUNT' }
  }
  return { ok: true }
}

/**
 * Valor final = original − desconto (RN-019).
 */
export function calculateFinalAmount(originalAmount: number, discountAmount: number): number {
  return originalAmount - discountAmount
}

const DAY_MS = 86_400_000

/**
 * Define se uma cobrança deve ser considerada vencida hoje.
 * Cobre dois cenários:
 *  - status já gravado como 'overdue' no banco
 *  - status 'pending' cuja due_date já passou (caso o cron não tenha rodado)
 */
export function isChargeOverdue(
  charge: Pick<ChargeSummary, 'status' | 'due_date'>,
  today: Date = new Date(),
): boolean {
  if (charge.status === 'overdue') return true
  if (charge.status !== 'pending') return false
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  return parseIsoDate(charge.due_date) < todayMidnight
}

/**
 * Dias decorridos desde a due_date para uma cobrança vencida.
 * Retorna 0 se a cobrança não estiver vencida (defensivo).
 */
export function calculateDaysOverdue(
  charge: Pick<ChargeSummary, 'status' | 'due_date'>,
  today: Date = new Date(),
): number {
  if (!isChargeOverdue(charge, today)) return 0
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  const diff = todayMidnight.getTime() - parseIsoDate(charge.due_date).getTime()
  return Math.floor(diff / DAY_MS)
}

/**
 * Taxa de inadimplência: (overdue + loss) / total * 100.
 * Retorna 0 quando não há cobranças.
 */
export function calculateDefaultRate(charges: Pick<ChargeSummary, 'status'>[]): number {
  if (charges.length === 0) return 0
  const defaulters = charges.filter(
    (c) => c.status === 'overdue' || c.status === 'loss' || c.status === 'prejudice',
  ).length
  return (defaulters / charges.length) * 100
}

/**
 * Taxa de pontualidade entre cobranças PAGAS:
 * pagas no prazo / total de pagas * 100.
 * Retorna 0 quando não há cobranças pagas.
 */
export function calculatePunctualityRate(
  charges: Pick<ChargeSummary, 'status' | 'due_date' | 'payment_date'>[],
): number {
  const paid = charges.filter((c) => c.status === 'paid')
  if (paid.length === 0) return 0
  const onTime = paid.filter((c) => c.payment_date && c.payment_date <= c.due_date).length
  return (onTime / paid.length) * 100
}

/**
 * Ticket médio das cobranças pagas. Retorna 0 quando não há.
 */
export function calculateAverageTicket(charges: Pick<ChargeSummary, 'status' | 'amount'>[]): number {
  const paid = charges.filter((c) => c.status === 'paid')
  if (paid.length === 0) return 0
  const total = paid.reduce((sum, c) => sum + c.amount, 0)
  return total / paid.length
}
