import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listBillingsForCustomer } from '../repositories/billings'
import type { Billing } from '@gomoto/core'

const KEY = 'billings-customer'

/**
 * Hook mobile: retorna cobranças do cliente autenticado via RLS
 * 'customer_read_own_billings'. Não requer tenant_id — a policy usa auth.uid().
 *
 * Configurado com staleTime: 5min + refetchOnReconnect para suporte offline (RNF-003).
 */
export function useBillingsForCustomer(filter?: { status?: string }) {
  const supabase = useSupabaseContext()
  return useQuery<Billing[]>({
    queryKey: [KEY, filter],
    queryFn: () => listBillingsForCustomer(supabase, filter),
    staleTime: 5 * 60 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  })
}
