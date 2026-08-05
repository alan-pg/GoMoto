/**
 * @file data/suggested-plan-items.ts
 * @description Sugestões canônicas oferecidas na criação de um plano de manutenção.
 *
 * Estes itens **não vivem em tabela** — alimentam o autocomplete da UI do
 * criador de plano (PRD 0003 §7.1). Selecionar um nome copia o registro para
 * `maintenance_plan_items` do tenant, sem FK de catálogo. Sem migração
 * automática quando uma sugestão muda.
 *
 * Substitui o `STANDARD_INTERVALS` legado (em `rules/maintenance.ts`).
 * Toda manutenção do plano é preventiva por contrato — não há `category`
 * nem `type` no V1 (decisão revisada do ADR 0006). `is_critical` segue
 * reservada para o PRD futuro de bloqueio por crítica vencida.
 *
 * ADR 0006 §2 motiva o desenho (sugestão em código vs catálogo em banco).
 */

export interface SuggestedPlanItem {
  /** Nome legível em português que vira `maintenance_plan_items.name` ao clonar. */
  name: string
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
  { name: 'Troca de óleo',                interval_km: 1000,  is_critical: false },
  { name: 'Troca de óleo e filtro',       interval_km: 1000,  is_critical: false },
  { name: 'Filtro de óleo',               interval_km: 4000,  is_critical: false },
  { name: 'Filtro de ar',                 interval_km: 4000,  is_critical: false },
  { name: 'Vela de ignição',              interval_km: 4000,  is_critical: false },
  { name: 'Kit de transmissão',           interval_km: 8000,  is_critical: false },
  { name: 'Pneu traseiro',                interval_km: 8000,  is_critical: true  },
  { name: 'Pneu dianteiro',               interval_km: 16000, is_critical: true  },
  { name: 'Pastilha de freio dianteira',  interval_km: 10000, is_critical: true  },
  { name: 'Pastilha de freio traseira',   interval_km: 8000,  is_critical: true  },
  { name: 'Lona de freio dianteira',      interval_km: 10000, is_critical: true  },
  { name: 'Lona de freio traseira',       interval_km: 8000,  is_critical: true  },
  { name: 'Amortecedor',                  interval_km: 15000, is_critical: false },
  { name: 'Revisão geral',                interval_km: 6000,  is_critical: false },
  // Renomeados (Spec 0009 §11.2): colidiam em nome com o módulo de Vistoria
  // (avaliação do estado físico do veículo) — estes itens são puramente
  // mecânicos/preventivos, domínio não relacionado.
  { name: 'Revisão de entrega',           interval_days: 180, is_critical: true  },
  { name: 'Revisão periódica',            interval_days: 180, is_critical: false },
  { name: 'Revisão mensal',               interval_days: 30,  is_critical: true  },
] as const

function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Lookup tolerante: match exato → case-insensitive → normalizado (sem acento,
 * minúsculo, trim). Retorna `undefined` se nada bater.
 *
 * Existe para alimentar as manutenções legadas que ficaram sem `plan_item_id`
 * (PRD 0003 §10.2). A tela `/manutencao` chama este helper como fallback antes
 * de invocar `calculateMaintenanceStatus` / `calculateNextMaintenance`. Quando
 * F2 backfillar `plan_item_id`, o helper continua útil para itens com
 * descrição livre e nenhum plano amarrado.
 */
export function findSuggestedItemByDescription(description: string): SuggestedPlanItem | undefined {
  if (!description) return undefined
  for (const item of SUGGESTED_PLAN_ITEMS) {
    if (item.name === description) return item
  }
  const lower = description.toLowerCase()
  const normalized = normalizeName(description)
  for (const item of SUGGESTED_PLAN_ITEMS) {
    if (item.name.toLowerCase() === lower) return item
    if (normalizeName(item.name) === normalized) return item
  }
  return undefined
}
