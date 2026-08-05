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
  paid:      { bg: 'bg-[#0e2f13]', text: 'text-[#229731]', label: 'Paga' },
  overdue:   { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', label: 'Vencida' },
  pending:   { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', label: 'Pendente' },
  cancelled: { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Cancelada' },
  prejudice: { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', label: 'Prejuízo' },
}

export const BILLING_TYPE_LABEL: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  deposit:       'Caução',
}
