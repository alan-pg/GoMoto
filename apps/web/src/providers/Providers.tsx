'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { SupabaseProvider } from '@gomoto/data'
import { createClient } from '@/lib/supabase/client'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  )
  const [supabase] = useState(() => createClient())
  const [tenantId, setTenantId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function resolveTenant(userId: string | undefined) {
      if (!userId) {
        if (!cancelled) setTenantId(null)
        return
      }
      const { data } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
      if (!cancelled) setTenantId(data?.tenant_id ?? null)
    }

    supabase.auth.getUser().then(({ data }) => resolveTenant(data.user?.id))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveTenant(session?.user?.id)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseProvider client={supabase} tenantId={tenantId}>
        {children}
      </SupabaseProvider>
    </QueryClientProvider>
  )
}
