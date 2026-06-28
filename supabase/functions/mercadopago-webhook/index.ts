// Supabase Edge Function — Deno runtime
// Processa notificações IPN do Mercado Pago e confirma pagamentos automaticamente.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'

const IPNSchema = z.object({
  type:    z.enum(['payment', 'merchant_order']),
  user_id: z.string(),
  data:    z.object({ id: z.string() }),
})

async function validateSignature(
  dataId: string,
  requestId: string,
  ts: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  // Manifest format per MP docs: id:<data.id_lowercased>;request-id:<x-request-id>;ts:<ts>;
  // Fields absent from the request must be omitted (not included as empty string).
  const parts: string[] = []
  if (dataId)    parts.push(`id:${dataId.toLowerCase()}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  const manifest = parts.join(';') + ';'

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const hex = Array.from(new Uint8Array(computed))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex === signature
}

function parseXSignature(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null
  const parts = Object.fromEntries(header.split(',').map((p: string) => p.trim().split('=')))
  if (!parts['ts'] || !parts['v1']) return null
  return { ts: parts['ts'], v1: parts['v1'] }
}

function log(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

Deno.serve(async (req: Request) => {
  const webhookSecret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')
  const supabaseUrl   = Deno.env.get('SUPABASE_URL')!
  const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Validar assinatura HMAC
  // data.id vem do query param da URL (não do body), conforme especificação MP.
  const url        = new URL(req.url)
  const dataId     = url.searchParams.get('data.id') ?? ''
  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id') ?? ''
  const parsed     = parseXSignature(xSignature)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    log('warn', 'webhook.bad_request', { reason: 'invalid_json' })
    return new Response('Bad request', { status: 400 })
  }

  const ipn = IPNSchema.safeParse(body)
  if (!ipn.success) {
    log('info', 'webhook.skipped', { reason: 'unknown_type' })
    return new Response('OK', { status: 200 })
  }

  if (webhookSecret && parsed) {
    const valid = await validateSignature(dataId, xRequestId, parsed.ts, parsed.v1, webhookSecret)
    if (!valid) {
      log('warn', 'webhook.signature_invalid', { x_request_id: xRequestId, data_id: dataId })
      return new Response('Unauthorized', { status: 401 })
    }
  }

  if (ipn.data.type !== 'payment') {
    log('info', 'webhook.skipped', { reason: 'non_payment_type', type: ipn.data.type })
    return new Response('OK', { status: 200 })
  }

  const mpPaymentId = ipn.data.data.id
  const mpUserId    = ipn.data.user_id

  log('info', 'webhook.received', { mp_payment_id: mpPaymentId, mp_user_id: mpUserId })

  const supabase = createClient(supabaseUrl, serviceKey)

  // 2. Resolver tenant pelo mp_user_id
  const { data: conn } = await supabase
    .from('payment_connections')
    .select('access_token, tenant_id')
    .eq('mp_user_id', mpUserId)
    .maybeSingle()

  if (!conn) {
    log('warn', 'webhook.tenant_not_found', { mp_user_id: mpUserId, mp_payment_id: mpPaymentId })
    return new Response('OK', { status: 200 })
  }

  // 3. Confirmar pagamento no MP
  let payment: { status: string; status_detail: string; external_reference: string }
  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${conn.access_token}` },
    })
    if (!mpRes.ok) throw new Error(`status=${mpRes.status}`)
    payment = await mpRes.json()
  } catch (err) {
    log('error', 'webhook.mp_fetch_failed', { mp_payment_id: mpPaymentId, tenant_id: conn.tenant_id, error: String(err) })
    return new Response('Internal error', { status: 500 })
  }

  if (payment.status !== 'approved') {
    log('info', 'webhook.payment_not_approved', {
      mp_payment_id:  mpPaymentId,
      tenant_id:      conn.tenant_id,
      status:         payment.status,
      status_detail:  payment.status_detail,
    })
    return new Response('OK', { status: 200 })
  }

  const billingId = payment.external_reference
  if (!billingId) {
    log('warn', 'webhook.missing_external_reference', { mp_payment_id: mpPaymentId, tenant_id: conn.tenant_id })
    return new Response('OK', { status: 200 })
  }

  const now   = new Date().toISOString().slice(0, 10)
  const start = Date.now()

  // 4. Persistir baixa (idempotente)
  await supabase
    .from('billing_pix')
    .update({ status: 'paid' })
    .eq('mp_payment_id', mpPaymentId)
    .neq('status', 'paid')

  const { count } = await supabase
    .from('billings')
    .update({ status: 'paid', payment_method: 'pix', paid_at: now, confirmed_source: 'mp_webhook' })
    .eq('id', billingId)
    .neq('status', 'paid')
    .select('id', { count: 'exact', head: true })

  const latencyMs = Date.now() - start

  if (count === 0) {
    log('info', 'webhook.payment_already_confirmed', { billing_id: billingId, mp_payment_id: mpPaymentId, tenant_id: conn.tenant_id })
  } else {
    log('info', 'webhook.payment_confirmed', {
      billing_id:    billingId,
      mp_payment_id: mpPaymentId,
      tenant_id:     conn.tenant_id,
      latency_ms:    latencyMs,
    })
  }

  return new Response('OK', { status: 200 })
})
