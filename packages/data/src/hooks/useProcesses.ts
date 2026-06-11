import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listProcesses,
  createProcess,
  updateProcess,
  deleteProcess,
} from '../repositories/processes'
import type { Process } from '@gomoto/core'

const KEY = 'processes'

export function useProcesses() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listProcesses(supabase) })
}

export function useCreateProcess() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<Process, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) =>
      createProcess(supabase, { ...payload, tenant_id: getTenantId() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateProcess() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<Process, 'id' | 'created_at' | 'updated_at'>>
    }) => updateProcess(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteProcess() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProcess(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
