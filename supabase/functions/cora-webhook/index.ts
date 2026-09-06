// Supabase Edge Function — Deno runtime
//
// Webhook da Cora (ADR 0031).
//
// A Cora NÃO assina a notificação e NÃO oferece campo de segredo no cadastro do
// endpoint (`POST /endpoints/` aceita só `url`, `resource`, `trigger`). A
// requisição chega sem corpo — apenas os headers `webhook-event-id`,
// `webhook-event-type` e `webhook-resource-id`.
//
// Ou seja: quem descobrir a URL consegue postar "invoice.paid". A resposta são
// três camadas, e nenhuma delas basta sozinha:
//
//   1. SEGREDO NO PATH — é o único lugar onde cabe um segredo. Comparado em
//      tempo constante.
//   2. RECONSULTAR A INVOICE na API da Cora com o token daquele tenant. O que
//      vale é o que a API responde, nunca o que a requisição afirmou.
//   3. RESOLVER O TENANT PELO NOSSO REGISTRO — `webhook-resource-id` é
//      procurado em `payment_intents`. Nada vindo de fora escolhe de quem é o
//      dinheiro.
//
// `gateway_events.signature_valid` fica `false` para sempre aqui. É honesto: um
// provedor que não assina não pode produzir registro afirmando verificação.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Mantém o trabalho vivo depois da resposta (runtime do Supabase Edge).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
import {
  accountCredentials, applyPayment, log, markFailed, markProcessed,
  recordEvent, type NormalizedPayment,
} from '../_shared/inbox.ts'

const PROVIDER = 'cora'

/**
 * A Cora recusou a CREDENCIAL — distinto de "a Cora está fora do ar".
 *
 * A diferença decide se a confirmação sem verificação é permitida (ADR 0033).
 * Um 500 ou uma queda de rede são transitórios e devem ser retentados; um 401
 * não melhora com o tempo, porque o token de 24h só é renovado quando uma
 * cobrança é gerada, e este runtime não sabe renovar.
 */
class CoraCredentialError extends Error {
  constructor(readonly status: number) {
    super(`Cora recusou a credencial (status=${status})`)
    this.name = 'CoraCredentialError'
  }
}

