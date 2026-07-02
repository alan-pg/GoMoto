import type { SupabaseClient } from '@supabase/supabase-js'
import type { VehicleStatus } from '@gomoto/core'

/**
 * Registra uma transição de status no histórico imutável de veículos.
 * Lança exceção em falha — garante que a action caller seja interrompida (RN-006).
 * Shared entre motos/actions.ts e contratos/actions.ts.
 */
export async function recordStatusTransition(
  supabase: SupabaseClient,
  params: {
    motorcycleId: string
    tenantId: string
    previousStatus: VehicleStatus | null
    newStatus: VehicleStatus
    userId: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('vehicle_status_history').insert({
    motorcycle_id:   params.motorcycleId,
    tenant_id:       params.tenantId,
    previous_status: params.previousStatus,
    new_status:      params.newStatus,
    changed_by:      params.userId,
  })
  if (error) {
    console.error('[vehicle-status-history] recordStatusTransition failed', {
      motorcycleId: params.motorcycleId,
      tenantId: params.tenantId,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
    })
    throw new Error(`recordStatusTransition failed: ${error.message}`)
  }
}
