// Supabase Edge Function — Deno runtime
//
// Webhook da InfinitePay (ADR 0032).
//
// A InfinitePay NÃO assina a notificação e não oferece campo de segredo: a
// `webhook_url` viaja no corpo de cada criação de link e é tudo que existe.
// O corpo que chega afirma o pagamento inteiro — valor, meio, transação — e
// aceitar essa afirmação seria deixar qualquer um que descubra a URL quitar
// cobrança alheia.
//
// A resposta são três camadas, e nenhuma basta sozinha:
//
//   1. SEGREDO NO PATH — único lugar onde cabe um segredo. Tempo constante.
//   2. RECONSULTAR em `POST /payment_check`. O que vale é o que a API responde,
//      nunca o que a requisição afirmou. A consulta exige os QUATRO campos —
//      `handle`, `order_nsu`, `transaction_nsu` e `slug` —, e dois deles chegam
//      de fora. Isso é seguro porque a API os CRUZA e ancora a resposta no
//      nosso `order_nsu`. Verificado contra um pagamento real:
//
//        handle + order_nsu                     → {"success":false}
//        handle + slug                          → {"success":false}
//        handle + transaction_nsu               → {"success":false}
//        os quatro, consistentes                → {"success":true,"paid":true}
//        order_nsu ALHEIO + transaction/slug reais → {"success":true,"paid":false}
//
//      A última linha é a que importa: parear uma transação real e alheia com
//      um pedido nosso NÃO confirma nada. A primeira versão mandava só o que
//      era nosso, por precaução, e com isso nunca conseguia confirmar.
//   3. RESOLVER O TENANT PELO NOSSO REGISTRO — `order_nsu` é um UUID que este
//      sistema criou, procurado em `payment_intents`. Nada vindo de fora
//      escolhe de quem é o dinheiro.
//
// `gateway_events.signature_valid` fica `false` para sempre. É honesto: um
// provedor que não assina não pode produzir registro afirmando verificação.
//
// RETENTATIVA INVERTIDA: para a InfinitePay, 200 é "entregue" e **400 é
// reenviar" — o oposto da convenção de todo mundo. Por isso a falha de
// persistência responde 400 e não 500.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Mantém o trabalho vivo depois da resposta (runtime do Supabase Edge).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
import {
  accountCredentials, applyPayment, log, markEventTenant, markFailed, markProcessed,
  recordEvent, type NormalizedPayment,
} from '../_shared/inbox.ts'

const PROVIDER = 'infinitepay'

