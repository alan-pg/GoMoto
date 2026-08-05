import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext, useRequiredTenantId } from '../context'
import {
  listBillings,
  createBilling,
  updateBilling,
  deleteBilling,
} from '../repositories/billings'
import type { Billing } from '@gomoto/core'

const KEY = 'billings'

type BillingFilter = {
  lease_id?:     string
  status?:       'pending' | 'paid' | 'overdue' | 'cancelled' | 'prejudice'
  billing_type?: 'cycle' | 'one_time' | 'complementary'
  overdue?:      boolean
}

export function useBillings(filter?: BillingFilter) {
  const supabase = useSupabaseContext()
  return useQuery<Billing[]>({
    queryKey: [KEY, filter],
    queryFn: () => listBillings(supabase, filter),
  })
}

export function useCreateBilling() {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      payload: Omit<
        Billing,
        'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'customers' | 'contracts' | 'rentals'
      >,
    ) => createBilling(supabase, { ...payload, tenant_id: getTenantId() }),
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
        Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts' | 'rentals'>
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
