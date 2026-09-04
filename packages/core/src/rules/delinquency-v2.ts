/**
 * Classificação de inadimplência sobre a view `customer_delinquency`.
 *
 * Spec 0014 / ADR 0024, reversão da ADR 0014. O mecanismo antigo mantinha
 * `customers.delinquency_status` por trigger em `billings` — e não funcionava:
 * o trigger disparava em `UPDATE OF status`, mas uma cobrança fica vencida pela
 * PASSAGEM DO TEMPO, que não é um UPDATE. Pior, `fn_recalculate_delinquency`
 * contava `WHERE status = 'overdue'`, valor que nada no sistema jamais gravava.
 * O campo ficava `current` para sempre, justamente para quem devia (F-04).
 *
 * Agora a view entrega os FATOS (quantas vencidas, há quantos dias, quanto) e a
 * classificação é função pura sobre política versionada. Regra de negócio não
 * vive em PL/pgSQL.
 */

export type DelinquencyStatus = 'current' | 'late' | 'delinquent' | 'blocked'

/** Linha de `customer_delinquency`. Ausência de linha = cliente em dia. */
export type DelinquencyFacts = {
  overdue_count: number
  max_days_overdue: number
  overdue_amount: number
}

/** Linha de `delinquency_policies` vigente. */
export type DelinquencyPolicy = {
  late_days: number
  delinquent_count: number
  delinquent_days: number
  blocked_count: number
  blocked_days: number
  auto_block: boolean
}

export const DEFAULT_DELINQUENCY_POLICY: DelinquencyPolicy = {
  late_days: 1,
  delinquent_count: 3,
  delinquent_days: 30,
  blocked_count: 5,
  blocked_days: 60,
  auto_block: false,
}

/**
 * Classifica o cliente a partir dos fatos e da política do tenant.
 *
 * @param facts       Linha da view, ou null quando o cliente não tem vencidas.
 * @param policy      Política vigente do tenant.
 * @param manualBlock Bloqueio manual em `delinquency_blocks`. É decisão humana,
 *                    estado real, e vence qualquer derivação — quitar as
 *                    cobranças não desbloqueia sozinho.
 */
export function classifyCustomerDelinquency(
  facts: DelinquencyFacts | null | undefined,
  policy: DelinquencyPolicy = DEFAULT_DELINQUENCY_POLICY,
  manualBlock = false,
): DelinquencyStatus {
  if (manualBlock) return 'blocked'
  if (!facts || facts.overdue_count === 0) return 'current'

  // Ainda dentro da tolerância de dias: vencida, mas não classificada.
  if (facts.max_days_overdue < policy.late_days) return 'current'

  const hitsBlock =
    facts.overdue_count >= policy.blocked_count ||
    facts.max_days_overdue >= policy.blocked_days

  if (policy.auto_block && hitsBlock) return 'blocked'

  const hitsDelinquent =
    facts.overdue_count >= policy.delinquent_count ||
    facts.max_days_overdue >= policy.delinquent_days

  if (hitsDelinquent) return 'delinquent'

  return 'late'
}

/**
 * Cliente pode iniciar nova locação?
 *
 * Regra dos requisitos: "clientes bloqueados não poderão iniciar novas
 * locações". Separada da classificação para a decisão de negócio ficar
 * explícita em vez de espalhada por comparação de string nas telas.
 */
export function canStartNewRental(status: DelinquencyStatus): boolean {
  return status !== 'blocked'
}

/** Rótulos de UI. Português na interface, inglês no identificador. */
export const DELINQUENCY_LABELS: Record<DelinquencyStatus, string> = {
  current:    'Em dia',
  late:       'Em atraso',
  delinquent: 'Inadimplente',
  blocked:    'Bloqueado',
}
