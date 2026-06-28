const MP_BASE  = 'https://api.mercadopago.com'
const MP_AUTH  = 'https://auth.mercadopago.com'
const MP_TOKEN = 'https://api.mercadopago.com'

function envVar(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function buildOAuthUrl(stateJwt: string): string {
  const clientId = envVar('MERCADOPAGO_CLIENT_ID')
  const redirectUri = envVar('MERCADOPAGO_REDIRECT_URI')
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    platform_id:   'mp',
    redirect_uri:  redirectUri,
    state:         stateJwt,
  })
  return `${MP_AUTH}/authorization?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string
  refresh_token: string
  mp_user_id: string
  mp_account_email: string | null
}> {
  const res = await fetch(`${MP_TOKEN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     envVar('MERCADOPAGO_CLIENT_ID'),
      client_secret: envVar('MERCADOPAGO_CLIENT_SECRET'),
      code,
      grant_type:    'authorization_code',
      redirect_uri:  envVar('MERCADOPAGO_REDIRECT_URI'),
    }),
  })
  if (!res.ok) throw new Error(`MP token exchange failed: ${res.status}`)
  const json = await res.json()
  return {
    access_token:     json.access_token,
    refresh_token:    json.refresh_token,
    mp_user_id:       String(json.user_id),
    mp_account_email: json.email ?? null,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
}> {
  const res = await fetch(`${MP_TOKEN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     envVar('MERCADOPAGO_CLIENT_ID'),
      client_secret: envVar('MERCADOPAGO_CLIENT_SECRET'),
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`MP token refresh failed: ${res.status}`)
  const json = await res.json()
  return { access_token: json.access_token, refresh_token: json.refresh_token }
}

export interface PixChargeParams {
  amount: number
  billingId: string
  customerEmail: string
  customerFirstName: string
  customerLastName: string
  customerCpf?: string | null
  accessToken: string
}

export interface PixCharge {
  mp_payment_id: string
  qr_code: string
  qr_code_base64: string
  expires_at: string
}

export async function createPixCharge(params: PixChargeParams): Promise<PixCharge> {
  const res = await fetch(`${MP_BASE}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${params.accessToken}`,
      'X-Idempotency-Key': `billing-${params.billingId}`,
    },
    body: JSON.stringify({
      transaction_amount: params.amount,
      payment_method_id:  'pix',
      external_reference: params.billingId,
      description:        'Cobrança GoMoto',
      notification_url:   process.env.MERCADOPAGO_WEBHOOK_URL ?? undefined,
      items: [
        {
          id:          params.billingId,
          title:       'Cobrança GoMoto',
          description: 'Serviços de manutenção',
          quantity:    1,
          unit_price:  params.amount,
        },
      ],
      payer: {
        email:      params.customerEmail,
        first_name: params.customerFirstName,
        last_name:  params.customerLastName,
        ...(params.customerCpf
          ? { identification: { type: 'CPF', number: params.customerCpf.replace(/\D/g, '') } }
          : {}),
      },
      date_of_expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  })

  if (res.status === 401) {
    const err = new Error('MP_UNAUTHORIZED')
    ;(err as Error & { status: number }).status = 401
    throw err
  }
  if (!res.ok) {
    const body = await res.text()
    console.error(`[MP] createPixCharge failed status=${res.status} body=${body}`)
    throw new Error(`MP create pix failed: ${res.status}`)
  }

  const json = await res.json()
  const txInfo = json.point_of_interaction?.transaction_data
  return {
    mp_payment_id:  String(json.id),
    qr_code:        txInfo?.qr_code ?? '',
    qr_code_base64: txInfo?.qr_code_base64 ?? '',
    expires_at:     json.date_of_expiration,
  }
}

export async function getPayment(
  mpPaymentId: string,
  accessToken: string,
): Promise<{ status: string; external_reference: string }> {
  const res = await fetch(`${MP_BASE}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`MP get payment failed: ${res.status}`)
  const json = await res.json()
  return { status: json.status, external_reference: json.external_reference }
}
