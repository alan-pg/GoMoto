'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
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

  return (
    <QueryClientProvider client={queryClient}>
      <SupabaseProvider client={supabase}>{children}</SupabaseProvider>
    </QueryClientProvider>
  )
}
