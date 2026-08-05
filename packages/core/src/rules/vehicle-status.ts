import type { VehicleStatus } from '../schemas/vehicles'

/**
 * Tabela de transições permitidas.
 * `rented` só é atribuído/removido via contrato (RN-002).
 * `sold`/`inactive` só via changeVehicleStatus dedicado (RN-003).
 */
const ALLOWED_TRANSITIONS: Partial<Record<VehicleStatus, VehicleStatus[]>> = {
  available:   ['sold', 'inactive', 'reserved', 'maintenance', 'sinister'],
  reserved:    ['available', 'sold', 'inactive', 'maintenance', 'sinister'],
  maintenance: ['available', 'sold', 'inactive', 'reserved', 'sinister'],
  sinister:    ['available', 'sold', 'inactive', 'reserved', 'maintenance'],
  sold:        ['available'],
  inactive:    ['available'],
  rented:      [], // RN-001: locado não pode mudar de status manualmente
}

export function canChangeStatus(current: VehicleStatus, next: VehicleStatus): boolean {
  return (ALLOWED_TRANSITIONS[current] ?? []).includes(next)
}

/**
 * Retorna os status disponíveis para ações dedicadas (Vender, Desativar, Reativar)
 * exibidas na tela de detalhe. Não inclui transições manuais do seletor de form.
 */
export function getSelectableStatuses(current: VehicleStatus): VehicleStatus[] {
  switch (current) {
    case 'available':
    case 'reserved':
    case 'maintenance':
    case 'sinister':
      return ['sold', 'inactive']
    case 'sold':
    case 'inactive':
      return ['available']
    case 'rented':
      return []
    default:
      return []
  }
}
