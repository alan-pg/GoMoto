/**
 * @file rules/maintenance.ts
 * @description Regras puras do regime de manutenção: classificação dinâmica de status
 * (vencida/próxima/agendada/concluída) e previsão da próxima ocorrência a partir
 * de uma conclusão.
 *
 * **PRD 0003 / ADR 0006 §7**: estas funções deixaram de carregar tabela canônica
 * embutida. Quem chama é responsável por resolver `interval_km`/`interval_days` —
 * geralmente vindo de `maintenance_plan_items.plan_id` ou, no caso de manutenções
 * legadas sem `plan_item_id`, do helper `findSuggestedItemByDescription()` em
 * `@gomoto/core/data`.
 *
 * O `MaintenanceStatus` é DERIVADO em runtime, não persistido — a tabela
 * `maintenances` só guarda `completed` e os campos de previsão. `today` fica
 * injetável para os testes não dependerem de relógio real.
 */

/**
 * Estados que uma manutenção pode assumir do ponto de vista do operador.
 * Derivados, não persistidos.
 */
export type MaintenanceStatus = 'overdue' | 'upcoming' | 'scheduled' | 'completed'

/**
 * Intervalo canônico de um item de manutenção/vistoria. Pode ser por km, por dias,
 * ou ambos (raríssimo no domínio atual, mas suportado).
 */
export interface MaintenanceInterval {
  interval_km?: number | null
  interval_days?: number | null
}

/**
 * Estimativa média de quilômetros rodados por uma moto de aluguel num dia (1000 km / 7).
 * Usado em projeções de "quando" uma manutenção controlada por KM provavelmente vencerá.
 */
export const KM_POR_DIA = 1000 / 7

/**
 * Default do threshold de alerta (em %). Sobrescrito por
 * `maintenance_plan_items.warn_threshold_pct` (item) ou por
 * `settings['maintenance.default_warn_threshold_pct']` (tenant) — ver F3 do PRD.
 */
export const DEFAULT_WARN_THRESHOLD_PCT = 10

export interface MaintenanceStatusInput {
  completed: boolean
  predicted_km: number | null | undefined
  scheduled_date: string | null | undefined
  current_km: number
  /** Intervalo canônico do plano. `null` quando a manutenção é avulsa/corretiva. */
  interval_km?: number | null
  interval_days?: number | null
  /** Percentual de antecedência para `upcoming`. Default = 10. */
  warn_threshold_pct?: number | null
}

/**
 * Ranking de severidade dos estados. Menor número = pior. Usado para combinar
 * dois gatilhos (KM e data) na semântica OR: o pior status vence.
 */
const STATUS_RANK: Record<MaintenanceStatus, number> = {
  overdue: 0,
  upcoming: 1,
  scheduled: 2,
  completed: 3,
}

function worstStatus(a: MaintenanceStatus, b: MaintenanceStatus): MaintenanceStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b
}

function statusByKm(input: MaintenanceStatusInput, pct: number): MaintenanceStatus | null {
  if (input.predicted_km === null || input.predicted_km === undefined) return null
  if (input.current_km >= input.predicted_km) return 'overdue'
  if (input.interval_km && input.interval_km > 0) {
    const threshold = Math.round(input.interval_km * (pct / 100))
    if (input.current_km >= input.predicted_km - threshold) return 'upcoming'
  }
  return 'scheduled'
}

function statusByDate(input: MaintenanceStatusInput, today: Date, pct: number): MaintenanceStatus | null {
  if (!input.scheduled_date) return null
  const due = new Date(input.scheduled_date + 'T12:00:00')
  if (today >= due) return 'overdue'
  if (input.interval_days && input.interval_days > 0) {
    const thresholdDays = Math.round(input.interval_days * (pct / 100))
    const thresholdDate = new Date(due)
    thresholdDate.setDate(thresholdDate.getDate() - thresholdDays)
    if (today >= thresholdDate) return 'upcoming'
  }
  return 'scheduled'
}

