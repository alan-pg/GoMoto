/**
 * @file rules/maintenance.ts
 * @description Regras puras do regime de manutenção: tabela canônica de intervalos
 * por tipo, classificação dinâmica de status (vencida/próxima/agendada/concluída) e
 * previsão da próxima manutenção a partir de uma conclusão.
 *
 * O `MaintenanceStatus` aqui é DERIVADO (calculado em runtime), não persistido — a
 * tabela `maintenances` só guarda `completed` e os campos de previsão (`predicted_km`,
 * `scheduled_date`). Tudo o mais é computado por estas funções, daí o cuidado de
 * deixar `today` injetável para os testes não dependerem de relógio real.
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
  interval_km?: number
  interval_days?: number
}

/**
 * Estimativa média de quilômetros rodados por uma moto de aluguel num dia (1000 km / 7).
 * Usado em projeções de "quando" uma manutenção controlada por KM provavelmente vencerá.
 */
export const KM_POR_DIA = 1000 / 7

/**
 * Intervalos canônicos por descrição de item. Tipos não listados retornam `undefined`
 * em `getInterval` — a UI então aplica fallbacks defensivos (100 km / 18 dias) no
 * cálculo de threshold. As chaves duplicadas com/sem acento existem porque a base
 * histórica de itens varia; `getInterval` faz match tolerante e cobre os dois.
 */
export const STANDARD_INTERVALS: Record<string, MaintenanceInterval> = {
  'Troca de óleo':              { interval_km: 1000 },
  'Troca de oleo':              { interval_km: 1000 },
  'Troca de óleo e filtro':     { interval_km: 1000 },
  'Filtro de óleo':             { interval_km: 4000 },
  'Filtro de ar':               { interval_km: 4000 },
  'Vela de ignição':            { interval_km: 4000 },
  'Velas de ignição':           { interval_km: 4000 },
  'Kit de transmissão':         { interval_km: 8000 },
  'Pneu traseiro':              { interval_km: 8000 },
  'Pneu dianteiro':             { interval_km: 16000 },
  'Freio dianteiro':            { interval_km: 10000 },
  'Freio traseiro':             { interval_km: 8000 },
  'Pastilha de freio dianteira':{ interval_km: 10000 },
  'Pastilha de freio traseira': { interval_km: 8000 },
  'Lona de freio traseira':     { interval_km: 8000 },
  'Lona de freio dianteira':    { interval_km: 10000 },
  'Amortecedor':                { interval_km: 15000 },
  'Amortecedores':              { interval_km: 15000 },
  'Revisão geral':              { interval_km: 6000 },
  'Vistoria de entrega':        { interval_days: 180 },
  'Vistoria periódica':         { interval_days: 180 },
  'Vistoria mensal':            { interval_days: 30 },
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Lookup tolerante: match exato → case-insensitive → normalizado (sem acento, minúsculo,
 * trim). Retorna `undefined` se nada bater. Indispensável porque a UI deixa o operador
 * digitar livremente e queremos casar mesmo com acentuação inconsistente.
 */
export function getInterval(description: string): MaintenanceInterval | undefined {
  if (STANDARD_INTERVALS[description]) return STANDARD_INTERVALS[description]
  const lower = description.toLowerCase()
  const normalizedDesc = normalize(description)
  for (const key of Object.keys(STANDARD_INTERVALS)) {
    if (key.toLowerCase() === lower) return STANDARD_INTERVALS[key]
    if (normalize(key) === normalizedDesc) return STANDARD_INTERVALS[key]
  }
  return undefined
}

export interface MaintenanceStatusInput {
  completed: boolean
  description: string
  predicted_km: number | null | undefined
  scheduled_date: string | null | undefined
  current_km: number
}

/**
 * Classifica uma manutenção em `overdue` / `upcoming` / `scheduled` / `completed`.
 *
 * Regras:
 * - `completed=true` → `completed`, fim.
 * - Controle por KM (`predicted_km` definido): vencida se `current_km >= predicted_km`;
 *   próxima se faltar até 10% do intervalo padrão (ou 100 km se a descrição não tem
 *   mapeamento); senão agendada.
 * - Controle por data (`scheduled_date` definido): vencida se hoje passou da data;
 *   próxima se faltar até 10% do intervalo padrão em dias (ou 18 dias); senão agendada.
 * - Sem KM nem data → `scheduled` (defensivo, não deveria acontecer).
 */
export function calculateMaintenanceStatus(
  input: MaintenanceStatusInput,
  today: Date = new Date(),
): MaintenanceStatus {
  if (input.completed) return 'completed'
  const kmCurrent = input.current_km

  if (input.predicted_km !== null && input.predicted_km !== undefined) {
    if (kmCurrent >= input.predicted_km) return 'overdue'
    const interval = getInterval(input.description)
    const threshold = interval?.interval_km ? Math.round(interval.interval_km * 0.10) : 100
    if (kmCurrent >= input.predicted_km - threshold) return 'upcoming'
    return 'scheduled'
  }

  if (input.scheduled_date) {
    const due = new Date(input.scheduled_date + 'T12:00:00')
    if (today >= due) return 'overdue'
    const interval = getInterval(input.description)
    const thresholdDays = interval?.interval_days ? Math.round(interval.interval_days * 0.10) : 18
    const thresholdDate = new Date(due)
    thresholdDate.setDate(thresholdDate.getDate() - thresholdDays)
    if (today >= thresholdDate) return 'upcoming'
    return 'scheduled'
  }

  return 'scheduled'
}

export interface NextMaintenanceInput {
  description: string
  completionKm: number
  completionDate: string
}

export interface NextMaintenanceOutput {
  predicted_km?: number
  scheduled_date?: string
}

/**
 * Previsão da próxima ocorrência dado uma conclusão atual. Retorna `null` se a descrição
 * não tem mapeamento canônico (o chamador decide se cria o registro mesmo assim ou pula).
 *
 * Usamos `T12:00:00` ao parsear a data de conclusão para evitar drift de fuso horário no
 * arredondamento — sem isso, dias rodam para trás em timezones a oeste de UTC.
 */
export function calculateNextMaintenance(
  input: NextMaintenanceInput,
): NextMaintenanceOutput | null {
  const interval = getInterval(input.description)
  if (!interval) return null
  const out: NextMaintenanceOutput = {}
  if (interval.interval_km) {
    out.predicted_km = input.completionKm + interval.interval_km
  }
  if (interval.interval_days) {
    const d = new Date(input.completionDate + 'T12:00:00')
    d.setDate(d.getDate() + interval.interval_days)
    out.scheduled_date = d.toISOString().split('T')[0]
  }
  return out
}
