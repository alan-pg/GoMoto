/**
 * PaymentService — recebimento, alocação e estorno (Spec 0014).
 *
 * Todo caminho de entrada de dinheiro passa por aqui: baixa manual no cockpit,
 * pagamento pelo app e confirmação do gateway. É o que corrige F-02, em que o
 * webhook do Mercado Pago marcava `billings.status='paid'` sem nunca inserir em
 * `payments` — deixando a receita do app invisível no painel.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  allocatePayment,
  calculateAccruedCharges,
  type ChargeBalance,
  type LateChargePolicy,
} from '@gomoto/core'
import { postTransaction, reverseTransaction, dimensionsOf } from './ledger'
import { realizeLateCharge } from './charges'

export type ReceivePaymentParams = {
  customerId: string
  amount: number
  method: 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'other'
  paidAt: Date
  /** Omitido: aloca por vencimento mais antigo. */
  allocations?: { chargeId: string; amount: number }[]
  paymentIntentId?: string | null
  notes?: string | null
  receivedBy?: string | null
}

export type ReceivedPayment = {
  paymentId: string
  allocations: { chargeId: string; amount: number }[]
  /** Sobra não alocada — vira crédito do cliente por decisão do chamador. */
  unallocated: number
}

/**
 * Registra dinheiro recebido e distribui entre as cobranças em aberto.
 *
 * Alocação parcial é possível por construção: a soma das alocações pode ser
 * menor que o total da cobrança. O `UNIQUE(billing_id)` da ADR 0013 tornava
 * isso fisicamente impossível.
 */

/**
 * Congela o encargo acumulado das cobranças que vão ser quitadas.
 *
 * Vale para qualquer forma de quitação — dinheiro ou crédito do cliente. O
 * encargo é devido por contrato desde o atraso; deixar de realizá-lo em um dos
 * caminhos faria quem paga com crédito escapar da multa que já correu.
 *
 * Multa e juros não são gravados: nascem do relógio (Princípio 4). Isso cria um
 * descompasso no instante do recebimento — a tela oferece "principal +
 * encargo", mas o documento só deve o principal, e `open_amount` é
 * `total − alocado` **sem piso em zero**. Receber o valor cheio sem realizar o
 * encargo antes empurrava o saldo para NEGATIVO e o encargo nunca virava
 * receita.
 *
 * Realizar aqui elimina a ordem implícita: o encargo é devido por contrato no
 * momento em que o pagamento atrasa, não por decisão de quem recebe. O botão
 * "Consolidar encargo" continua existindo para congelar sem receber — fechamento
 * de mês, segunda via —, mas deixou de ser pré-requisito.
 */
export async function realizeAccruedBefore(
  supabase: SupabaseClient,
  tenantId: string,
  chargeIds: string[],
  paidAt: Date,
): Promise<void> {
  for (const chargeId of chargeIds) {
    const { data: balanceRow } = await supabase
      .from('charge_balances')
      .select('open_amount, due_date, is_overdue, status')
      .eq('charge_id', chargeId)
      .maybeSingle()

    const b = balanceRow as {
      open_amount: number; due_date: string; is_overdue: boolean; status: string
    } | null
    if (!b || !b.is_overdue || b.status !== 'open' || b.open_amount <= 0) continue

    const { data: chargeRow } = await supabase
      .from('charges')
      .select('late_charge_policy_id')
      .eq('id', chargeId)
      .maybeSingle()

    const policyId = (chargeRow as { late_charge_policy_id: string | null } | null)?.late_charge_policy_id
    if (!policyId) continue

    const { data: policyRow } = await supabase
      .from('late_charge_policies')
      .select('fee_type, fee_value, daily_interest_rate, grace_period_days, min_amount')
      .eq('id', policyId)
      .maybeSingle()

    if (!policyRow) continue

    const accrued = calculateAccruedCharges(
      policyRow as LateChargePolicy, b.open_amount, b.due_date, paidAt,
    )
    if (accrued.total > 0) {
      await realizeLateCharge(supabase, tenantId, chargeId, accrued.total)
    }
  }
}

