import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listVehicleDocuments,
  getVehicleDocument,
  createVehicleDocument,
  updateVehicleDocument,
  deleteVehicleDocument,
} from '../repositories/vehicleDocuments'
import type { VehicleDocument } from '@gomoto/core'

const KEY = 'vehicle_documents'

export function useVehicleDocuments(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'by-vehicle', vehicleId],
    queryFn: () => listVehicleDocuments(supabase, vehicleId!),
    enabled: !!vehicleId,
  })
}

export function useVehicleDocument(id: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, id],
    queryFn: () => getVehicleDocument(supabase, id!),
    enabled: !!id,
  })
}

export function useCreateVehicleDocument() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<VehicleDocument, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>,
    ) => createVehicleDocument(supabase, { ...payload, tenant_id: getTenantId() }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: [KEY, 'by-vehicle', doc.vehicle_id] })
    },
  })
}

export function useUpdateVehicleDocument() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<VehicleDocument, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>
    }) => updateVehicleDocument(supabase, id, payload),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: [KEY, 'by-vehicle', doc.vehicle_id] })
      qc.invalidateQueries({ queryKey: [KEY, doc.id] })
    },
  })
}

export function useDeleteVehicleDocument() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteVehicleDocument(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
