import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listContracts,
  listActiveContracts,
  createContract,
  updateContract,
} from '../repositories/contracts'
import type { Contract } from '@gomoto/core'

const KEY = 'contracts'

export function useContracts() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listContracts(supabase) })
}

export function useActiveContracts() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY, 'active'], queryFn: () => listActiveContracts(supabase) })
}

export function useCreateContract() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<Contract, 'id' | 'created_at' | 'updated_at' | 'customer' | 'motorcycle'>,
    ) => createContract(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateContract() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<
        Omit<Contract, 'id' | 'created_at' | 'updated_at' | 'customer' | 'motorcycle'>
      >
    }) => updateContract(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
