/**
 * @file rules/customers.ts
 * @description Regras puras sobre comportamento financeiro do cliente.
 */

import type { ChargeStatus } from '../types/index'

interface OverdueChargeRef {
  customer_id: string
  status: ChargeStatus
}

/**
 * Identifica clientes com 2+ cobranças vencidas — sinal de alerta no
 * dashboard. Recebe a lista bruta de cobranças vencidas (status='overdue')
 * e devolve o set único de customer_ids que atendem ao threshold.
 */
export function identifyCustomersWithMultipleOverdueCharges(
  overdueCharges: OverdueChargeRef[],
  threshold = 2,
): string[] {
  const counts: Record<string, number> = {}
  for (const charge of overdueCharges) {
    if (charge.status !== 'overdue') continue
    counts[charge.customer_id] = (counts[charge.customer_id] ?? 0) + 1
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .map(([id]) => id)
}
