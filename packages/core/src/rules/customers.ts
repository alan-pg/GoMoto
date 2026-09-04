/**
 * @file rules/customers.ts
 * @description Regras puras sobre comportamento financeiro do cliente.
 */

interface OverdueChargeRef {
  customer_id: string
}

/**
 * Identifica clientes com 2+ cobranças vencidas — sinal de alerta no dashboard.
 *
 * Recebe cobranças **já vencidas** e devolve os customer_ids que atingem o
 * threshold. Atraso não é status armazenado (Princípio 4): quem chama filtra
 * por `charge_balances.is_overdue` antes.
 *
 * Antes esta função exigia `status: ChargeStatus` e descartava o que não fosse
 * 'overdue' — um valor que o enum nem tem mais. O único chamador consultava a
 * view já filtrada por `is_overdue` e inventava o campo só para satisfazer o
 * tipo, então o filtro nunca descartou nada.
 */
export function identifyCustomersWithMultipleOverdueCharges(
  overdueCharges: OverdueChargeRef[],
  threshold = 2,
): string[] {
  const counts: Record<string, number> = {}
  for (const charge of overdueCharges) {
    counts[charge.customer_id] = (counts[charge.customer_id] ?? 0) + 1
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .map(([id]) => id)
}
