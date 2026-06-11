import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listFines, createFine, updateFine, deleteFine } from '../repositories/fines'
import type { Fine } from '@gomoto/core'

const KEY = 'fines'

export function useFines() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listFines(supabase) })
}

export function useCreateFine() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<Fine, 'id' | 'created_at' | 'updated_at' | 'customers' | 'motorcycles'>,
    ) => createFine(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateFine() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<
        Omit<Fine, 'id' | 'created_at' | 'updated_at' | 'customers' | 'motorcycles'>
      >
    }) => updateFine(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteFine() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteFine(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
