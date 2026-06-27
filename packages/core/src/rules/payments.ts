const PIX_TTL_MS = 24 * 60 * 60 * 1000

export function isPixActive(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() < PIX_TTL_MS
}

export function isPixExpired(createdAt: Date): boolean {
  return !isPixActive(createdAt)
}

export function canGeneratePix(
  billing: { status: string; original_amount?: number; discount_amount?: number },
  hasActiveConnection: boolean,
): boolean {
  if (!hasActiveConnection) return false
  if (billing.status === 'paid' || billing.status === 'cancelled') return false
  const amount = (billing.original_amount ?? 0) - (billing.discount_amount ?? 0)
  return amount >= 0.01
}

/**
 * Valida a assinatura HMAC-SHA256 de um webhook IPN do Mercado Pago.
 * Usa Web Crypto API (compatível com Node.js 19+ e Deno).
 *
 * Formato esperado pelo MP:
 *   HMAC-SHA256(key=secret, data="id:<paymentId>;request-id:<requestId>;ts:<ts>")
 */
export async function validateWebhookSignature(
  paymentId: string,
  requestId: string,
  ts: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const data = `id:${paymentId};request-id:${requestId};ts:${ts}`
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const computed = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const hex = Array.from(new Uint8Array(computed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex === signature
}
