import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import type { PaymentConnectionStatus } from '@gomoto/core'

export function usePaymentConnection() {
  const supabase = useSupabaseContext()
  return useQuery<PaymentConnectionStatus>({
    queryKey: ['payment_connection'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { is_connected: false, mp_account_email: null }

      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (!member) return { is_connected: false, mp_account_email: null }

      const { data } = await supabase
        .from('payment_connections')
        .select('mp_account_email')
        .eq('tenant_id', member.tenant_id)
        .maybeSingle()

      return {
        is_connected: !!data,
        mp_account_email: data?.mp_account_email ?? null,
      }
    },
  })
}
