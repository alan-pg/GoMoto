import { createContext, useContext } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

const SupabaseContext = createContext<SupabaseClient | null>(null)

export function SupabaseProvider({
  client,
  children,
}: {
  client: SupabaseClient
  children: React.ReactNode
}) {
  return (
    <SupabaseContext.Provider value={client}>
      {children}
    </SupabaseContext.Provider>
  )
}

export function useSupabaseContext(): SupabaseClient {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSupabaseContext deve ser usado dentro de <SupabaseProvider>')
  return ctx
}
