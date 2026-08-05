import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listBillingsForCustomer, listBillingsHistoryForCustomer } from '../repositories/billings'
import type { Billing } from '@gomoto/core'

const KEY = 'billings-customer'

/**
 * Cobranças ativas do cliente autenticado (pending/overdue).
 * Não carrega histórico — use useHistoryBillingsForCustomer para isso.
 */
export function useBillingsForCustomer() {
  const supabase = useSupabaseContext()
  return useQuery<Billing[]>({
    queryKey: [KEY, 'active'],
    queryFn: () => listBillingsForCustomer(supabase),
    staleTime: 5 * 60 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  })
}

/**
 * Histórico de cobranças pagas/canceladas. Lazy: só busca quando `enabled` for true.
 * O cliente aciona explicitamente via "Ver histórico".
 */
export function useHistoryBillingsForCustomer(options: { enabled: boolean }) {
  const supabase = useSupabaseContext()
  return useQuery<Billing[]>({
    queryKey: [KEY, 'history'],
    queryFn: () => listBillingsHistoryForCustomer(supabase),
    enabled: options.enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}
