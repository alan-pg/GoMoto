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
import { verifyWebhookSignature } from '../_shared/signature.ts'

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

Deno.serve(async (req: Request) => {
  const webhookSecret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)
  const dataId = url.searchParams.get('data.id') ?? ''
  const xRequestId = req.headers.get('x-request-id') ?? ''

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

  // Segredo configurado EXIGE assinatura. Antes, a verificação era pulada
  // quando o cabeçalho `x-signature` não vinha, e `signatureValid` ficava em
  // `true` por inicialização: bastava omitir o cabeçalho para forjar uma
  // confirmação de pagamento — gravada como assinatura válida.
  const verdict = await verifyWebhookSignature({
    secret: webhookSecret,
    signatureHeader: req.headers.get('x-signature'),
    dataId,
    requestId: xRequestId,
  })

  if (!verdict.accept) {
    log('warn', 'webhook.signature_rejected', {
      reason: verdict.reason, x_request_id: xRequestId, data_id: dataId,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  const signatureValid = verdict.signatureValid
  if (verdict.reason === 'unverified_no_secret') {
    log('warn', 'webhook.signature_unverified', { reason: 'MERCADOPAGO_WEBHOOK_SECRET ausente' })
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
    .select('id, tenant_id')
    .eq('provider', PROVIDER)
    .eq('external_account_id', mpUserId)
    .maybeSingle()

  if (!account) {
    log('warn', 'webhook.account_not_found', { mp_user_id: mpUserId })
    await markProcessed(supabase, eventId, null)
    return
  }

  const acc = account as { id: string; tenant_id: string }

  // O token sai do Vault, não da tabela. A Edge Function roda com service_role,
  // que a função aceita — é backend confiável e não tem tenant de usuário.
  const { data: creds } = await supabase.rpc('fn_provider_credentials', { p_account_id: acc.id })
  const accessToken = (creds as { access_token?: string } | null)?.access_token
  if (!accessToken) {
    // `processEvent` devolve `void`: o `Response` construído aqui não ia a
    // lugar nenhum — só encerrava a função. O evento ficava sem `processed_at`
    // e sem `processing_error`, indistinguível de um que ainda não rodou.
    // Lançar leva o erro ao `catch` do handler, que o grava no inbox para
    // replay depois que a credencial for corrigida.
    throw new Error(`credenciais ausentes para a conta ${acc.id}`)
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
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
  // Os quatro passos (pagamento, alocação, razão, status do intent) viraram uma
  // transação só. Antes eram quatro requisições ao PostgREST sem nada em volta:
  // uma falha no meio deixava estado partido, e a retentativa do provedor não
  // era barrada — o guarda perguntava pelo status do intent, que é justamente o
  // último passo, o que nunca chegava a acontecer. A retentativa criava um
  // segundo recebimento do mesmo dinheiro.
  //
  // A idempotência agora é do banco e está ancorada no pagamento ligado ao
  // intent, então reprocessar o inbox é seguro em qualquer ponto.
  if (payment.status === 'approved') {
    const { data: paymentId, error: confirmError } = await supabase.rpc(
      'fn_confirm_gateway_payment',
      {
        p_tenant_id: it.tenant_id,
        p_intent_id: it.id,
        p_amount: payment.transaction_amount ?? it.amount,
        p_paid_at: payment.date_approved ?? new Date().toISOString(),
      },
    )
    if (confirmError) throw new Error(`confirmação: ${confirmError.message}`)

    log('info', 'webhook.payment_confirmed', {
      payment_id: paymentId, charge_id: it.charge_id, tenant_id: it.tenant_id,
      amount: payment.transaction_amount ?? it.amount,
    })
    await markProcessed(supabase, eventId, acc.tenant_id)
    return
  }

  // ── refunded / charged_back ───────────────────────────────────────
  // Antes eram descartados com HTTP 200: dinheiro saía e o sistema não sabia.
  //
  // Este bloco já refez à mão o que `fn_reverse_payment` faz — e em quatro
  // chamadas HTTP separadas. Se o lançamento no razão falhasse depois do
  // `reversed_at` gravado, o pagamento ficava marcado como estornado com o
  // recebimento ainda de pé no razão, e o erro só ia para o log. Além disso a
  // inversão escrita aqui presume duas pernas de valor cheio: bastaria o
  // recebimento ganhar uma perna de tarifa para o estorno sair desequilibrado.
  //
  // A função faz tudo numa transação, inverte TODAS as pernas de TODAS as
  // transações do pagamento preservando as dimensões, e liga cada estorno à
  // original por `reverses_transaction_id` — o que também a torna idempotente.
  if (payment.status === 'refunded' || payment.status === 'charged_back') {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, reversed_at')
      .eq('payment_intent_id', it.id)
      .maybeSingle()

    const p = existing as { id: string; reversed_at: string | null } | null

    if (!p || p.reversed_at) {
      await markProcessed(supabase, eventId, acc.tenant_id)
      return
    }

    const { error: reversalError } = await supabase.rpc('fn_reverse_payment', {
      p_tenant_id: it.tenant_id,
      p_payment_id: p.id,
      p_reason: `Gateway: ${payment.status} (${payment.status_detail})`,
      p_reversed_by: null,
    })
    // Corrida com o estorno manual: outro caminho chegou primeiro e o dinheiro
    // já voltou. Nada a fazer, e não é falha — reprocessar não muda nada.
    if (reversalError && !reversalError.message.includes('PAYMENT_ALREADY_REVERSED')) {
      throw new Error(`estorno: ${reversalError.message}`)
    }

    await supabase.from('payment_intents').update({ status: 'refunded' }).eq('id', it.id)

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
