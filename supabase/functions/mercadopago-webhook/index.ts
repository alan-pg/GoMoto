// Supabase Edge Function — Deno runtime
//
// Webhook de gateway (Spec 0014 / ADR 0024).
//
// Reescrita em padrão INBOX. A versão anterior tinha três defeitos graves:
//
// 1. Só fazia `UPDATE billings SET status='paid'` — nunca inseria em `payments`.
//    Como o painel financeiro soma `payments.amount`, toda receita paga pelo app
//    ficava invisível (F-02). Quanto mais o app funcionava, menor parecia o
//    faturamento.
// 2. Não persistia o evento recebido: sem replay, sem auditoria do que o
//    provedor mandou, e idempotência dependendo do efeito colateral
//    `.neq('status','paid')` (F-14).
// 3. Só tratava `status === 'approved'`. Refund e chargeback eram descartados
//    com HTTP 200 — dinheiro saía e o sistema não sabia.
//
// Agora: persiste primeiro, processa depois. `UNIQUE(provider, provider_event_id)`
// torna a idempotência propriedade do banco.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'

const PROVIDER = 'mercadopago'

const IPNSchema = z.object({
  type: z.enum(['payment', 'merchant_order']),
  user_id: z.string(),
  data: z.object({ id: z.string() }),
})

