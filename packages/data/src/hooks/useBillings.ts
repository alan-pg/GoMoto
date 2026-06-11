import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listBillings,
  createBilling,
  updateBilling,
  deleteBilling,
} from '../repositories/billings'
import type { Billing } from '@gomoto/core'

const KEY = 'billings'

export function useBillings() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listBillings(supabase) })
}

export function useCreateBilling() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts'>,
    ) => createBilling(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateBilling() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<
        Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts'>
      >
    }) => updateBilling(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteBilling() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBilling(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
