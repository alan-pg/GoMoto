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
  const defaulters = charges.filter((c) => c.status === 'overdue' || c.status === 'loss').length
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