function log(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

async function validateSignature(
  dataId: string, requestId: string, ts: string, signature: string, secret: string,
): Promise<boolean> {
  const parts: string[] = []
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`)
  if (requestId) parts.push(`request-id:${requestId}`)
  parts.push(`ts:${ts}`)
  const manifest = parts.join(';') + ';'

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest))
  const hex = Array.from(new Uint8Array(computed))
    .map((b: number) => b.toString(16).padStart(2, '0')).join('')
  return hex === signature
}

function parseXSignature(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null
  const parts = Object.fromEntries(header.split(',').map((p: string) => p.trim().split('=')))
  if (!parts['ts'] || !parts['v1']) return null
  return { ts: parts['ts'], v1: parts['v1'] }
}

Deno.serve(async (req: Request) => {
  const webhookSecret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)
  const dataId = url.searchParams.get('data.id') ?? ''
  const xRequestId = req.headers.get('x-request-id') ?? ''
  const parsedSig = parseXSignature(req.headers.get('x-signature'))

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

  let signatureValid = true
  if (webhookSecret && parsedSig) {
    signatureValid = await validateSignature(
      dataId, xRequestId, parsedSig.ts, parsedSig.v1, webhookSecret,
    )
    if (!signatureValid) {
      log('warn', 'webhook.signature_invalid', { x_request_id: xRequestId, data_id: dataId })
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const providerEventId = `${ipn.data.type}:${ipn.data.data.id}:${xRequestId || dataId}`

  // ── 1. PERSISTE ANTES DE PROCESSAR ────────────────────────────────
  // Duplicata bate no UNIQUE e é reconhecida sem efeito colateral.
  const { data: event, error: insertError } = await supabase
    .from('gateway_events')
    .insert({
      provider: PROVIDER,
      provider_event_id: providerEventId,
      event_type: ipn.data.type,
      payload: body as Record<string, unknown>,
      signature_valid: signatureValid,
    })
    .select('id')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      log('info', 'webhook.duplicate', { provider_event_id: providerEventId })
      return new Response('OK', { status: 200 })
    }
    log('error', 'webhook.persist_failed', { error: insertError.message })
    return new Response('Internal error', { status: 500 })
  }

  const eventId = (event as { id: string }).id

  // Confirma o recebimento antes de processar: o provedor não deve reenviar
  // por lentidão nossa, e o evento já está seguro para replay.
  const response = new Response('OK', { status: 200 })

  try {
    await processEvent(supabase, eventId, ipn.data.data.id, ipn.data.user_id, ipn.data.type)
  } catch (err) {
    await supabase
      .from('gateway_events')
      .update({ processing_error: String(err), attempts: 1 })
      .eq('id', eventId)
    log('error', 'webhook.process_failed', { event_id: eventId, error: String(err) })
  }

  return response
})

async function processEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  mpPaymentId: string,
  mpUserId: string,
  type: string,
): Promise<void> {
  if (type !== 'payment') {
    await markProcessed(supabase, eventId, null)
    return
  }

  // Resolve o tenant pela conta do provedor — não mais por payment_connections.
  const { data: account } = await supabase
    .from('payment_provider_accounts')
    .select('id, tenant_id, credentials')
    .eq('provider', PROVIDER)
    .eq('external_account_id', mpUserId)
    .maybeSingle()

  if (!account) {
    log('warn', 'webhook.account_not_found', { mp_user_id: mpUserId })
    await markProcessed(supabase, eventId, null)
    return
  }

  const acc = account as { id: string; tenant_id: string; credentials: { access_token: string } }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${acc.credentials.access_token}` },
  })
  if (!mpRes.ok) throw new Error(`MP fetch failed: status=${mpRes.status}`)

  const payment = await mpRes.json() as {
    status: string; status_detail: string; external_reference: string
    transaction_amount: number; date_approved: string | null
  }

  const { data: intent } = await supabase
    .from('payment_intents')
    .select('id, tenant_id, charge_id, amount, status')
    .eq('provider', PROVIDER)
    .eq('provider_intent_id', mpPaymentId)
    .maybeSingle()

  if (!intent) {
    log('warn', 'webhook.intent_not_found', { mp_payment_id: mpPaymentId })
    await markProcessed(supabase, eventId, acc.tenant_id)
    return
  }

  const it = intent as {
    id: string; tenant_id: string; charge_id: string; amount: number; status: string
  }

  // ── approved ──────────────────────────────────────────────────────
  if (payment.status === 'approved') {
    if (it.status === 'paid') {
      log('info', 'webhook.already_paid', { intent_id: it.id })
      await markProcessed(supabase, eventId, acc.tenant_id)
      return
    }

    const { data: charge } = await supabase
      .from('charges')
      .select('customer_id, rental_id, charge_number')
      .eq('id', it.charge_id)
      .single()

    const ch = charge as { customer_id: string; rental_id: string | null; charge_number: number }
    const amount = payment.transaction_amount ?? it.amount
    const paidAt = payment.date_approved ?? new Date().toISOString()

    // F-02: o pagamento vira linha em `payments` COM alocação, exatamente como
    // na baixa manual. Antes, este caminho só mexia no status do documento.
    const { data: created, error: paymentError } = await supabase
      .from('payments')
      .insert({
        tenant_id: it.tenant_id,
        customer_id: ch.customer_id,
        amount,
        method: 'pix',
        paid_at: paidAt,
        payment_intent_id: it.id,
        notes: 'Confirmado pelo gateway',
      })
      .select('id')
      .single()

    if (paymentError) throw new Error(`payment insert: ${paymentError.message}`)
    const paymentId = (created as { id: string }).id

    const { error: allocError } = await supabase.from('payment_allocations').insert({
      tenant_id: it.tenant_id,
      payment_id: paymentId,
      charge_id: it.charge_id,
      amount,
    })
    if (allocError) throw new Error(`allocation insert: ${allocError.message}`)

    const { error: ledgerError } = await supabase.rpc('post_financial_transaction', {
      p_tenant_id: it.tenant_id,
      p_transaction: {
        event_type: 'payment_received',
        description: `Recebimento via gateway — cobrança #${ch.charge_number}`,
        occurred_at: paidAt,
        source_module: 'payment',
        source_id: paymentId,
      },
      p_entries: [
        { account_code: 'caixa_e_bancos', direction: 'debit', amount,
          customer_id: ch.customer_id, rental_id: ch.rental_id, charge_id: it.charge_id },
        { account_code: 'contas_a_receber', direction: 'credit', amount,
          customer_id: ch.customer_id, rental_id: ch.rental_id, charge_id: it.charge_id },
      ],
    })
    if (ledgerError) throw new Error(`ledger: ${ledgerError.message}`)

    await supabase.from('payment_intents').update({ status: 'paid' }).eq('id', it.id)

    // Saldo é derivado; o status do documento acompanha.
    const { data: balance } = await supabase
      .from('charge_balances')
      .select('open_amount')
      .eq('charge_id', it.charge_id)
      .maybeSingle()

    // Parênteses explícitos: `??` tem precedência MENOR que `<=`, então
    // `x ?? 1 <= 0` parseia como `x ?? (1 <= 0)` e inverte a condição —
    // marcaria como paga justamente a cobrança que ainda tem saldo.
    const openAmount = (balance as { open_amount: number } | null)?.open_amount ?? 0
    if (openAmount <= 0) {
      await supabase.from('charges').update({ status: 'paid' }).eq('id', it.charge_id)
    }

    log('info', 'webhook.payment_confirmed', {
      payment_id: paymentId, charge_id: it.charge_id, tenant_id: it.tenant_id, amount,
    })
    await markProcessed(supabase, eventId, acc.tenant_id)
    return
  }

  // ── refunded / charged_back ───────────────────────────────────────
  // Antes eram descartados com HTTP 200: dinheiro saía e o sistema não sabia.
  if (payment.status === 'refunded' || payment.status === 'charged_back') {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, amount, customer_id, reversed_at')
      .eq('payment_intent_id', it.id)
      .maybeSingle()

    const p = existing as {
      id: string; amount: number; customer_id: string; reversed_at: string | null
    } | null

    if (!p || p.reversed_at) {
      await markProcessed(supabase, eventId, acc.tenant_id)
      return
    }

    await supabase
      .from('payments')
      .update({
        reversed_at: new Date().toISOString(),
        reversal_reason: `Gateway: ${payment.status} (${payment.status_detail})`,
      })
      .eq('id', p.id)

    const { error: ledgerError } = await supabase.rpc('post_financial_transaction', {
      p_tenant_id: it.tenant_id,
      p_transaction: {
        event_type: 'payment_reversed',
        description: `Estorno pelo gateway — ${payment.status}`,
        source_module: 'payment',
        source_id: p.id,
      },
      p_entries: [
        { account_code: 'contas_a_receber', direction: 'debit', amount: p.amount,
          customer_id: p.customer_id, charge_id: it.charge_id },
        { account_code: 'caixa_e_bancos', direction: 'credit', amount: p.amount,
          customer_id: p.customer_id, charge_id: it.charge_id },
      ],
    })
    if (ledgerError) throw new Error(`ledger reversal: ${ledgerError.message}`)

    await supabase.from('payment_intents').update({ status: 'refunded' }).eq('id', it.id)
    await supabase.from('charges').update({ status: 'open' }).eq('id', it.charge_id)

    log('info', 'webhook.payment_reversed', {
      payment_id: p.id, charge_id: it.charge_id, status: payment.status,
    })
    await markProcessed(supabase, eventId, acc.tenant_id)
    return
  }

  log('info', 'webhook.status_ignored', {
    mp_payment_id: mpPaymentId, status: payment.status, status_detail: payment.status_detail,
  })
  await markProcessed(supabase, eventId, acc.tenant_id)
}

async function markProcessed(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  tenantId: string | null,
): Promise<void> {
  await supabase
    .from('gateway_events')
    .update({ processed_at: new Date().toISOString(), tenant_id: tenantId })
    .eq('id', eventId)
}
