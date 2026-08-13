/**
 * Criação de tentativa de pagamento no gateway (Spec 0014 / ADR 0024).
 *
 * Substitui `lib/payment/pix.ts`, que era específico do Mercado Pago e
 * calculava o valor como `original_amount − discount_amount`, ignorando crédito
 * aplicado e encargo de atraso (F-05). O cliente com crédito pagava a mais; a
 * cobrança vencida quitava a menos e ainda era marcada como paga.
 *
 * Aqui o valor vem de `calculateAmountDue` — a MESMA função do cockpit e do app
 * do cliente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateAmountDue, type LateChargePolicy } from '@gomoto/core'

export type PaymentIntentResult = {
  intent_id: string
  provider: string
  method: string
  amount: number
  expires_at: string | null
  payload: Record<string, unknown> | null
  is_reused: boolean
}

/**
 * Interface que um provedor precisa implementar.
 *
 * Mercado Pago passa a ser a primeira implementação, não o formato do schema.
 */
export type PaymentProvider = {
  name: string
  createIntent(params: {
    amount: number
    chargeId: string
    method: string
    credentials: Record<string, unknown>
    customer: { name: string | null; email: string | null; document: string | null }
  }): Promise<{
    providerIntentId: string
    expiresAt: string | null
    payload: Record<string, unknown>
  }>
}

/**
 * Devolve a tentativa pendente ainda válida ou cria uma nova.
 *
 * `payment_intents` tem índice único parcial por cobrança enquanto
 * `status = 'pending'`: dois QR ativos para a mesma dívida são impossíveis.
 */
export async function getOrCreateIntent(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  method: string,
  provider: PaymentProvider,
): Promise<PaymentIntentResult> {
  // 1. Tentativa pendente e não expirada
  const { data: existing } = await supabase
    .from('payment_intents')
    .select('id, provider, method, amount, expires_at, payload')
    .eq('charge_id', chargeId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    const e = existing as {
      id: string; provider: string; method: string; amount: number
      expires_at: string | null; payload: Record<string, unknown> | null
    }

    const stillValid = !e.expires_at || new Date(e.expires_at) > new Date()
    if (stillValid) {
      return {
        intent_id: e.id, provider: e.provider, method: e.method, amount: e.amount,
        expires_at: e.expires_at, payload: e.payload, is_reused: true,
      }
    }

    await supabase.from('payment_intents').update({ status: 'expired' }).eq('id', e.id)
  }

  // 2. Valor devido — fonte única
  const { data: balance, error: balanceError } = await supabase
    .from('charge_balances')
    .select('charge_id, customer_id, due_date, total_amount, paid_amount, open_amount, status')
    .eq('charge_id', chargeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (balanceError) throw Object.assign(new Error(balanceError.message), { code: 'INTERNAL' })
  if (!balance) throw Object.assign(new Error('Cobrança não encontrada'), { code: 'NOT_FOUND' })

  const b = balance as {
    charge_id: string; customer_id: string; due_date: string
    total_amount: number; paid_amount: number; open_amount: number; status: string
  }

  if (b.status !== 'open' || b.open_amount <= 0) {
    throw Object.assign(new Error('Esta cobrança não está em aberto'), { code: 'CONFLICT' })
  }

  const policy = await resolvePolicy(supabase, tenantId, chargeId)
  const { amount_due } = calculateAmountDue(b, policy)

  if (amount_due <= 0) {
    throw Object.assign(new Error('Nada a cobrar nesta cobrança'), { code: 'CONFLICT' })
  }

  // 3. Conta do provedor
  const { data: account } = await supabase
    .from('payment_provider_accounts')
    .select('id, provider, credentials')
    .eq('tenant_id', tenantId)
    .eq('provider', provider.name)
    .eq('active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!account) {
    throw Object.assign(new Error('Integração de pagamento não configurada'), { code: 'FORBIDDEN' })
  }

  const acc = account as { id: string; provider: string; credentials: Record<string, unknown> }

  const { data: customer } = await supabase
    .from('customers')
    .select('name, email, cpf')
    .eq('id', b.customer_id)
    .maybeSingle()

  const c = (customer ?? null) as { name: string | null; email: string | null; cpf: string | null } | null

  // 4. Cria no provedor
  const created = await provider.createIntent({
    amount: amount_due,
    chargeId,
    method,
    credentials: acc.credentials,
    customer: { name: c?.name ?? null, email: c?.email ?? null, document: c?.cpf ?? null },
  })

  // 5. Persiste
  const { data: intent, error } = await supabase
    .from('payment_intents')
    .insert({
      tenant_id: tenantId,
      charge_id: chargeId,
      provider: provider.name,
      provider_account_id: acc.id,
      method,
      provider_intent_id: created.providerIntentId,
      amount: amount_due,
      status: 'pending',
      expires_at: created.expiresAt,
      payload: created.payload,
    })
    .select('id')
    .single()

  if (error) throw Object.assign(new Error(error.message), { code: 'INTERNAL' })

  return {
    intent_id: (intent as { id: string }).id,
    provider: provider.name,
    method,
    amount: amount_due,
    expires_at: created.expiresAt,
    payload: created.payload,
    is_reused: false,
  }
}

/** Política fixada na emissão da cobrança — não a vigente hoje (R-08). */
async function resolvePolicy(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
): Promise<LateChargePolicy | null> {
  const { data: charge } = await supabase
    .from('charges')
    .select('late_charge_policy_id')
    .eq('id', chargeId)
    .maybeSingle()

  const policyId = (charge as { late_charge_policy_id: string | null } | null)?.late_charge_policy_id
  if (!policyId) return null

  const { data } = await supabase
    .from('late_charge_policies')
    .select('fee_type, fee_value, daily_interest_rate, grace_period_days, min_amount')
    .eq('id', policyId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  return (data ?? null) as LateChargePolicy | null
}