/** Comparação de tempo constante — o segredo do path não pode vazar por timing. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get('CORA_WEBHOOK_SECRET')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Camada 1: segredo no path ─────────────────────────────────────
  // Sem segredo configurado a função RECUSA tudo, em vez de aceitar como o
  // webhook do MP faz em ambiente local. A diferença é que ali a assinatura é
  // a defesa e o segredo é opcional; aqui o segredo é a única barreira na
  // porta — deixá-la aberta por configuração ausente seria abrir o endpoint.
  if (!expectedSecret) {
    log('error', 'webhook.misconfigured', { provider: PROVIDER, reason: 'CORA_WEBHOOK_SECRET ausente' })
    return new Response('Not found', { status: 404 })
  }

  const given = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''
  if (!secretMatches(given, expectedSecret)) {
    // 404 e não 401: para quem sonda a URL, o endpoint não existe.
    log('warn', 'webhook.bad_secret', { provider: PROVIDER })
    return new Response('Not found', { status: 404 })
  }

  const eventType = req.headers.get('webhook-event-type') ?? ''
  const resourceId = req.headers.get('webhook-resource-id') ?? ''
  const providerEventId = req.headers.get('webhook-event-id') ?? ''

  if (!eventType || !resourceId || !providerEventId) {
    log('warn', 'webhook.bad_request', { provider: PROVIDER, reason: 'headers incompletos' })
    return new Response('Bad request', { status: 400 })
  }

  // O corpo vem vazio (`content-length: 0`). Guardamos os headers para que o
  // inbox continue sendo auditoria do que o provedor mandou.
  const payload = {
    webhook_event_id: providerEventId,
    webhook_event_type: eventType,
    webhook_resource_id: resourceId,
  }

  let eventId: string | null
  try {
    eventId = await recordEvent(supabase, {
      provider: PROVIDER,
      providerEventId,
      eventType,
      payload,
      // Nunca `true`: a Cora não assina. Ver cabeçalho.
      signatureValid: false,
    })
  } catch (err) {
    log('error', 'webhook.persist_failed', { provider: PROVIDER, error: String(err) })
    return new Response('Internal error', { status: 500 })
  }

  // A Cora espera este corpo exato.
  const ok = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  if (!eventId) return ok

  // RESPONDE ANTES DE PROCESSAR.
  //
  // O cadastro do endpoint na Cora traz `readTimeout: 2000` — dois segundos.
  // Processar envolve uma ida à API da Cora para reconsultar a invoice, o que
  // sozinho já pode estourar esse prazo. Segurar a resposta faria a Cora
  // considerar a entrega falha e reenviar por lentidão nossa.
  //
  // Seguro porque o evento JÁ está no inbox: se o processamento morrer, a
  // linha fica com `processed_at IS NULL` e o índice
  // `idx_gateway_events_unprocessed` é a fila de reprocessamento.
  EdgeRuntime.waitUntil(
    process(supabase, eventId, eventType, resourceId)
      .catch((err) => markFailed(supabase, eventId, err)),
  )

  return ok
})

async function process(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  eventType: string,
  invoiceId: string,
): Promise<void> {
  // Só eventos de invoice movimentam dinheiro nosso.
  if (!eventType.startsWith('invoice.')) {
    await markProcessed(supabase, eventId, null)
    return
  }

  // ── Camada 3: o tenant sai do NOSSO registro ──────────────────────
  // O webhook não diz de quem é a conta, e é melhor assim: casar o id da
  // invoice com uma tentativa que nós criamos é uma prova mais forte do que
  // qualquer identificador que a requisição pudesse trazer.
  const { data: intent } = await supabase
    .from('payment_intents')
    .select('id, tenant_id, provider_account_id, amount')
    .eq('provider', PROVIDER)
    .eq('provider_intent_id', invoiceId)
    .maybeSingle()

  if (!intent) {
    log('warn', 'webhook.intent_not_found', { provider: PROVIDER, invoice_id: invoiceId })
    await markProcessed(supabase, eventId, null)
    return
  }

  const it = intent as { id: string; tenant_id: string; provider_account_id: string; amount: number }
  const account = { id: it.provider_account_id, tenant_id: it.tenant_id }

  // ── Camada 2: a API da Cora é quem diz se foi pago ────────────────
  let payment: NormalizedPayment
  let semVerificacao = false

  try {
    const credentials = await accountCredentials(supabase, account.id)
    payment = await fetchInvoice(invoiceId, credentials)
  } catch (err) {
    // RISCO ACEITO (ADR 0033): credencial vencida não pode travar a
    // confirmação de dinheiro que entrou de verdade.
    //
    // O token da Cora dura 24h e só é renovado quando uma cobrança é gerada —
    // e este runtime (Deno) não alcança a renovação, que vive em `apps/web`.
    // Cobranças emitidas na segunda e pagas na quinta chegavam aqui com token
    // morto e a cobrança ficava aberta com o dinheiro na conta da locadora.
    //
    // Quatro travas, porque isto abre mão da camada 2:
    //
    //   1. SÓ credencial recusada. Um 500 ou uma queda de rede continuam
    //      falhando — são transitórios, e confirmar por causa deles seria
    //      inventar pagamento a partir de instabilidade.
    //   2. SÓ `invoice.PAID`. Qualquer outro evento não vira dinheiro.
    //   3. O VALOR É NOSSO. Vem de `payment_intents.amount`, nunca da
    //      requisição — e no caso da Cora a requisição nem tem corpo para
    //      afirmar valor. Uma notificação forjada não escolhe quanto creditar:
    //      no máximo confirma exatamente o que já íamos cobrar.
    //   4. FICA MARCADO. A ressalva vai para `payments.notes` (o operador lê
    //      junto do recebimento) e para `gateway_events.processing_error`
    //      (dá para achar todos por SQL).
    if (!(err instanceof CoraCredentialError) || eventType.toUpperCase() !== 'INVOICE.PAID') {
      throw err
    }

    semVerificacao = true
    payment = {
      outcome: 'approved',
      providerIntentId: invoiceId,
      // `Number(...)`: PostgREST devolve NUMERIC como STRING. Sem a coerção o
      // valor chegaria como "1.00" e qualquer comparação numérica adiante
      // mentiria.
      amount: Number(it.amount),
      // A Cora não diz quando liquidou e não pudemos perguntar: o razão grava
      // o instante da confirmação.
      paidAt: null,
      method: null,
      notes: 'Confirmado SEM verificação na API da Cora — credencial vencida (ADR 0033)',
      detail: `${err.message} — confirmado pelo evento ${eventType}`,
    }

    log('warn', 'webhook.confirmado_sem_verificacao', {
      provider: PROVIDER, invoice_id: invoiceId, intent_id: it.id,
      tenant_id: it.tenant_id, amount: it.amount, status: err.status,
    })
  }

  await applyPayment(supabase, PROVIDER, account, payment)
  await markProcessed(supabase, eventId, account.tenant_id)

  // Processado E com ressalva: `processed_at` preenchido junto de
  // `processing_error` é a marca de "aceito sem conferir".
  if (semVerificacao) {
    await supabase
      .from('gateway_events')
      .update({ processing_error: 'CONFIRMADO_SEM_VERIFICACAO: credencial da Cora vencida (ADR 0033)' })
      .eq('id', eventId)
  }
}

/**
 * Consulta a invoice e traduz para o vocabulário do inbox.
 *
 * `PAID`, `OPEN`, `CANCELLED` são nomes DA CORA. O núcleo só conhece
 * `approved | refunded | ignored`, e é por isso que o próximo gateway não
 * herda este vocabulário.
 *
 * Valores voltam em CENTAVOS e são convertidos aqui — o resto do sistema fala
 * reais (ADR 0031 §3).
 */
