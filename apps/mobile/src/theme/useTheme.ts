import type { ThemeTokens } from './tokens'
import { useThemeContext, type ThemePreference } from './ThemeProvider'

export function useTheme(): ThemeTokens {
  return useThemeContext().theme
}

/**
 * Estilo do <StatusBar> do expo-status-bar — é o oposto do fundo (ícones
 * claros sobre fundo escuro, ícones escuros sobre fundo claro).
 */
export function useStatusBarStyle(): 'light' | 'dark' {
  const { mode } = useThemeContext()
  return mode === 'light' ? 'dark' : 'light'
}

/** Preferência de tema do usuário ('auto' | 'light' | 'dark') + setter — usado pela tela de Aparência em Conta. */
export function useThemePreference(): { preference: ThemePreference; setPreference: (pref: ThemePreference) => void } {
  const { preference, setPreference } = useThemeContext()
  return { preference, setPreference }
}
