/**
 * Verificação de assinatura do webhook de gateway.
 *
 * Vive separado da Edge Function por um motivo: é a única parte do webhook que
 * decide se um POST vindo da internet vale como confirmação de pagamento, e
 * função Deno não é alcançável pelo Vitest. Aqui é código puro — sem I/O, sem
 * Supabase — e `packages/core` tem uma spec que importa ESTE arquivo, não uma
 * cópia dele.
 *
 * O defeito que motivou a extração estava na condição:
 *
 *     let signatureValid = true
 *     if (webhookSecret && parsedSig) { ...valida, 401 se inválida... }
 *
 * Sem `x-signature` no request, `parsedSig` é nulo, o bloco inteiro é pulado e
 * `signatureValid` permanece **true**. Ou seja: bastava OMITIR o cabeçalho para
 * a requisição ser aceita — e gravada em `gateway_events` como assinatura
 * válida. Quem alcançasse a URL forjava confirmação de pagamento.
 *
 * O mesmo valia com o segredo ausente do ambiente: tudo passava como válido,
 * sem nada no log dizendo que ninguém conferiu.
 */

export type SignatureVerdict =
  /** Segue o processamento. `signatureValid` é o que se grava — nunca um palpite. */
  | { accept: true; signatureValid: boolean; reason: 'verified' | 'unverified_no_secret' }
  /** Recusa com 401. */
  | { accept: false; reason: 'missing_signature' | 'invalid_signature' }

export type ParsedSignature = { ts: string; v1: string }

/** Cabeçalho `x-signature: ts=...,v1=...` do Mercado Pago. */
export function parseXSignature(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null

  const parts: Record<string, string> = {}
  for (const chunk of header.split(',')) {
    const [k, ...rest] = chunk.trim().split('=')
    if (k && rest.length > 0) parts[k.trim()] = rest.join('=').trim()
  }

  if (!parts['ts'] || !parts['v1']) return null
  return { ts: parts['ts'], v1: parts['v1'] }
}

/** Manifesto que o provedor assina. A ordem dos campos é parte do contrato. */
export function buildManifest(dataId: string, requestId: string, ts: string): string {
  const parts: string[] = []
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  return parts.join(';') + ';'
}

/** HMAC-SHA256 do manifesto, em hexadecimal. */
export async function signManifest(manifest: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  return Array.from(new Uint8Array(computed))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Decide o que fazer com a requisição.
 *
 * Regra: **segredo configurado exige assinatura**. Ausência de cabeçalho deixa
 * de ser "tudo bem" e passa a ser recusa — é indistinguível de tentativa de
 * forjar. Sem segredo configurado (ambiente local), segue o processamento, mas
 * grava `signatureValid: false`: o registro nunca afirma uma verificação que
 * não aconteceu.
 */
export async function verifyWebhookSignature(input: {
  secret: string | undefined | null
  signatureHeader: string | null | undefined
  dataId: string
  requestId: string
}): Promise<SignatureVerdict> {
  if (!input.secret) {
    return { accept: true, signatureValid: false, reason: 'unverified_no_secret' }
  }

  const parsed = parseXSignature(input.signatureHeader)
  if (!parsed) return { accept: false, reason: 'missing_signature' }

  const manifest = buildManifest(input.dataId, input.requestId, parsed.ts)
  const expected = await signManifest(manifest, input.secret)

  if (!timingSafeEqualHex(expected, parsed.v1)) {
    return { accept: false, reason: 'invalid_signature' }
  }

  return { accept: true, signatureValid: true, reason: 'verified' }
}

/**
 * Comparação de tempo constante.
 *
 * `a === b` em string sai no primeiro byte diferente, o que vaza quanto do
 * prefixo o atacante acertou. Para um HMAC hexadecimal isso é explorável com
 * requisições suficientes.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
