import type { VehicleStatus } from '../schemas/vehicles'

export interface VehicleIdleInput {
  status: VehicleStatus
  updated_at: string
}

const DAY_MS = 86_400_000

/**
 * Considera um veículo "ocioso" quando está disponível e não recebeu
 * atualização há mais de `idleDays` dias. Default = 7 dias (regra atual
 * do painel "veículos parados").
 */
export function isIdleVehicle(
  vehicle: VehicleIdleInput,
  today: Date = new Date(),
  idleDays = 7,
): boolean {
  if (vehicle.status !== 'available') return false
  const threshold = today.getTime() - idleDays * DAY_MS
  return new Date(vehicle.updated_at).getTime() <= threshold
}
