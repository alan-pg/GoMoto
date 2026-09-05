/**
 * Criação de tentativa de pagamento no gateway (ADR 0030, sobre ADR 0024).
 *
 * O valor vem de `calculateAmountDue` — a MESMA função do cockpit e do app do
 * cliente. Foi por não ser assim que o cliente com crédito pagava a mais e a
 * cobrança vencida quitava a menos (F-05 da Spec 0014).
 *
 * O provedor vem da conta que o TENANT elegeu, nunca de um `import`. Antes,
 * quem chamava esta função escolhia o gateway e ela ia procurar a conta
 * correspondente; `is_default` existia e não era lido por ninguém. Cadastrar um
 * segundo provedor não mudava o comportamento de cobrança.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateAmountDue, type LateChargePolicy } from '@gomoto/core'
import { assertMethodSupported, getProvider, PROVIDER_REGISTRY, type ProviderRegistry } from './registry'
import { resolveCredentials } from './credentials'
import { ensureQrImage } from './qr'
import { codedError, ProviderAuthError } from './types'

export type PaymentIntentResult = {
  intent_id: string
  provider: string
  provider_label: string
  method: string
  amount: number
  expires_at: string | null
  payload: Record<string, unknown> | null
  is_reused: boolean
}

type PendingIntentRow = {
  id: string
  provider: string
  method: string
  amount: number
  expires_at: string | null
  payload: Record<string, unknown> | null
}

const PENDING_COLUMNS = 'id, provider, method, amount, expires_at, payload'

/**
 * Devolve a tentativa pendente ainda válida ou cria uma nova.
 *
 * `payment_intents` tem índice único parcial por cobrança enquanto
 * `status = 'pending'`: dois QR ativos para a mesma dívida são impossíveis.
 */
