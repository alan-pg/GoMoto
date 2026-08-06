import type { SupabaseClient } from '@supabase/supabase-js'
import type { ThemePreference } from '@gomoto/core'
import { getCurrentTenantId } from './tenant'

const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  theme_brand: 'frota-confiavel',
  color_mode: 'system',
}

/**
 * Resolve a preferência de tema do usuário autenticado (ADR 0019), lida
 * server-side no layout raiz para escrever `data-brand`/`data-mode` no
 * `<html>` já no primeiro render — sem flash de tema errado.
 * Sem sessão ou sem tenant (ex.: platform_admin, login): default.
 */
export async function getThemePreference(client: SupabaseClient): Promise<ThemePreference> {
  const { data: { user } } = await client.auth.getUser()
  if (!user) return DEFAULT_THEME_PREFERENCE

  const tenantId = await getCurrentTenantId(client)
  if (!tenantId) return DEFAULT_THEME_PREFERENCE

  const { data } = await client
    .from('tenant_members')
    .select('theme_brand, color_mode')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle()

  return data ? (data as ThemePreference) : DEFAULT_THEME_PREFERENCE
}
