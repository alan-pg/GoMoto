// Supabase Edge Function — Deno runtime
//
// Webhook do Mercado Pago (ADR 0030, sobre ADR 0024).
//
// Este arquivo ficou com o que é DO MERCADO PAGO e mais nada: o formato do IPN,
// o esquema de assinatura `x-signature`, a consulta ao pagamento e a tradução
// do vocabulário de status dele.
//
// Persistir no inbox, resolver a conta, confirmar ou estornar e marcar o evento
// como processado — tudo que envolve dinheiro — vive em `_shared/inbox.ts`, uma
// implementação só, compartilhada com o próximo gateway.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'

// Mantém o trabalho vivo depois da resposta (runtime do Supabase Edge).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
import { verifyWebhookSignature } from '../_shared/signature.ts'
import {
  accountCredentials, applyPayment, log, markFailed, markProcessed,
  recordEvent, resolveAccount, type NormalizedPayment,
} from '../_shared/inbox.ts'

const PROVIDER = 'mercadopago'

const IPNSchema = z.object({
  type: z.enum(['payment', 'merchant_order']),
  user_id: z.string(),
  data: z.object({ id: z.string() }),
})

Deno.serve(async (req: Request) => {
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
    log('warn', 'webhook.bad_request', { provider: PROVIDER, reason: 'invalid_json' })
    return new Response('Bad request', { status: 400 })
  }

  const ipn = IPNSchema.safeParse(body)
  if (!ipn.success) {
    log('info', 'webhook.skipped', { provider: PROVIDER, reason: 'unknown_type' })
    return new Response('OK', { status: 200 })
  }

  // Segredo configurado EXIGE assinatura. Antes, a verificação era pulada
  // quando o cabeçalho `x-signature` não vinha, e `signatureValid` ficava em
  // `true` por inicialização: bastava omitir o cabeçalho para forjar uma
  // confirmação de pagamento — gravada como assinatura válida.
  const verdict = await verifyWebhookSignature({
    secret: Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET'),
    signatureHeader: req.headers.get('x-signature'),
    dataId,
    requestId: xRequestId,
  })

  if (!verdict.accept) {
    log('warn', 'webhook.signature_rejected', {
      provider: PROVIDER, reason: verdict.reason, x_request_id: xRequestId, data_id: dataId,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  if (verdict.reason === 'unverified_no_secret') {
    log('warn', 'webhook.signature_unverified', {
      provider: PROVIDER, reason: 'MERCADOPAGO_WEBHOOK_SECRET ausente',
    })
  }

  const providerEventId = `${ipn.data.type}:${ipn.data.data.id}:${xRequestId || dataId}`

  let eventId: string | null
  try {
    eventId = await recordEvent(supabase, {
      provider: PROVIDER,
      providerEventId,
      eventType: ipn.data.type,
      payload: body,
      signatureValid: verdict.signatureValid,
    })
  } catch (err) {
    log('error', 'webhook.persist_failed', { provider: PROVIDER, error: String(err) })
    return new Response('Internal error', { status: 500 })
  }

  // Duplicata: o UNIQUE reconheceu, nada a fazer.
  if (!eventId) return new Response('OK', { status: 200 })

  // RESPONDE ANTES DE PROCESSAR.
  //
  // O comentário aqui sempre disse isso, mas o código fazia o contrário: o
  // `await` segurava a resposta até a consulta ao MP e a confirmação
  // terminarem. Gateway lento nosso vira reenvio deles.
  //
  // Seguro porque o evento já está no inbox: falha no processamento deixa a
  // linha com `processed_at IS NULL`, que é a fila de reprocessamento.
  EdgeRuntime.waitUntil(
    process(supabase, eventId, ipn.data)
      .catch((err) => markFailed(supabase, eventId, err)),
  )

  return new Response('OK', { status: 200 })
})

async function process(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  ipn: z.infer<typeof IPNSchema>,
): Promise<void> {
  if (ipn.type !== 'payment') {
    await markProcessed(supabase, eventId, null)
    return
  }

  const account = await resolveAccount(supabase, PROVIDER, ipn.user_id)
  if (!account) {
    log('warn', 'webhook.account_not_found', { provider: PROVIDER, mp_user_id: ipn.user_id })
    await markProcessed(supabase, eventId, null)
    return
  }

  const credentials = await accountCredentials(supabase, account.id)
  const payment = await fetchPayment(ipn.data.id, credentials)

  await applyPayment(supabase, PROVIDER, account, payment)
  await markProcessed(supabase, eventId, account.tenant_id)
}

/**
 * Consulta o pagamento no Mercado Pago e traduz para o vocabulário do inbox.
 *
 * A tradução mora aqui de propósito: `approved`, `refunded` e `charged_back`
 * são nomes DESTE provedor. O núcleo só conhece `approved | refunded | ignored`,
 * e é por isso que o próximo gateway não precisa herdar este vocabulário.
 */
async function fetchPayment(
  mpPaymentId: string,
  credentials: Record<string, unknown>,
): Promise<NormalizedPayment> {
  const accessToken = credentials.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('credencial do Mercado Pago malformada')
  }

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`MP fetch failed: status=${res.status}`)

  const p = await res.json() as {
    status: string; status_detail: string
    transaction_amount: number; date_approved: string | null
  }

  const outcome: NormalizedPayment['outcome'] =
    p.status === 'approved' ? 'approved'
    : (p.status === 'refunded' || p.status === 'charged_back') ? 'refunded'
    : 'ignored'

  return {
    outcome,
    providerIntentId: mpPaymentId,
    amount: p.transaction_amount ?? null,
    paidAt: p.date_approved,
    detail: `${p.status} (${p.status_detail})`,
  }
}
