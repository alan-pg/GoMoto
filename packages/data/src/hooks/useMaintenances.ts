import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listMaintenances,
  listMaintenancesByMotorcycle,
  createMaintenance,
  updateMaintenance,
  deleteMaintenance,
} from '../repositories/maintenances'
import type { Maintenance } from '@gomoto/core'

const KEY = 'maintenances'

export function useMaintenances() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listMaintenances(supabase) })
}

export function useMaintenancesByMotorcycle(motorcycleId: string) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'motorcycle', motorcycleId],
    queryFn: () => listMaintenancesByMotorcycle(supabase, motorcycleId),
    enabled: !!motorcycleId,
  })
}

export function useCreateMaintenance() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<Maintenance, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'motorcycle'>,
    ) => createMaintenance(supabase, { ...payload, tenant_id: getTenantId() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateMaintenance() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<Maintenance, 'id' | 'created_at' | 'updated_at' | 'motorcycle'>>
    }) => updateMaintenance(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteMaintenance() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMaintenance(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
