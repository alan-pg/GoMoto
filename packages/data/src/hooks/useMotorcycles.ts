import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listMotorcycles,
  getMotorcycle,
  createMotorcycle,
  updateMotorcycle,
  deleteMotorcycle,
} from '../repositories/motorcycles'
import type { Motorcycle } from '@gomoto/core'

const KEY = 'motorcycles'

export function useMotorcycles() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listMotorcycles(supabase) })
}

export function useMotorcycle(id: string) {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY, id], queryFn: () => getMotorcycle(supabase, id) })
}

export function useCreateMotorcycle() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<Motorcycle, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) =>
      createMotorcycle(supabase, { ...payload, tenant_id: getTenantId() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateMotorcycle() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<Motorcycle, 'id' | 'created_at' | 'updated_at'>>
    }) => updateMotorcycle(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteMotorcycle() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMotorcycle(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