/** Comparação de tempo constante — o segredo do path não pode vazar por timing. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

type WebhookBody = {
  order_nsu?: unknown
  transaction_nsu?: unknown
  invoice_slug?: unknown
  amount?: unknown
  paid_amount?: unknown
  capture_method?: unknown
  receipt_url?: unknown
}

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get('INFINITEPAY_WEBHOOK_SECRET')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Camada 1: segredo no path ─────────────────────────────────────
  // Sem segredo configurado a função RECUSA tudo. Deixar a porta aberta por
  // configuração ausente seria abrir o endpoint — e aqui o segredo é a única
  // barreira na porta, já que não há assinatura.
  if (!expectedSecret) {
    log('error', 'webhook.misconfigured', { provider: PROVIDER, reason: 'INFINITEPAY_WEBHOOK_SECRET ausente' })
    return new Response('Not found', { status: 404 })
  }

  const given = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''
  if (!secretMatches(given, expectedSecret)) {
    // 404 e não 401: para quem sonda a URL, o endpoint não existe.
    log('warn', 'webhook.bad_secret', { provider: PROVIDER })
    return new Response('Not found', { status: 404 })
  }

  let body: WebhookBody
  try {
    body = await req.json() as WebhookBody
  } catch {
    log('warn', 'webhook.bad_request', { provider: PROVIDER, reason: 'corpo não é JSON' })
    return new Response('Bad request', { status: 400 })
  }

  const orderNsu = typeof body.order_nsu === 'string' ? body.order_nsu : ''
  if (!orderNsu) {
    // Sem `order_nsu` não há como saber de quem é o dinheiro, e reenviar não vai
    // fazer aparecer. 400 pediria retentativa eterna de algo insalvável — mas é
    // o único código de erro que a InfinitePay entende, e engolir com 200
    // apagaria o rastro. Fica registrado no log e devolve 400 uma vez.
    log('warn', 'webhook.bad_request', { provider: PROVIDER, reason: 'sem order_nsu' })
    return new Response('Bad request', { status: 400 })
  }

  // Sem id de evento próprio: a transação é o que identifica a entrega. Duas
  // entregas do mesmo pagamento trazem o mesmo `transaction_nsu`, e é isso que
  // `UNIQUE (provider, provider_event_id)` usa para não creditar duas vezes.
  const providerEventId = typeof body.transaction_nsu === 'string' && body.transaction_nsu
    ? body.transaction_nsu
    : orderNsu

  let eventId: string | null
  try {
    eventId = await recordEvent(supabase, {
      provider: PROVIDER,
      providerEventId,
      // Não há campo de tipo: o webhook só dispara em pagamento aprovado.
      eventType: 'payment.approved',
      payload: body as Record<string, unknown>,
      // Nunca `true`: a InfinitePay não assina. Ver cabeçalho.
      signatureValid: false,
    })
  } catch (err) {
    log('error', 'webhook.persist_failed', { provider: PROVIDER, error: String(err) })
    // 400 = reenviar, na convenção deles. Ver cabeçalho.
    return new Response('Retry', { status: 400 })
  }

  const ok = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  if (!eventId) return ok

  // RESPONDE ANTES DE PROCESSAR: eles pedem resposta em menos de 1 segundo, e
  // processar envolve uma ida à API deles. Seguro porque o evento JÁ está no
  // inbox — falha de processamento vira linha com `processed_at IS NULL`, que é
  // a fila de replay (`idx_gateway_events_unprocessed`).
  EdgeRuntime.waitUntil(
    process(supabase, eventId, orderNsu, {
      transactionNsu: typeof body.transaction_nsu === 'string' ? body.transaction_nsu : '',
      slug: typeof body.invoice_slug === 'string' ? body.invoice_slug : '',
    }).catch((err) => markFailed(supabase, eventId, err)),
  )

  return ok
})

async function process(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  orderNsu: string,
  claim: { transactionNsu: string; slug: string },
): Promise<void> {
  // ── Camada 3: o tenant sai do NOSSO registro ──────────────────────
  const { data: intent } = await supabase
    .from('payment_intents')
    .select('id, tenant_id, provider_account_id, amount')
    .eq('provider', PROVIDER)
    .eq('provider_intent_id', orderNsu)
    .maybeSingle()

  if (!intent) {
    // A InfinitePay só dispara webhook em pagamento aprovado — não há evento
    // de ciclo de vida a descartar aqui. Então todo evento sem tentativa
    // correspondente é dinheiro sem dono, e marcar como processado apagaria o
    // rastro.
    throw new Error(`pagamento sem tentativa correspondente: order_nsu=${orderNsu}`)
  }

  const it = intent as {
    id: string; tenant_id: string; provider_account_id: string; amount: number
  }
  const account = { id: it.provider_account_id, tenant_id: it.tenant_id }

  // O dono do evento é carimbado antes da reconsulta ao `payment_check`
  // (ADR 0034): daqui para a frente tudo pode falhar, e a linha que falha
  // precisa ser visível ao tenant em vez de ficar com `tenant_id` NULL.
  await markEventTenant(supabase, eventId, it.tenant_id)

  // ── Camada 2: a API da InfinitePay é quem diz se foi pago ─────────
  const credentials = await accountCredentials(supabase, account.id)
  const payment = await checkPayment(orderNsu, claim, credentials)

  // O valor cobrado não muda entre a criação do link e o pagamento — o item é
  // fixo. Divergência aqui significa que a consulta resolveu outro pagamento, e
  // isso precisa aparecer. Não é motivo para recusar o dinheiro (ADR 0024: o que
  // entrou tem que ser reconhecido), é motivo para alguém olhar.
  // `Number(...)` nos dois lados: PostgREST devolve NUMERIC como STRING, e
  // comparar 1 com "1.00" acusaria divergência em toda confirmação correta.
  const valorDoIntent = Number(it.amount)
  if (payment.outcome === 'approved' && payment.amount !== null && payment.amount !== valorDoIntent) {
    log('warn', 'webhook.amount_divergente', {
      provider: PROVIDER, order_nsu: orderNsu,
      intent_amount: valorDoIntent, api_amount: payment.amount,
    })
  }

  await applyPayment(supabase, PROVIDER, account, payment, eventId)
  await markProcessed(supabase, eventId, account.tenant_id)
}

/**
 * `capture_method` da InfinitePay → `payment_method_type` do razão.
 *
 * Desconhecido volta `null` e a RPC deriva do intent — que para este provedor é
 * `payment_link` e cai em `other`. Preferível a chutar `pix` e gravar no razão
 * um meio que ninguém usou.
 */
