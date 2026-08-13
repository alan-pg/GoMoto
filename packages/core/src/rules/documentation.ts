/**
 * @file rules/documentation.ts
 * @description Regras puras do dossiê documental do veículo (PRD 0002).
 *
 * O banco grava `pending`/`paid`/`exempt`/`cancelled` literalmente nas
 * obrigações. `overdue` NÃO é gravado no V1 (decisão D4 do PRD) — é
 * derivado em runtime por `effectiveStatus`. Isso evita um job de
 * varredura prematuro e mantém a tabela enxuta até o PRD de alertas
 * chegar com cache + trigger.
 *
 * Todas as funções são determinísticas e aceitam `today` injetável para
 * que os testes não dependam do relógio real.
 */

import type { VehicleObligation, VehicleObligationStatus, VehicleObligationType } from '../types/index'

/**
 * ISO date (YYYY-MM-DD) → Date local fixada em meio-dia, para evitar
 * drift de fuso horário em arredondamento de dia.
 */
function parseIsoDate(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

function toIsoDate(d: Date): string {
  // split sempre devolve ao menos um elemento para uma string ISO válida;
  // o `?? ''` existe para satisfazer `noUncheckedIndexedAccess`.
  return d.toISOString().split('T')[0] ?? ''
}

/**
 * `pending` com data de vencimento no passado vira `overdue` para a UI.
 * Os demais status (`paid`, `exempt`, `cancelled`, e o próprio `overdue`
 * persistido por uma versão futura) passam direto.
 */
export function effectiveStatus(
  obligation: Pick<VehicleObligation, 'status' | 'due_date'>,
  today: Date = new Date(),
): VehicleObligationStatus {
  if (obligation.status !== 'pending') return obligation.status
  const due = parseIsoDate(obligation.due_date)
  return today > due ? 'overdue' : 'pending'
}

/**
 * Estado agregado da documentação do veículo. Combina o pior caso
 * entre todas as obrigações abertas (pending/overdue) com as flags
 * derivadas para alimentar o badge da listagem de motos.
 *
 * Hierarquia (pior → melhor):
 *   - 'overdue'    → existe pelo menos 1 obrigação vencida não paga.
 *   - 'due_soon'   → existe obrigação vencendo dentro de `dueSoonDays`.
 *   - 'pending'    → existe obrigação pending mas distante.
 *   - 'ok'         → tudo pago / isento / cancelado.
 */
export type DocumentationAggregateStatus = 'ok' | 'pending' | 'due_soon' | 'overdue'

export interface DocumentationSummary {
  status: DocumentationAggregateStatus
  overdueCount: number
  dueSoonCount: number
  pendingCount: number
  totalDue: number
  nextDueDate: string | null
  nextDueObligationId: string | null
}

export interface SummarizeOptions {
  /** Janela em dias para classificar uma obrigação como `due_soon`. Default 30. */
  dueSoonDays?: number
}

/**
 * Reduz a lista de obrigações de um veículo a um resumo apto a alimentar
 * a listagem de motos. Soma apenas o que está em aberto (pending/overdue)
 * — pagos/isentos não entram em `totalDue`.
 */
export function summarizeDocumentation(
  obligations: ReadonlyArray<Pick<VehicleObligation, 'id' | 'status' | 'due_date' | 'amount'>>,
  today: Date = new Date(),
  options: SummarizeOptions = {},
): DocumentationSummary {
  const dueSoonDays = options.dueSoonDays ?? 30
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + dueSoonDays)

  let overdueCount = 0
  let dueSoonCount = 0
  let pendingCount = 0
  let totalDue = 0
  let nextDueDate: string | null = null
  let nextDueObligationId: string | null = null

  for (const o of obligations) {
    const effective = effectiveStatus(o, today)
    if (effective === 'paid' || effective === 'exempt' || effective === 'cancelled') continue

    totalDue += Number(o.amount) || 0

    if (effective === 'overdue') {
      overdueCount++
    } else {
      const due = parseIsoDate(o.due_date)
      if (due <= horizon) {
        dueSoonCount++
      } else {
        pendingCount++
      }
    }

    if (!nextDueDate || o.due_date < nextDueDate) {
      nextDueDate = o.due_date
      nextDueObligationId = o.id
    }
  }

  let status: DocumentationAggregateStatus = 'ok'
  if (overdueCount > 0) status = 'overdue'
  else if (dueSoonCount > 0) status = 'due_soon'
  else if (pendingCount > 0) status = 'pending'

  return {
    status,
    overdueCount,
    dueSoonCount,
    pendingCount,
    totalDue,
    nextDueDate,
    nextDueObligationId,
  }
}

/**
 * Próxima obrigação a vencer (em aberto). Útil para a tela de detalhe
 * destacar "próximo IPVA: R$ 115 em 10/04". Retorna `null` se não há
 * nada em aberto.
 */
export function nextObligationDue<T extends Pick<VehicleObligation, 'status' | 'due_date'>>(
  obligations: ReadonlyArray<T>,
  today: Date = new Date(),
): T | null {
  let best: T | null = null
  for (const o of obligations) {
    const effective = effectiveStatus(o, today)
    if (effective === 'paid' || effective === 'exempt' || effective === 'cancelled') continue
    if (!best || o.due_date < best.due_date) {
      best = o
    }
  }
  return best
}

/**
 * Sugestão de data de vencimento padrão para uma nova obrigação,
 * baseada no tipo + ano de referência. Heurística inicial para a UI
 * de cadastro — o operador pode sobrescrever.
 *
 * Valores baseados no calendário SP, que é a referência operacional
 * da locadora piloto (Bonze). Outras UFs precisarão de ajuste manual.
 */
export function suggestDueDate(type: VehicleObligationType, referenceYear: number): string {
  switch (type) {
    case 'ipva':
      return toIsoDate(new Date(referenceYear, 3, 10)) // 10 de abril
    case 'licensing':
      return toIsoDate(new Date(referenceYear, 8, 30)) // 30 de setembro
    case 'dpvat':
      return toIsoDate(new Date(referenceYear, 0, 31)) // 31 de janeiro
    case 'insurance':
    case 'crv_issuance':
    case 'detran_fee':
    case 'other':
    default:
      return toIsoDate(new Date(referenceYear, 11, 31)) // 31 de dezembro como fallback neutro
  }
}
