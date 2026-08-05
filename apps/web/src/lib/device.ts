const MOBILE_USER_AGENT_RE = /Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i

/**
 * Detecta User-Agent de celular real — usado pra confinar sessões mobile às
 * telas adaptadas em `/mobile/*` (ADR 0018). Não pega tablets em modo desktop
 * (ex.: iPad manda UA de Mac por padrão) nem emulação de viewport via
 * DevTools (que não altera o header User-Agent) — isso é intencional, o
 * gate é por dispositivo real, não por largura de tela.
 */
export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && MOBILE_USER_AGENT_RE.test(userAgent)
}