/**
 * Classifica uma manutenção em `overdue` / `upcoming` / `scheduled` / `completed`.
 *
 * Regras:
 * - `completed=true` → `completed`, fim.
 * - Gatilho por KM: ativo quando `predicted_km` existe. Vencido se
 *   `current_km >= predicted_km`; próximo se faltar até `warn_threshold_pct%`
 *   do `interval_km`; senão agendado. Sem `interval_km` informado (corretiva
 *   avulsa), nunca atinge "próximo".
 * - Gatilho por data: ativo quando `scheduled_date` existe. Mesma lógica em
 *   dias com `interval_days`.
 * - **Quando ambos os gatilhos existem (combo KM + data), vale o pior** —
 *   semântica OR canônica de CMMS: "o primeiro que vencer dispara". Decisão
 *   tomada em 2026-06-20 por consistência com Fleetio/Samsara.
 * - Sem nenhum gatilho → `scheduled` (defensivo).
 */
export function calculateMaintenanceStatus(
  input: MaintenanceStatusInput,
  today: Date = new Date(),
): MaintenanceStatus {
  if (input.completed) return 'completed'
  const pct = input.warn_threshold_pct ?? DEFAULT_WARN_THRESHOLD_PCT

  const byKm = statusByKm(input, pct)
  const byDate = statusByDate(input, today, pct)

  if (byKm !== null && byDate !== null) return worstStatus(byKm, byDate)
  return byKm ?? byDate ?? 'scheduled'
}

export interface NextMaintenanceInput {
  completionKm: number
  completionDate: string
  interval_km?: number | null
  interval_days?: number | null
}

export interface NextMaintenanceOutput {
  predicted_km?: number
  scheduled_date?: string
}

/**
 * Previsão da próxima ocorrência dado uma conclusão atual. Retorna `null` quando
 * nenhum intervalo é informado — chamador decide se cria registro sem previsão
 * (manutenção corretiva avulsa) ou pula.
 *
 * Usamos `T12:00:00` ao parsear a data de conclusão para evitar drift de fuso horário no
 * arredondamento — sem isso, dias rodam para trás em timezones a oeste de UTC.
 */
export function calculateNextMaintenance(
  input: NextMaintenanceInput,
): NextMaintenanceOutput | null {
  const hasKm = input.interval_km != null && input.interval_km > 0
  const hasDays = input.interval_days != null && input.interval_days > 0
  if (!hasKm && !hasDays) return null

  const out: NextMaintenanceOutput = {}
  if (hasKm) {
    out.predicted_km = input.completionKm + (input.interval_km as number)
  }
  if (hasDays) {
    const d = new Date(input.completionDate + 'T12:00:00')
    d.setDate(d.getDate() + (input.interval_days as number))
    out.scheduled_date = d.toISOString().split('T')[0]
  }
  return out
}

export interface RentalMaintenancePeriod {
  vehicle_id: string | null
  start_date: string | null
  end_date: string | null
}

export interface MaintenancePeriodInput {
  vehicle_id: string
  scheduled_date: string | null
  completed_date: string | null
}

/**
 * Filtra as manutenções que pertencem ao período de uma locação. Não existe FK
 * `maintenances → rentals` (a tabela só referencia `vehicle_id`) — a associação
 * é inferida por mesmo veículo + `scheduled_date` ou `completed_date` caindo
 * dentro de `[start_date, end_date]` da locação (ver obsidian-notes/Telas/Locações.md).
 * Datas são strings `YYYY-MM-DD`: comparação lexicográfica já é cronológica,
 * mesmo padrão usado em `generateCycleCharges`/`adjustRental`.
 */
export function filterMaintenancesInRentalPeriod<T extends MaintenancePeriodInput>(
  maintenances: T[],
  rental: RentalMaintenancePeriod,
): T[] {
  if (!rental.vehicle_id || !rental.start_date || !rental.end_date) return []
  const { vehicle_id, start_date, end_date } = rental
  return maintenances.filter((m) => {
    if (m.vehicle_id !== vehicle_id) return false
    return [m.scheduled_date, m.completed_date].some(
      d => d != null && d >= start_date && d <= end_date,
    )
  })
}