export async function receivePayment(
  supabase: SupabaseClient,
  tenantId: string,
  params: ReceivePaymentParams,
): Promise<ReceivedPayment> {
  if (params.amount <= 0) throw new Error('Valor do pagamento deve ser maior que zero')

  let allocations = params.allocations
  let unallocated = 0

  // Antes de alocar: o encargo do atraso vira dívida de verdade nas cobranças
  // que vão receber. Depois disso os totais já incluem multa e juros, e a
  // alocação fecha sem sobra nem saldo negativo.
  if (allocations?.length) {
    await realizeAccruedBefore(supabase, tenantId, allocations.map((a) => a.chargeId), params.paidAt)
  }

  if (!allocations?.length) {
    const abertas = await listOpenCharges(supabase, tenantId, params.customerId)
    await realizeAccruedBefore(supabase, tenantId, abertas.map((c) => c.charge_id), params.paidAt)
    const open = await listOpenCharges(supabase, tenantId, params.customerId)
    const result = allocatePayment(params.amount, open)
    allocations = result.allocations.map((a) => ({ chargeId: a.charge_id, amount: a.amount }))
    unallocated = result.unallocated
  } else {
    const total = round2(allocations.reduce((s, a) => s + a.amount, 0))
    if (total > params.amount) {
      throw new Error('A soma das alocações excede o valor recebido')
    }
    unallocated = round2(params.amount - total)
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      tenant_id: tenantId,
      customer_id: params.customerId,
      amount: params.amount,
      method: params.method,
      paid_at: params.paidAt.toISOString(),
      payment_intent_id: params.paymentIntentId ?? null,
      received_by: params.receivedBy ?? null,
      notes: params.notes ?? null,
    })
    .select('id')
    .single()

  if (paymentError) throw new Error(`Falha ao registrar pagamento: ${paymentError.message}`)
  const paymentId = (payment as { id: string }).id

  if (allocations.length > 0) {
    const { error } = await supabase.from('payment_allocations').insert(
      allocations.map((a) => ({
        tenant_id: tenantId,
        payment_id: paymentId,
        charge_id: a.chargeId,
        amount: a.amount,
        created_by: params.receivedBy ?? null,
      })),
    )
    if (error) throw new Error(`Falha ao alocar pagamento: ${error.message}`)
  }

  // Um lançamento por cobrança quitada, para o ledger carregar a dimensão certa.
  for (const alloc of allocations) {
    const charge = await chargeContext(supabase, alloc.chargeId)
    await postTransaction(supabase, tenantId, {
      event: {
        type: 'payment_received',
        amount: alloc.amount,
        dimensions: dimensionsOf({
          customerId: params.customerId,
          rentalId: charge?.rental_id ?? null,
          chargeId: alloc.chargeId,
        }),
      },
      description: `Recebimento — cobrança #${charge?.charge_number ?? '?'}`,
      sourceModule: 'payment',
      sourceId: paymentId,
      occurredAt: params.paidAt,
      createdBy: params.receivedBy ?? null,
    })
  }

  // Não há status a sincronizar: `paid` é derivado do saldo em
  // `charge_balances`. A coluna em `charges` guarda só decisão humana —
  // cancelamento e baixa (Princípio 2).

  return { paymentId, allocations, unallocated }
}

/**
 * Estorna um pagamento: marca a data, gera a transação inversa e reabre as
 * cobranças que haviam sido quitadas.
 *
 * A alocação NÃO é apagada (Princípio 3) — `charge_balances` já ignora
 * alocação de pagamento estornado ao calcular o saldo.
 */
export async function reversePayment(
  supabase: SupabaseClient,
  tenantId: string,
  paymentId: string,
  reason: string,
  reversedBy?: string | null,
): Promise<void> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, customer_id, amount, reversed_at')
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler pagamento: ${error.message}`)
  if (!payment) throw new Error('Pagamento não encontrado')

  const p = payment as { id: string; customer_id: string; amount: number; reversed_at: string | null }
  if (p.reversed_at) throw new Error('Pagamento já estornado')

  const { data: allocs } = await supabase
    .from('payment_allocations')
    .select('charge_id, amount')
    .eq('payment_id', paymentId)

  const { error: updateError } = await supabase
    .from('payments')
    .update({
      reversed_at: new Date().toISOString(),
      reversal_reason: reason,
      reversed_by: reversedBy ?? null,
    })
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)

  if (updateError) throw new Error(`Falha ao estornar: ${updateError.message}`)

  for (const alloc of (allocs ?? []) as { charge_id: string; amount: number }[]) {
    const charge = await chargeContext(supabase, alloc.charge_id)

    const original = await findIssuanceTransaction(supabase, paymentId, alloc.charge_id)

    await reverseTransaction(supabase, tenantId, original, {
      event: {
        type: 'payment_reversed',
        amount: alloc.amount,
        dimensions: dimensionsOf({
          customerId: p.customer_id,
          rentalId: charge?.rental_id ?? null,
          chargeId: alloc.charge_id,
        }),
      },
      description: `Estorno de pagamento — ${reason}`,
      sourceModule: 'payment',
      sourceId: paymentId,
      createdBy: reversedBy ?? null,
    })

    // Cobrança volta a ficar em aberto: o saldo é derivado e já reflete isso.
    await supabase
      .from('charges')
      .update({ status: 'open' })
      .eq('id', alloc.charge_id)
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
  }
}

// ============================================================
// Internos
// ============================================================

async function listOpenCharges(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<ChargeBalance[]> {
  const { data, error } = await supabase
    .from('charge_balances')
    .select('charge_id, due_date, total_amount, paid_amount, open_amount')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .gt('open_amount', 0)
    .order('due_date', { ascending: true })

  if (error) throw new Error(`Falha ao listar cobranças: ${error.message}`)
  return (data ?? []) as ChargeBalance[]
}

async function chargeContext(
  supabase: SupabaseClient,
  chargeId: string,
): Promise<{ rental_id: string | null; charge_number: number } | null> {
  const { data } = await supabase
    .from('charges')
    .select('rental_id, charge_number')
    .eq('id', chargeId)
    .maybeSingle()

  return (data ?? null) as { rental_id: string | null; charge_number: number } | null
}

/** Transação de recebimento correspondente, para amarrar o estorno. */
async function findIssuanceTransaction(
  supabase: SupabaseClient,
  paymentId: string,
  chargeId: string,
): Promise<string> {
  const { data } = await supabase
    .from('financial_transactions')
    .select('id, financial_entries!inner(charge_id)')
    .eq('source_module', 'payment')
    .eq('source_id', paymentId)
    .eq('event_type', 'payment_received')
    .eq('financial_entries.charge_id', chargeId)
    .limit(1)
    .maybeSingle()

  const id = (data as { id: string } | null)?.id
  if (!id) throw new Error('Transação de recebimento não encontrada para estorno')
  return id
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
