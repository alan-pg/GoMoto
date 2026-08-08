import { z } from 'zod'

/**
 * As quatro direções de marca do cockpit web (ADR 0019). `classico` é o
 * visual original do sistema, mantido como opção — não é mais o default.
 */
export const ThemeBrandSchema = z.enum(['frota-confiavel', 'estrada', 'sinalizacao', 'classico'])
export type ThemeBrand = z.infer<typeof ThemeBrandSchema>

/**
 * `system` segue prefers-color-scheme do SO — é uma preferência explícita
 * salva, não "ausência de preferência" (ADR 0019 §2).
 */
export const ColorModeSchema = z.enum(['system', 'light', 'dark'])
export type ColorMode = z.infer<typeof ColorModeSchema>

export const ThemePreferenceSchema = z.object({
  theme_brand: ThemeBrandSchema,
  color_mode: ColorModeSchema,
})
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>