function toLedgerMethod(capture: unknown): string | null {
  if (capture === 'pix') return 'pix'
  if (capture === 'credit_card') return 'credit_card'
  if (capture === 'debit_card') return 'debit_card'
  return null
}

/**
 * Consulta o pagamento e traduz para o vocabulário do inbox.
 *
 * **Os QUATRO campos são obrigatórios.** Verificado contra um pagamento real:
 * qualquer subconjunto responde `{"success": false}`. A API não busca por uma
 * chave — ela CRUZA os quatro e confere a consistência entre eles.
 *
 * **Valores em CENTAVOS**, convertidos aqui — o resto do sistema fala reais.
 *
 * **`amount`, nunca `paid_amount`.** Os dois vêm e são diferentes quando o
 * cliente parcela: `paid_amount` inclui os juros que ELE paga à InfinitePay
 * (1500 e 1510 no exemplo da doc). Esse excedente não é da locadora. Creditar o
 * maior quitaria a cobrança acima do devido e deixaria o saldo negativo.
 *
 * **Sem carimbo de liquidação.** Nem esta resposta nem o corpo do webhook
 * trazem a hora do pagamento, então o razão registra o instante da confirmação.
 * É uma perda de fidelidade conhecida, não um esquecimento.
 */
async function checkPayment(
  orderNsu: string,
  claim: { transactionNsu: string; slug: string },
  credentials: Record<string, unknown>,
): Promise<NormalizedPayment> {
  const handle = credentials.handle
  if (typeof handle !== 'string' || !handle) {
    throw new Error('credencial da InfinitePay malformada')
  }

  // Faltando qualquer um deles a API responderia `success: false`, que agora é
  // tratado como "não consegui verificar" e viraria retentativa eterna. Parar
  // aqui nomeia a causa real.
  if (!claim.transactionNsu || !claim.slug) {
    throw new Error(
      `webhook sem transaction_nsu/invoice_slug — payment_check exige os quatro campos `
      + `(order_nsu=${orderNsu})`,
    )
  }

  const base = (Deno.env.get('INFINITEPAY_API_BASE') ?? 'https://api.checkout.infinitepay.io')
    .replace(/\/+$/, '')

  const res = await fetch(`${base}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      handle,
      // Nosso, e é o que ancora a resposta: com um `order_nsu` que não seja
      // deste pagamento, a API responde `paid: false` mesmo que a transação e
      // o slug sejam reais. É o que torna seguro repassar os dois campos que
      // chegaram de fora.
      order_nsu: orderNsu,
      transaction_nsu: claim.transactionNsu,
      slug: claim.slug,
    }),
  })

  if (!res.ok) throw new Error(`InfinitePay payment_check falhou: status=${res.status}`)

  const data = await res.json() as {
    success?: unknown
    paid?: unknown
    amount?: unknown
    paid_amount?: unknown
    capture_method?: unknown
  }

  // `success: false` NÃO é "não foi pago" — é "não consegui responder".
  // Confundir os dois foi o defeito que engoliu o primeiro pagamento real: o
  // evento era marcado como processado, saía da fila de replay e a cobrança
  // ficava aberta sem nada indicando por quê. Aqui vira exceção, e a exceção
  // deixa o evento em `processed_at IS NULL` para ser reprocessado.
  if (data.success !== true) {
    throw new Error(
      `payment_check não confirmou (success=${String(data.success)}) — `
      + `order_nsu=${orderNsu} slug=${claim.slug}`,
    )
  }

  // Aqui sim: a API respondeu e disse que não está pago.
  const approved = data.paid === true
  const cents = typeof data.amount === 'number' ? data.amount : null

  return {
    outcome: approved ? 'approved' : 'ignored',
    providerIntentId: orderNsu,
    amount: approved && cents !== null && cents > 0 ? cents / 100 : null,
    // A InfinitePay não informa quando liquidou. `applyPayment` cai em `now()`.
    paidAt: null,
    method: approved ? toLedgerMethod(data.capture_method) : null,
    detail: approved
      ? `paid capture_method=${String(data.capture_method)} amount=${String(cents)}`
      : `API respondeu paid=false (order_nsu=${orderNsu})`,
  }
}
