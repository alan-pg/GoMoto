import type { SupabaseClient } from '@supabase/supabase-js'
import type { ThemePreference } from '@gomoto/core'
import { getCurrentTenantId } from './tenant'

/**
 * Sem sessão (ex.: tela de login) — antes de autenticar não dá pra saber
 * ainda quem é o operador nem se alguma preferência salva é dele. Fica
 * sempre claro, igual o fluxo de autenticação do app mobile (ADR 0021 §6).
 */
const UNAUTHENTICATED_THEME_PREFERENCE: ThemePreference = {
  theme_brand: 'frota-confiavel',
  color_mode: 'light',
}

/**
 * Autenticado mas sem vínculo em tenant_members (ex.: platform_admin no
 * control plane) — é um usuário real, só não tem preferência de operador
 * pra ler. Segue o sistema, não força claro como o caso acima.
 */
const NO_TENANT_THEME_PREFERENCE: ThemePreference = {
  theme_brand: 'frota-confiavel',
  color_mode: 'system',
}

/**
 * Resolve a preferência de tema do usuário autenticado (ADR 0019), lida
 * server-side no layout raiz para escrever `data-brand`/`data-mode` no
 * `<html>` já no primeiro render — sem flash de tema errado.
 */
export async function getThemePreference(client: SupabaseClient): Promise<ThemePreference> {
  const { data: { user } } = await client.auth.getUser()
  if (!user) return UNAUTHENTICATED_THEME_PREFERENCE

  const tenantId = await getCurrentTenantId(client)
  if (!tenantId) return NO_TENANT_THEME_PREFERENCE

  const { data } = await client
    .from('tenant_members')
    .select('theme_brand, color_mode')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .maybeSingle()

  return data ? (data as ThemePreference) : NO_TENANT_THEME_PREFERENCE
}
