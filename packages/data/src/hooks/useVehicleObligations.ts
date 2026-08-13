import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listVehicleObligations,
  getVehicleObligation,
  createVehicleObligation,
  updateVehicleObligation,
  deleteVehicleObligation,
} from '../repositories/vehicleObligations'
import type { VehicleObligation } from '@gomoto/core'

const KEY = 'vehicle_obligations'

export function useVehicleObligations(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'by-vehicle', vehicleId],
    queryFn: () => listVehicleObligations(supabase, vehicleId!),
    enabled: !!vehicleId,
  })
}

export function useVehicleObligation(id: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, id],
    queryFn: () => getVehicleObligation(supabase, id!),
    enabled: !!id,
  })
}

export function useCreateVehicleObligation() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<VehicleObligation, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
    ) => createVehicleObligation(supabase, { ...payload, tenant_id: getTenantId() }),
    onSuccess: (ob) => {
      qc.invalidateQueries({ queryKey: [KEY, 'by-vehicle', ob.vehicle_id] })
      qc.invalidateQueries({ queryKey: ['vehicle-position'] })
    },
  })
}

export function useUpdateVehicleObligation() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<VehicleObligation, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>
    }) => updateVehicleObligation(supabase, id, payload),
    onSuccess: (ob) => {
      qc.invalidateQueries({ queryKey: [KEY, 'by-vehicle', ob.vehicle_id] })
      qc.invalidateQueries({ queryKey: [KEY, ob.id] })
      qc.invalidateQueries({ queryKey: ['vehicle-position'] })
    },
  })
}

export function useDeleteVehicleObligation() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteVehicleObligation(supabase, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] })
      qc.invalidateQueries({ queryKey: ['vehicle-position'] })
    },
  })
}
