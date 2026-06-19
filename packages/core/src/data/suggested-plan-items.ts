/**
 * @file data/suggested-plan-items.ts
 * @description Sugestões canônicas oferecidas na criação de um plano de manutenção.
 *
 * Estes itens **não vivem em tabela** — são chips na UI do criador de plano
 * (PRD 0003 §7.1). Clicar copia o registro para `maintenance_plan_items` do
 * tenant, sem FK de catálogo. Sem migração automática quando uma sugestão muda.
 *
 * Substitui o `STANDARD_INTERVALS` legado (em `rules/maintenance.ts`) — deduplica
 * variações com/sem acento, adiciona `category` para alimentar as regras
 * contratuais (F3) e marca `is_critical` em freio, pneu e vistorias críticas
 * (reservado para o PRD futuro de "regras avançadas"; sem comportamento no V1).
 *
 * ADR 0006 §2 motiva o desenho (sugestão em código vs catálogo em banco).
 */

export type SuggestedItemCategory =
  | 'oil'
  | 'filter'
  | 'brake'
  | 'tire'
  | 'wear_part'
  | 'inspection'
  | 'fluid'
  | 'transmission'
  | 'other'

export type SuggestedItemType = 'preventive' | 'inspection'

export interface SuggestedPlanItem {
  /** Nome legível em português que vira `maintenance_plan_items.name` ao clonar. */
  name: string
  /** Categoria agrupa regras contratuais (PRD 0003 §6.3). */
  category: SuggestedItemCategory
  /** Preventiva = intervalo recorrente; vistoria = checagem temporal. */
  type: SuggestedItemType
  /** Intervalo em km (opcional; ao menos um intervalo é obrigatório). */
  interval_km?: number
  /** Intervalo em dias (opcional). */
  interval_days?: number
  /** Flag reservada para PRD futuro de bloqueio de locação. Sem uso operacional no V1. */
  is_critical: boolean
}

/**
 * Conjunto canônico de sugestões. Ordem aqui vira `sort_order` ao clonar
 * em `maintenance_plan_items` (a UI também pode reordenar depois).
 */
export const SUGGESTED_PLAN_ITEMS: readonly SuggestedPlanItem[] = [
  { name: 'Troca de óleo',                category: 'oil',          type: 'preventive', interval_km: 1000,  is_critical: false },
  { name: 'Troca de óleo e filtro',       category: 'oil',          type: 'preventive', interval_km: 1000,  is_critical: false },
  { name: 'Filtro de óleo',               category: 'filter',       type: 'preventive', interval_km: 4000,  is_critical: false },
  { name: 'Filtro de ar',                 category: 'filter',       type: 'preventive', interval_km: 4000,  is_critical: false },
  { name: 'Vela de ignição',              category: 'wear_part',    type: 'preventive', interval_km: 4000,  is_critical: false },
  { name: 'Kit de transmissão',           category: 'transmission', type: 'preventive', interval_km: 8000,  is_critical: false },
  { name: 'Pneu traseiro',                category: 'tire',         type: 'preventive', interval_km: 8000,  is_critical: true  },
  { name: 'Pneu dianteiro',               category: 'tire',         type: 'preventive', interval_km: 16000, is_critical: true  },
  { name: 'Pastilha de freio dianteira',  category: 'brake',        type: 'preventive', interval_km: 10000, is_critical: true  },
  { name: 'Pastilha de freio traseira',   category: 'brake',        type: 'preventive', interval_km: 8000,  is_critical: true  },
  { name: 'Lona de freio dianteira',      category: 'brake',        type: 'preventive', interval_km: 10000, is_critical: true  },
  { name: 'Lona de freio traseira',       category: 'brake',        type: 'preventive', interval_km: 8000,  is_critical: true  },
  { name: 'Amortecedor',                  category: 'wear_part',    type: 'preventive', interval_km: 15000, is_critical: false },
  { name: 'Revisão geral',                category: 'inspection',   type: 'inspection', interval_km: 6000,  is_critical: false },
  { name: 'Vistoria de entrega',          category: 'inspection',   type: 'inspection', interval_days: 180, is_critical: true  },
  { name: 'Vistoria periódica',           category: 'inspection',   type: 'inspection', interval_days: 180, is_critical: false },
  { name: 'Vistoria mensal',              category: 'inspection',   type: 'inspection', interval_days: 30,  is_critical: true  },
] as const

/**
 * Agrupa sugestões por categoria — útil para renderizar chips agrupados na UI
 * de "Adicionar item → Da sugestão".
 */
export function groupSuggestionsByCategory(): Record<SuggestedItemCategory, SuggestedPlanItem[]> {
  const grouped = {} as Record<SuggestedItemCategory, SuggestedPlanItem[]>
  for (const item of SUGGESTED_PLAN_ITEMS) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }
  return grouped
}
