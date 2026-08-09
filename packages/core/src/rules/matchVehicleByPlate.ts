import { stripPlate } from '../masks'
import type { Vehicle } from '../types/index'

/**
 * RF-008/CA-008/CA-009 — casa a placa extraída de uma notificação de multa com
 * um veículo já cadastrado. Normaliza formatação (maiúsculas, hífen, espaços)
 * antes de comparar, já que a IA e o cadastro podem representar a mesma placa
 * de formas diferentes (com/sem hífen). Sem match não bloqueia nada (RN-006) —
 * é responsabilidade do caller decidir o que fazer com `null`.
 */
export function matchVehicleByPlate(plate: string | null, vehicles: Vehicle[]): Vehicle | null {
  if (!plate) return null
  const normalized = stripPlate(plate)
  if (!normalized) return null
  return vehicles.find((v) => stripPlate(v.license_plate) === normalized) ?? null
}