export async function getOrCreateIntent(
  supabase: SupabaseClient,
  params: { tenantId: string; chargeId: string; method: string },
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<PaymentIntentResult> {
  const { tenantId, chargeId } = params

  // ── 1. Tentativa pendente e ainda válida ──────────────────────────
  const { data: existing } = await supabase
    .from('payment_intents')
    .select(PENDING_COLUMNS)
    .eq('charge_id', chargeId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    const e = existing as PendingIntentRow
    const stillValid = !e.expires_at || new Date(e.expires_at) > new Date()
    if (stillValid) return reuse(e, registry)

    await supabase.from('payment_intents').update({ status: 'expired' }).eq('id', e.id)
  }

  // ── 2. Qual gateway o tenant elegeu ───────────────────────────────
  // Resolvido ANTES de calcular valor e de ler o cliente: sem gateway eleito
  // nada do resto importa, e a falha sai barata e nomeada. A ordem inversa
  // fazia três consultas antes de descobrir que não havia com o que cobrar.
  const account = await resolveActiveAccount(supabase, tenantId)
  const provider = getProvider(account.provider, registry)
  const method = assertMethodSupported(provider, params.method)

  // ── 3. Valor devido — fonte única ─────────────────────────────────
  const { data: balance, error: balanceError } = await supabase
    .from('charge_balances')
    .select('charge_id, customer_id, due_date, total_amount, paid_amount, open_amount, late_charge_amount, status')
    .eq('charge_id', chargeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (balanceError) throw codedError('INTERNAL', balanceError.message)
  if (!balance) throw codedError('NOT_FOUND', 'Cobrança não encontrada')

  const b = balance as {
    charge_id: string; customer_id: string; due_date: string
    total_amount: number; paid_amount: number; open_amount: number
    late_charge_amount: number; status: string
  }

  if (b.status !== 'open' || b.open_amount <= 0) {
    throw codedError('CONFLICT', 'Esta cobrança não está em aberto')
  }

  const policy = await resolvePolicy(supabase, tenantId, chargeId)
  const { accrued, amount_due } = calculateAmountDue(b, policy)

  if (amount_due <= 0) throw codedError('CONFLICT', 'Nada a cobrar nesta cobrança')

  // Piso do gateway, conferido ANTES de gastar a chamada.
  //
  // A Cora recusa abaixo de R$ 5,00 com um 400 genérico
  // (`services[0].amount must be greater than or equal to 500`), que virava
  // "Não foi possível gerar o Pix. Tente novamente." na tela do operador —
  // conselho inútil, porque o valor da cobrança não muda por tentar de novo.
  //
  // Aqui a mensagem diz o limite e nomeia o gateway, e a decisão sai do
  // provedor específico: qualquer um que declare `minAmount` ganha a guarda.
  if (amount_due < provider.descriptor.minAmount) {
    throw codedError(
      'CONFLICT',
      `${provider.descriptor.label} não gera cobrança abaixo de `
      + `${provider.descriptor.minAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      + ` — esta cobrança tem ${amount_due.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    )
  }

  // ── 4. Credencial ─────────────────────────────────────────────────
  // Não vem na linha da conta: sai do Vault por função que checa o tenant,
  // porque SECURITY DEFINER ignora RLS. E é RENOVADA aqui se estiver perto de
  // vencer — o token da Cora dura 24h, então sem isso a segunda diária de
  // cobranças já falharia (ADR 0031).
  const credentials = await resolveCredentials(supabase, account, provider)

  const { data: customer } = await supabase
    .from('customers')
    .select('name, email, cpf')
    .eq('id', b.customer_id)
    .maybeSingle()

  const c = (customer ?? null) as { name: string | null; email: string | null; cpf: string | null } | null

  // ── 5. Cria no provedor ───────────────────────────────────────────
  let created
  try {
    created = await provider.createIntent({
      amount: amount_due,
      chargeId,
      method,
      credentials,
      customer: { name: c?.name ?? null, email: c?.email ?? null, document: c?.cpf ?? null },
    })
  } catch (err) {
    // Credencial recusada não é "tente novamente": alguém precisa reconectar.
    if (err instanceof ProviderAuthError) {
      throw codedError(
        'GATEWAY_UNAUTHORIZED',
        `A conexão com ${provider.descriptor.label} expirou. Reconecte a conta em Configurações.`,
      )
    }
    throw err
  }

  // O app do cliente desenha o QR a partir de uma imagem. O Mercado Pago a
  // devolve pronta; a Cora devolve só o EMV (o copia-e-cola). Em vez de ensinar
  // o app a desenhar — duas dependências novas no Expo, cujo acoplamento de SDK
  // já quebrou o app antes — a imagem é gerada aqui, uma vez, para qualquer
  // provedor que não a ofereça (ADR 0031 §4).
  const payload = await ensureQrImage(created.payload)

  // ── 6. Persiste ───────────────────────────────────────────────────
  const { data: intent, error } = await supabase
    .from('payment_intents')
    .insert({
      tenant_id: tenantId,
      charge_id: chargeId,
      provider: account.provider,
      provider_account_id: account.id,
      method,
      provider_intent_id: created.providerIntentId,
      amount: amount_due,
      // Quanto deste QR é encargo. A confirmação precisa saber para realizá-lo
      // antes de alocar — sem isso o cliente paga principal + encargo, a
      // cobrança só deve o principal, e o saldo fica NEGATIVO com o encargo
      // nunca virando receita. Guardar em vez de recalcular na confirmação:
      // entre gerar o código e o cliente pagar passam horas, e um recálculo
      // daria outro número, deixando a conta sem fechar.
      accrued_amount: accrued.total,
      status: 'pending',
      expires_at: created.expiresAt,
      payload,
    })
    .select('id')
    .single()

  // 23505 = `idx_payment_intents_one_pending_per_charge`. Outra requisição para
  // a MESMA dívida chegou primeiro — dois toques no botão do app, uma
  // reconexão, um retry do cliente HTTP. O índice fez o seu trabalho, mas
  // estourar aqui mostra "Falha ao gerar cobrança" a quem já tem um QR válido
  // esperando. O certo é entregar o QR que venceu a corrida.
  //
  // A tentativa criada no provedor por esta chamada fica órfã e expira sozinha;
  // não há como cancelá-la pela interface de provedor, e criar um QR a mais é
  // preferível a cobrar a mesma dívida duas vezes.
  if (error?.code === '23505') {
    const { data: vencedora } = await supabase
      .from('payment_intents')
      .select(PENDING_COLUMNS)
      .eq('charge_id', chargeId)
      .eq('status', 'pending')
      .maybeSingle()

    if (vencedora) return reuse(vencedora as PendingIntentRow, registry)
  }

  if (error) throw codedError('INTERNAL', error.message)

  return {
    intent_id: (intent as { id: string }).id,
    provider: account.provider,
    provider_label: provider.descriptor.label,
    method,
    amount: amount_due,
    expires_at: created.expiresAt,
    payload,
    is_reused: false,
  }
}

/**
 * A conta que o tenant elegeu para cobrar.
 *
 * `is_default AND active` é o par que define "o gateway que cobra" (ADR 0030).
 * O banco garante no máximo um por tenant, e que o eleito esteja ativo — aqui
 * as duas condições são repetidas porque a consulta não deve depender de o
 * invariante nunca ter sido violado por um caminho antigo.
 */
async function resolveActiveAccount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ id: string; provider: string }> {
  const { data, error } = await supabase
    .from('payment_provider_accounts')
    .select('id, provider')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .eq('active', true)
    .maybeSingle()

  if (error) throw codedError('INTERNAL', error.message)
  if (!data) {
    // Distinta de "credencial expirada": aqui não há gateway escolhido, e o
    // caminho de correção é a tela de Configurações, não uma retentativa.
    throw codedError(
      'FORBIDDEN',
      'Nenhum gateway de pagamento ativo. Configure a integração em Configurações.',
    )
  }

  return data as { id: string; provider: string }
}

/** Tentativa pendente reaproveitada — o QR que o cliente já tem na mão. */
function reuse(row: PendingIntentRow, registry: ProviderRegistry): PaymentIntentResult {
  // O provedor pode ter sido removido do registry entre a criação e o reuso.
  // O QR continua válido no gateway, então devolvê-lo é o certo; só o rótulo
  // bonito se perde.
  const label = registry[row.provider]?.descriptor.label ?? row.provider

  return {
    intent_id: row.id,
    provider: row.provider,
    provider_label: label,
    method: row.method,
    amount: row.amount,
    expires_at: row.expires_at,
    payload: row.payload,
    is_reused: true,
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
