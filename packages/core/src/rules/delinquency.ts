import type { DelinquencyLevel, DelinquencySettings } from '../types/financial'

const DEFAULTS: Required<DelinquencySettings> = {
  delinquent_count: 3,
  delinquent_days:  30,
  blocked_count:    5,
  blocked_days:     60,
  auto_block:       false,
}

/**
 * Classifica o nível de inadimplência de um cliente (RN-029 a RN-036).
 * Espelha a lógica de fn_recalculate_delinquency (ADR 0014) de forma testável.
 *
 * @param overdueCount   Quantidade de cobranças com status 'overdue'.
 * @param maxDaysOverdue Máximo de dias em atraso entre as cobranças vencidas.
 * @param thresholds     Limiares configurados pelo tenant.
 */
export function classifyDelinquency(
  overdueCount: number,
  maxDaysOverdue: number,
  thresholds: Partial<DelinquencySettings> = {},
): DelinquencyLevel {
  const t = { ...DEFAULTS, ...thresholds }

  if (overdueCount === 0) return 'current'   // RN-030

  // Bloquear antes de verificar inadimplência para cobrir auto_block=true
  if (
    t.auto_block &&
    (overdueCount >= t.blocked_count || maxDaysOverdue >= t.blocked_days)
  ) {
    return 'blocked'                          // RN-033
  }

  if (overdueCount >= t.delinquent_count || maxDaysOverdue >= t.delinquent_days) {
    return 'delinquent'                       // RN-032
  }

  return 'late'                               // RN-031
}
