import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listIncomes, createIncome, updateIncome, deleteIncome } from '../repositories/incomes'
import type { Income } from '@gomoto/core'

const KEY = 'incomes'

export function useIncomes() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listIncomes(supabase) })
}

export function useCreateIncome() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<Income, 'id' | 'created_at'>) => createIncome(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateIncome() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<Income, 'id' | 'created_at'>>
    }) => updateIncome(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteIncome() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteIncome(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
