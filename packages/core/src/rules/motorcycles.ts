/**
 * @file rules/motorcycles.ts
 * @description Regras puras sobre estado da frota.
 */

import type { MotorcycleStatus } from '../types/index'

export interface MotorcycleIdleInput {
  status: MotorcycleStatus
  updated_at: string
}

const DAY_MS = 86_400_000

/**
 * Considera uma moto "ociosa" quando está disponível e não recebeu
 * atualização há mais de `idleDays` dias. Default = 7 dias (regra atual
 * do painel "motos paradas").
 */
export function isIdleMotorcycle(
  moto: MotorcycleIdleInput,
  today: Date = new Date(),
  idleDays = 7,
): boolean {
  if (moto.status !== 'available') return false
  const threshold = today.getTime() - idleDays * DAY_MS
  return new Date(moto.updated_at).getTime() <= threshold
}
