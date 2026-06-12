import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve o tenant ativo do usuário autenticado a partir de `tenant_members`.
 * Retorna null se não houver usuário ou vínculo.
 */
export async function getCurrentTenantId(client: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const { data } = await client
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  return data?.tenant_id ?? null
}
