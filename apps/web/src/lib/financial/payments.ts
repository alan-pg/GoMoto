/**
 * PaymentService — recebimento, alocação e estorno (Spec 0014).
 *
 * Todo caminho de entrada de dinheiro passa por aqui: baixa manual no cockpit,
 * pagamento pelo app e confirmação do gateway. É o que corrige F-02, em que o
 * webhook do Mercado Pago marcava `billings.status='paid'` sem nunca inserir em
 * `payments` — deixando a receita do app invisível no painel.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { allocatePayment, type ChargeBalance } from '@gomoto/core'
import { postTransaction, reverseTransaction, dimensionsOf } from './ledger'

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
export async function receivePayment(
  supabase: SupabaseClient,
  tenantId: string,
  params: ReceivePaymentParams,
): Promise<ReceivedPayment> {
  if (params.amount <= 0) throw new Error('Valor do pagamento deve ser maior que zero')

  let allocations = params.allocations
  let unallocated = 0

  if (!allocations?.length) {
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

  await settleFullyPaidCharges(supabase, tenantId, allocations.map((a) => a.chargeId))

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

/** Marca como paga a cobrança cujo saldo zerou. Status segue o saldo derivado. */
async function settleFullyPaidCharges(
  supabase: SupabaseClient,
  tenantId: string,
  chargeIds: string[],
): Promise<void> {
  if (chargeIds.length === 0) return

  const { data } = await supabase
    .from('charge_balances')
    .select('charge_id, open_amount')
    .in('charge_id', chargeIds)

  const settled = ((data ?? []) as { charge_id: string; open_amount: number }[])
    .filter((c) => c.open_amount <= 0)
    .map((c) => c.charge_id)

  if (settled.length === 0) return

  await supabase
    .from('charges')
    .update({ status: 'paid' })
    .in('id', settled)
    .eq('tenant_id', tenantId)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
