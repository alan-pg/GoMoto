/**
 * Rótulos de cobrança para as telas de locação.
 *
 * O que existia aqui antes descrevia o modelo anterior à ADR 0024:
 *
 * - `effectiveBillingStatus` derivava atraso em runtime porque o banco só
 *   gravava 'overdue' às vezes. Hoje `charge_balances.is_overdue` já entrega
 *   isso derivado de `due_date` (Princípio 4), e a função só tinha um
 *   importador — que nunca a chamava.
 * - `netBillingAmount` somava `original_amount − discount_amount −
 *   credit_applied`, três colunas da tabela `billings` removida. Sem nenhum
 *   consumidor, devolvia 0 para qualquer entrada do modelo novo.
 */

/**
 * `charge_status` (ADR 0024) mais `overdue`, que não é status armazenado: vem
 * de `charge_balances.is_overdue` e a tela resolve antes de indexar aqui.
 */
export const BILLING_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  open:        { bg: 'bg-info-bg',    text: 'text-info',    label: 'Em aberto' },
  overdue:     { bg: 'bg-danger-bg',  text: 'text-danger',  label: 'Vencida' },
  paid:        { bg: 'bg-success-bg', text: 'text-success', label: 'Paga' },
  cancelled:   { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Cancelada' },
  written_off: { bg: 'bg-warning-bg', text: 'text-warning', label: 'Baixada' },
}

export const BILLING_TYPE_LABEL: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  deposit:       'Caução',
  down_payment:  'Entrada',
}