async function fetchInvoice(
  invoiceId: string,
  credentials: Record<string, unknown>,
): Promise<NormalizedPayment> {
  const accessToken = credentials.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('credencial da Cora malformada')
  }

  const base = (Deno.env.get('CORA_API_BASE') ?? 'https://api.cora.com.br').replace(/\/+$/, '')
  const res = await fetch(`${base}/v2/invoices/${invoiceId}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  // 401/403 é credencial; o resto é instabilidade. Só o primeiro autoriza a
  // confirmação sem verificação.
  if (res.status === 401 || res.status === 403) throw new CoraCredentialError(res.status)
  if (!res.ok) throw new Error(`Cora fetch invoice falhou: status=${res.status}`)

  const inv = await res.json() as {
    status: string
    total_paid: number | null
    total_amount: number | null
    // `finalized_at` é o instante da liquidação — o campo que a Cora devolve de
    // verdade. `paid_at` foi suposição minha e nunca vem; sem isto o razão
    // registrava a hora de CRIAÇÃO do pagamento como data do recebimento.
    // Verificado na homologação: {"status":"SUCCESS","created_at":"...",
    // "finalized_at":"...","total_paid":1000,"method":"PIX"}
    payments?: { finalized_at?: string; created_at?: string }[] | null
  }

  const paidCents = inv.total_paid ?? 0

  // "Pago" exige as DUAS coisas: status e dinheiro recebido. Só o status
  // deixaria uma invoice marcada como paga com `total_paid: 0` virar
  // recebimento de valor zero — que a RPC recusaria, mas com erro obscuro.
  const approved = inv.status === 'PAID' && paidCents > 0

  const outcome: NormalizedPayment['outcome'] =
    approved ? 'approved'
    : (inv.status === 'REFUNDED' || inv.status === 'CHARGEBACK') ? 'refunded'
    : 'ignored'

  const last = inv.payments?.[inv.payments.length - 1]

  return {
    outcome,
    providerIntentId: invoiceId,
    amount: paidCents > 0 ? paidCents / 100 : null,
    paidAt: last?.finalized_at ?? last?.created_at ?? null,
    detail: `${inv.status} (total_paid=${paidCents})`,
  }
}
