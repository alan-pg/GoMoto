import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export type PlatformRole = 'owner' | 'operator'

export type PlatformAdminContext = {
  supabase: SupabaseClient
  userId: string
  role: PlatformRole
}

/**
 * Resolve o papel do auth.uid() na tabela `platform_admins`.
 * Retorna null se não for platform_admin (ou não estiver autenticado).
 *
 * A consulta passa pela função SECURITY DEFINER `get_platform_role()` —
 * permitido ler mesmo sob RLS porque a função foge da policy recursiva.
 */
export async function getPlatformRole(client: SupabaseClient): Promise<PlatformRole | null> {
  const { data } = await client.rpc('get_platform_role')
  if (data === 'owner' || data === 'operator') return data
  return null
}

/**
 * Guard de Server Actions/pages do control plane: garante que o caller
 * é platform_admin e devolve o contexto pronto (supabase + userId + role).
 * Lança erro caso contrário — as rotas que chamam devem usar redirect()
 * antes para evitar throw, e Server Actions devem retornar `{ error }`.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const role = await getPlatformRole(supabase)
  if (!role) throw new Error('Acesso negado')

  return { supabase, userId: user.id, role }
}
