/**
 * Cronograma de cobrança da locação.
 *
 * Spec 0014 / ADR 0024, Princípio 5. Reversão da ADR 0009: em vez de emitir
 * 104 documentos na assinatura, a locação grava um PLANO. A cobrança nasce
 * quando o período chega, e a partir daí é imutável.
 *
 * A geração reaproveita `generateCycleCharges` — a lógica de pro rata,
 * primeiro/último ciclo e dia de vencimento é a mesma já testada, e continua
 * com uma única fonte de verdade. Este módulo só a adapta para linhas de
 * `rental_billing_schedules`.
 */

import { generateCycleCharges, type CycleChargeInput } from './rentals'

export type ScheduleStatus = 'scheduled' | 'issued' | 'cancelled' | 'superseded'

export type ScheduleLine = {
  sequence_number: number
  period_start: string
  period_end: string
  due_date: string
  amount: number
  /** Só para exibição no preview; não é persistido no cronograma. */
  description: string
}

/**
 * Gera o cronograma completo da locação.
 *
 * É a MESMA função consumida pelo preview antes da confirmação (RF-036) e
 * pela RPC `create_rental_with_schedule`. Preview e persistência não podem
 * divergir — por isso não existe uma segunda implementação.
 */
export function generateSchedule(input: CycleChargeInput): ScheduleLine[] {
  return generateCycleCharges(input).map((charge, index) => ({
    sequence_number: index + 1,
    period_start: charge.period_start,
    period_end: charge.period_end,
    due_date: charge.due_date,
    amount: charge.amount,
    description: charge.description,
  }))
}

/**
 * Linhas que o job de emissão deve transformar em cobrança.
 *
 * Espelha o filtro da RPC `issue_due_charges`: período já começou (com
 * antecedência opcional) e a linha ainda não virou documento.
 *
 * @param leadDays Emitir com N dias de antecedência ao início do período.
 */
export function selectIssuableLines<T extends { period_start: string; status: ScheduleStatus }>(
  lines: T[],
  asOf: Date = new Date(),
  leadDays = 0,
): T[] {
  const cutoff = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + leadDays)
  const cutoffIso = toIsoDate(cutoff)

  return lines
    .filter((l) => l.status === 'scheduled')
    .filter((l) => l.period_start <= cutoffIso)
}

/**
 * Reajuste: quais linhas podem ter o valor alterado.
 *
 * Apenas as ainda não emitidas, a partir da data de vigência. Período já
 * emitido é documento imutável — ajustá-lo exige cobrança complementar ou
 * renegociação. Antes, `adjust_rental` reescrevia `billings` já emitidos.
 */
export function selectAdjustableLines<T extends { period_start: string; status: ScheduleStatus }>(
  lines: T[],
  effectiveFrom: string,
): T[] {
  return lines
    .filter((l) => l.status === 'scheduled')
    .filter((l) => l.period_start >= effectiveFrom)
}

/**
 * Total ainda não emitido de uma locação.
 *
 * É a "carteira contratada" — métrica legítima, mas que NÃO é contas a receber.
 * Confundir as duas é o defeito F-10: hoje o dashboard soma todas as cobranças
 * pendentes sem recorte, e um rent-to-own de 2 anos entra inteiro no indicador.
 */
export function contractedBacklog(
  lines: Array<{ amount: number; status: ScheduleStatus }>,
): number {
  return round2(
    lines
      .filter((l) => l.status === 'scheduled')
      .reduce((sum, l) => sum + l.amount, 0),
  )
}

function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
