import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import type { ThemePreference } from '@gomoto/core'

const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  theme_brand: 'frota-confiavel',
  color_mode: 'system',
}

/**
 * Lê a preferência de tema do operador atual (ADR 0019). Usado pela tela de
 * Configurações para mostrar a seleção atual — a aplicação do tema em si
 * acontece server-side no layout raiz, não por este hook.
 */
export function useThemePreference() {
  const supabase = useSupabaseContext()
  return useQuery<ThemePreference>({
    queryKey: ['theme_preference'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return DEFAULT_THEME_PREFERENCE

      const { data: member } = await supabase
        .from('tenant_members')
        .select('theme_brand, color_mode')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!member) return DEFAULT_THEME_PREFERENCE
      return member as ThemePreference
    },
  })
}
