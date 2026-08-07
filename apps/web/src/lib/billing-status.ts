import { isChargeOverdue, type ChargeStatus } from '@gomoto/core'

/**
 * Status "vivo" de uma cobrança para exibição. O banco só grava 'overdue'
 * quando já persistido; 'pending' com due_date no passado é derivado em
 * runtime via isChargeOverdue (@gomoto/core) — mesma regra usada no cálculo
 * de inadimplência, para as telas de locação nunca divergirem entre si.
 */
export function effectiveBillingStatus(billing: { status: string; due_date: string }): string {
  if (billing.status === 'paid' || billing.status === 'cancelled' || billing.status === 'prejudice') {
    return billing.status
  }
  return isChargeOverdue({ status: billing.status as ChargeStatus, due_date: billing.due_date }) ? 'overdue' : 'pending'
}

/** Valor líquido de uma cobrança: original − desconto − crédito aplicado. */
export function netBillingAmount(billing: {
  original_amount?: number | null
  amount?: number | null
  discount_amount?: number | null
  credit_applied?: number | null
}): number {
  const base = billing.original_amount ?? billing.amount ?? 0
  const discount = billing.discount_amount ?? 0
  const credit = billing.credit_applied ?? 0
  return Math.max(0, base - discount - credit)
}

export const BILLING_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  paid:      { bg: 'bg-success-bg', text: 'text-success', label: 'Paga' },
  overdue:   { bg: 'bg-danger-bg',  text: 'text-danger',  label: 'Vencida' },
  pending:   { bg: 'bg-info-bg',    text: 'text-info',    label: 'Pendente' },
  cancelled: { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Cancelada' },
  prejudice: { bg: 'bg-warning-bg', text: 'text-warning', label: 'Prejuízo' },
}

export const BILLING_TYPE_LABEL: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  deposit:       'Caução',
  down_payment:  'Entrada',
}
