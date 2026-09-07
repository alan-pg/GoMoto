/**
 * Processamento de evento do Mercado Pago (ADR 0030).
 *
 * Saiu de `mercadopago-webhook/index.ts` na ADR 0034, Fase 3b, pelo mesmo
 * motivo dos outros dois: o dreno da fila precisa reprocessar um evento
 * gravado, e reimplementar a verificação seria criar um segundo caminho para
 * confirmar dinheiro.
 *
 * Este é o único dos três que resolve a conta pelo IDENTIFICADOR DO PROVEDOR
 * (`user_id` do IPN) em vez de pela nossa tentativa. É herança do desenho do MP,
 * onde o webhook é por CONTA e não por cobrança — e é por isso que
 * `resolveAccount` existe em `_shared/inbox.ts`, usada só aqui.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  accountCredentials, applyPayment, log, markEventTenant, markProcessed,
  resolveAccount, type NormalizedPayment, type StoredEvent,
} from './inbox.ts'

export const PROVIDER = 'mercadopago'

export async function processMercadoPagoEvent(
  supabase: SupabaseClient,
  event: StoredEvent,
): Promise<void> {
  const eventId = event.id
  const payload = event.payload as {
    type?: unknown
    user_id?: unknown
    data?: { id?: unknown }
  }

  if (payload.type !== 'payment') {
    await markProcessed(supabase, eventId, null)
    return
  }

  const mpUserId = String(payload.user_id ?? '')
  const mpPaymentId = String(payload.data?.id ?? '')

  if (!mpUserId || !mpPaymentId) {
    throw new Error(
      `IPN do Mercado Pago incompleto: user_id=${mpUserId || '(vazio)'} data.id=${mpPaymentId || '(vazio)'}`,
    )
  }

  const account = await resolveAccount(supabase, PROVIDER, mpUserId)
  if (!account) {
    log('warn', 'webhook.account_not_found', { provider: PROVIDER, mp_user_id: mpUserId })
    await markProcessed(supabase, eventId, null)
    return
  }

  // O dono do evento é carimbado antes da ida ao MP (ADR 0034): daqui para a
  // frente tudo pode falhar, e a linha que falha precisa ser visível ao tenant.
  await markEventTenant(supabase, eventId, account.tenant_id)

  const credentials = await accountCredentials(supabase, account.id)
  const payment = await fetchPayment(mpPaymentId, credentials)

  await applyPayment(supabase, PROVIDER, account, payment, eventId)
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
