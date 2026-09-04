/**
 * Tokens de tema do app do cliente (Expo). Mesmo azul de marca da direção
 * "Frota Confiável" do cockpit web (ADR 0019) — React Native não tem CSS
 * custom properties, então os valores vivem aqui em vez de globals.css, mas
 * a paleta é a mesma por escolha, não coincidência.
 *
 * pending/critical seguem a ADR 0020: pending seria diferente por marca no
 * web, mas aqui só existe uma marca — usa o valor de 'frota-confiavel'.
 * critical é igual em claro/escuro por definição (alarme raro, não deve
 * variar).
 */
export interface ThemeTokens {
  bg: string
  surface: string
  surfaceAlt: string
  border: string
  text: string
  textSoft: string
  textMute: string
  primary: string
  primaryPressed: string
  primaryContrast: string
  primaryTint: string
  success: string
  successBg: string
  warning: string
  warningBg: string
  danger: string
  dangerBg: string
  info: string
  infoBg: string
  pending: string
  pendingBg: string
  critical: string
  criticalBg: string
  /** Marcador de categoria (ex.: tipo de cobrança avulsa) — não é status. */
  indigo: string
  indigoBg: string
  /** Marcador de categoria (ex.: cobrança complementar) — não é status. */
  violet: string
  violetBg: string
}

export const lightTheme: ThemeTokens = {
  bg: '#F8FAFC', surface: '#FFFFFF', surfaceAlt: '#F1F5F9', border: '#E2E8F0',
  text: '#0F172A', textSoft: '#475569', textMute: '#94A3B8',
  primary: '#2563EB', primaryPressed: '#1D4ED8', primaryContrast: '#FFFFFF', primaryTint: '#EFF6FF',
  success: '#16A34A', successBg: '#DCFCE7',
  warning: '#D97706', warningBg: '#FEF3C7',
  danger: '#DC2626', dangerBg: '#FEE2E2',
  info: '#0284C7', infoBg: '#E0F2FE',
  pending: '#CA8A04', pendingBg: '#FEF9C3',
  critical: '#B91C1C', criticalBg: '#FECACA',
  indigo: '#4F46E5', indigoBg: '#E0E7FF',
  violet: '#9333EA', violetBg: '#F3E8FF',
}

export const darkTheme: ThemeTokens = {
  bg: '#0B1120', surface: '#111827', surfaceAlt: '#0F172A', border: '#1F2937',
  text: '#F1F5F9', textSoft: '#94A3B8', textMute: '#64748B',
  primary: '#3B82F6', primaryPressed: '#60A5FA', primaryContrast: '#0B1120', primaryTint: 'rgba(59,130,246,0.16)',
  success: '#22C55E', successBg: 'rgba(34,197,94,0.16)',
  warning: '#F59E0B', warningBg: 'rgba(245,158,11,0.16)',
  danger: '#EF4444', dangerBg: 'rgba(239,68,68,0.16)',
  info: '#38BDF8', infoBg: 'rgba(56,189,248,0.16)',
  pending: '#EAB308', pendingBg: 'rgba(234,179,8,0.16)',
  critical: '#FF3B30', criticalBg: 'rgba(255,59,48,0.16)',
  indigo: '#9B9BFF', indigoBg: 'rgba(155,155,255,0.16)',
  violet: '#D97FF5', violetBg: 'rgba(217,127,245,0.16)',
}
