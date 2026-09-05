/**
 * Cliente HTTP da Cora — modalidade Parceria (ADR 0031).
 *
 * Parceria é OAuth2 authorization_code puro, sem certificado. O mTLS da Cora
 * pertence à "Integração Direta", modalidade em que a empresa gerencia a
 * própria conta — não é a nossa.
 *
 * **Centavos moram aqui.** A Cora trabalha com inteiros em centavos; o resto do
 * GoMoto fala reais decimais. A conversão acontece neste arquivo, nas duas
 * direções, e nenhum valor em centavos atravessa a fronteira. Errar isso é
 * cobrar cem vezes o devido — e passaria despercebido em teste com valor
 * redondo.
 */

import { randomUUID } from 'node:crypto'
import { oauthRedirectUri } from '../../oauth-state'

/** Credencial recusada pela Cora. Retentar não resolve; renovar ou reconectar sim. */
export class CoraAuthError extends Error {
  constructor(message = 'Credencial da Cora recusada') {
    super(message)
    this.name = 'CoraAuthError'
  }
}

function envVar(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

/** Homologação e produção diferem só na base. */
function apiBase(): string {
  return (process.env.CORA_API_BASE ?? 'https://api.cora.com.br').replace(/\/+$/, '')
}

const REDIRECT_URI = () => oauthRedirectUri('cora')

/**
 * Escopos pedidos na autorização.
 *
 * Só `invoice`. A Cora também oferece `account` (extrato e saldo), `payment` e
 * `transfer` (iniciação de pagamento e transferência) — poder que não usamos e
 * portanto não pedimos.
 */
const SCOPES = ['invoice']

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

/** Reais decimais → centavos inteiros. `350.00` vira `35000`. */
export function toCents(amount: number): number {
  // `Math.round` e não `Math.trunc`: 350.1 * 100 dá 35009.999... em ponto
  // flutuante, e truncar cobraria um centavo a menos.
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error(`Valor inválido para a Cora: ${amount}`)
  }
  return cents
}

/** Centavos inteiros → reais decimais. `35000` vira `350`. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     envVar('CORA_CLIENT_ID'),
    response_type: 'code',
    redirect_uri:  REDIRECT_URI(),
    // "scopes", plural, separados por espaço — é como a Cora documenta.
    scopes:        SCOPES.join(' '),
    state,
  })
  return `${apiBase()}/oauth/authorize?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

/**
 * A Cora autentica o app por **HTTP Basic** no endpoint de token — diferente do
 * Mercado Pago, que espera client_id e secret no corpo JSON.
 */
async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${envVar('CORA_CLIENT_ID')}:${envVar('CORA_CLIENT_SECRET')}`,
  ).toString('base64')

  const res = await fetch(`${apiBase()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  })

  if (res.status === 400 || res.status === 401) {
    const detail = await res.text().catch(() => '')
    throw new CoraAuthError(`Cora recusou a credencial (${res.status}): ${detail.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`Cora token falhou: ${res.status}`)

  return await res.json() as TokenResponse
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: REDIRECT_URI(),
  }))
}

export function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  }))
}

// ---------------------------------------------------------------------------
// Cobrança
// ---------------------------------------------------------------------------

export type CoraInvoice = {
  id: string
  status: string
  total_amount: number
  total_paid: number
  code: string | null
  pix: { emv?: string } | null
  payment_terms: { due_date: string } | null
  payments: unknown[]
}

export type CreatePixParams = {
  /** Em REAIS. A conversão para centavos é feita aqui dentro. */
  amount: number
  chargeId: string
  dueDate: string
  customer: { name: string | null; email: string | null; document: string | null }
  accessToken: string
}

async function coraFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  })

  if (res.status === 401 || res.status === 403) {
    throw new CoraAuthError(`Cora recusou o token (${res.status})`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Cora] ${path} falhou status=${res.status} body=${body.slice(0, 500)}`)
    throw new Error(`Cora ${path} falhou: ${res.status}`)
  }

  return await res.json()
}

export async function createPixInvoice(params: CreatePixParams): Promise<CoraInvoice> {
  const document = params.customer.document?.replace(/\D/g, '') ?? ''

  const body = {
    // Nossa referência viaja aqui, como `external_reference` no Mercado Pago.
    code: params.chargeId,
    customer: {
      name: params.customer.name?.trim() || 'Cliente',
      // A Cora exige e-mail. Sem ele a emissão é recusada, então o sintético
      // entra no lugar — a cobrança não pode deixar de existir porque o
      // cadastro está incompleto.
      email: params.customer.email ?? 'cliente@gomoto.app',
      ...(document
        ? { document: { identity: document, type: document.length > 11 ? 'CNPJ' : 'CPF' } }
        : {}),
    },
    services: [{
      name: 'Locação',
      description: `Cobrança GoMoto ${params.chargeId}`,
      amount: toCents(params.amount),
    }],
    payment_terms: { due_date: params.dueDate },
    payment_forms: ['PIX'],
  }

  const json = await coraFetch('/v2/invoices', params.accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // A Cora EXIGE UUID aqui — `charge-<uuid>` é recusado com
      // "The Idempotency-Key|x-idempotency-id header must be a valid UUID"
      // (verificado contra a homologação). O Mercado Pago aceita string livre.
      //
      // UUID novo a cada tentativa, e não derivado da cobrança: a proteção
      // contra cobrar duas vezes a mesma dívida é o índice único parcial de
      // `payment_intents` (um pendente por cobrança), que é mais forte. Chave
      // fixa por cobrança quebraria a reemissão legítima — trocar de gateway
      // expira os pendentes, e a tentativa seguinte receberia de volta a
      // invoice antiga, colidindo em `UNIQUE (provider, provider_intent_id)`.
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  })

  return json as CoraInvoice
}

/** Consulta a invoice. É a fonte de verdade do webhook, que não é assinado. */
export async function getInvoice(invoiceId: string, accessToken: string): Promise<CoraInvoice> {
  return await coraFetch(`/v2/invoices/${invoiceId}`, accessToken) as CoraInvoice
}
