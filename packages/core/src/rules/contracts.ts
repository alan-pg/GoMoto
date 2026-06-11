/**
 * @file rules/contracts.ts
 * @description Regras de negócio puras para contratos de locação/fidelidade.
 *
 * Nada aqui pode importar Supabase, React ou qualquer dependência de UI.
 * As funções recebem dados brutos (ou subset de campos) e devolvem dados
 * estruturados; a formatação visual fica nas pages.
 */

export const CONTRACT_TERMINATION_FINE_BRL = 1000

/**
 * Duração mínima de cada tipo de contrato antes que a rescisão antecipada
 * gere multa para o cliente.
 */
export const CONTRACT_MINIMUM_DURATION = {
  rental: { months: 3 },
  loyalty: { years: 2 },
} as const

import type { ContractStatus } from '../types/index'

export type ContractType = 'rental' | 'loyalty'
export type ContractValidityLevel = 'red' | 'orange' | 'green'

export interface ContractValidityInput {
  status: ContractStatus
  start_date: string
  end_date?: string | null
  contract_type?: ContractType | null
}

/**
 * Adiciona meses preservando o dia (usa setMonth, que pode rolar para o
 * próximo mês quando o dia não existe — comportamento aceito pelo produto).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function addYears(date: Date, years: number): Date {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + years)
  return d
}

/**
 * Converte string ISO YYYY-MM-DD em Date local sem deslocamento de fuso.
 * Usado em todos os comparativos de datas do domínio (que são "date-only").
 */
export function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * Data mínima que o contrato pode ser rescindido sem multa para o cliente.
 * - `rental`: start_date + 3 meses
 * - `loyalty`: start_date + 2 anos (promessa de compra)
 */
export function calculateMinimumEndDate(
  startDate: string,
  contractType: ContractType = 'rental',
): Date {
  const start = parseIsoDate(startDate)
  if (contractType === 'loyalty') {
    return addYears(start, CONTRACT_MINIMUM_DURATION.loyalty.years)
  }
  return addMonths(start, CONTRACT_MINIMUM_DURATION.rental.months)
}

/**
 * Data esperada de término do contrato.
 * - `loyalty`: sempre start_date + 2 anos (ignora end_date manual).
 * - `rental`: usa end_date informado, ou null se ausente.
 */
export function calculateExpectedEndDate(input: ContractValidityInput): Date | null {
  const type: ContractType = input.contract_type ?? 'rental'
  if (type === 'loyalty') {
    return addYears(parseIsoDate(input.start_date), CONTRACT_MINIMUM_DURATION.loyalty.years)
  }
  return input.end_date ? parseIsoDate(input.end_date) : null
}

/**
 * Avalia a vigência de um contrato e classifica em três níveis:
 * - `red`   → passou da data de encerramento prevista
 * - `orange`→ ainda dentro da vigência mínima (rescisão gera multa)
 * - `green` → vigência mínima cumprida
 *
 * Retorna `null` quando o contrato não está ativo (semântica do produto:
 * só faz sentido avaliar vigência de contratos em curso).
 */
export function getContractValidityLevel(
  input: ContractValidityInput,
  today: Date = new Date(),
): ContractValidityLevel | null {
  if (input.status !== 'active') return null

  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)

  const minEnd = calculateMinimumEndDate(input.start_date, input.contract_type ?? 'rental')
  const contractEnd = input.end_date ? parseIsoDate(input.end_date) : null

  if (contractEnd && todayMidnight > contractEnd) return 'red'
  if (todayMidnight < minEnd) return 'orange'
  return 'green'
}

/**
 * `true` se a rescisão hoje cairia dentro da vigência mínima — caso em que
 * a regra de negócio prevê multa para o cliente.
 */
export function isTerminationWithinMinimum(
  input: Pick<ContractValidityInput, 'start_date' | 'contract_type'>,
  today: Date = new Date(),
): boolean {
  const todayMidnight = new Date(today)
  todayMidnight.setHours(0, 0, 0, 0)
  const minEnd = calculateMinimumEndDate(input.start_date, input.contract_type ?? 'rental')
  return todayMidnight < minEnd
}
