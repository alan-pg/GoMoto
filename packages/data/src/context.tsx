import { createContext, useContext } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

type SupabaseContextValue = {
  client: SupabaseClient
  /**
   * Tenant ativo da sessão. Quando null, mutations levantam erro —
   * o app deve resolver o tenant (via `tenant_members`) antes de
   * permitir interação com dados de domínio.
   */
  tenantId: string | null
}

const SupabaseContext = createContext<SupabaseContextValue | null>(null)

export function SupabaseProvider({
  client,
  tenantId,
  children,
}: {
  client: SupabaseClient
  tenantId: string | null
  children: React.ReactNode
}) {
  return (
    <SupabaseContext.Provider value={{ client, tenantId }}>
      {children}
    </SupabaseContext.Provider>
  )
}

export function useSupabaseContext(): SupabaseClient {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useSupabaseContext deve ser usado dentro de <SupabaseProvider>')
  return ctx.client
}

export function useTenantId(): string | null {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('useTenantId deve ser usado dentro de <SupabaseProvider>')
  return ctx.tenantId
}

/**
 * Usado em mutations que dependem de tenant_id (todos os inserts de domínio).
 * Retorna um getter que só falha quando chamado — assim não quebra render/SSR
 * antes do tenant ser resolvido pela sessão.
 */
export function useRequiredTenantId(): () => string {
  const tenantId = useTenantId()
  return () => {
    if (!tenantId) {
      throw new Error(
        'Operação requer tenant_id, mas o tenant ainda não foi resolvido na sessão.',
      )
    }
    return tenantId
  }
}
