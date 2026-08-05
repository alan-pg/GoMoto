import type { CreditValidationResult } from '../types/financial'

/**
 * Valida se um abatimento de crédito pode ser aplicado (RN-019 a RN-022).
 *
 * @param creditBalance    Saldo disponível do crédito do cliente.
 * @param billingAmountDue Valor a pagar da cobrança (após descontos e créditos já aplicados).
 * @param requested        Valor do abatimento solicitado.
 */
export function validateCreditApplication(
  creditBalance: number,
  billingAmountDue: number,
  requested: number,
): CreditValidationResult {
  if (requested > creditBalance) {
    return { ok: false, errorCode: 'OVER_BALANCE' }   // RN-020
  }
  if (requested > billingAmountDue) {
    return { ok: false, errorCode: 'OVER_BILLING' }   // RN-021
  }
  return { ok: true }
}
