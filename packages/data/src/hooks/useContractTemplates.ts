import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listContractTemplates,
  getContractTemplate,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
} from '../repositories/contractTemplates'
import type { ContractTemplate } from '@gomoto/core'

const KEY = 'contract_templates'

export function useContractTemplates() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY],
    queryFn: () => listContractTemplates(supabase),
  })
}

export function useContractTemplate(id: string) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, id],
    queryFn: () => getContractTemplate(supabase, id),
    enabled: !!id,
  })
}

export function useCreateContractTemplate() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<ContractTemplate, 'id' | 'created_at' | 'updated_at'>,
    ) => createContractTemplate(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateContractTemplate() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<ContractTemplate, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>
    }) => updateContractTemplate(supabase, id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: [KEY] })
      qc.invalidateQueries({ queryKey: [KEY, id] })
    },
  })
}

export function useDeleteContractTemplate() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteContractTemplate(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
