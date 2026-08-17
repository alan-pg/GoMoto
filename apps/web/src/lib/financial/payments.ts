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
import { postTransaction, dimensionsOf } from './ledger'
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
  // Marcar o pagamento, estornar o razão e reabrir a cobrança eram três
  // escritas soltas, nessa ordem. Falha no meio deixava `reversed_at` gravado
  // com o razão intacto: a tela dizia estornado, o razão dizia recebido.
  // `fn_reverse_payment` faz tudo numa transação e inverte as pernas da
  // transação de origem, o que também cobre abatimento por crédito.
  const { error } = await supabase.rpc('fn_reverse_payment', {
    p_tenant_id:   tenantId,
    p_payment_id:  paymentId,
    p_reason:      reason,
    p_reversed_by: reversedBy ?? null,
  })

  if (error) {
    const m = error.message ?? ''
    if (m.includes('PAYMENT_NOT_FOUND'))        throw new Error('Pagamento não encontrado')
    if (m.includes('PAYMENT_ALREADY_REVERSED')) throw new Error('Pagamento já estornado')
    if (m.includes('REVERSAL_REASON_REQUIRED')) throw new Error('Informe o motivo do estorno')
    if (m.includes('NOTHING_TO_REVERSE')) {
      throw new Error('Este pagamento não tem lançamento no razão para estornar')
    }
    throw new Error(`Falha ao estornar: ${m}`)
  }
}

// ============================================================
// Internos
// ============================================================

/**
 * Registra um abatimento que NÃO é entrada de dinheiro: o lançamento no razão
 * já foi feito por quem chamou (retenção de caução, crédito do cliente), e o
 * que falta é o par pagamento+alocação para `charge_balances` enxergar.
 *
 * Sem ele o abatimento vive só no razão e `open_amount` (itens − alocações)
 * continua cheio — a empresa fica com o dinheiro e o sistema segue cobrando.
 * `applyCustomerCredits` já fazia isso à mão; a retenção de caução não fazia.
 */
export async function allocateWithoutCash(
  supabase: SupabaseClient,
  tenantId: string,
  params: {
    customerId: string
    amount: number
    method: string
    notes: string
    receivedBy?: string | null
  },
): Promise<{ paymentId: string; allocated: number; unallocated: number }> {
  const open = await listOpenCharges(supabase, tenantId, params.customerId)
  const result = allocatePayment(params.amount, open)

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      tenant_id:   tenantId,
      customer_id: params.customerId,
      amount:      params.amount,
      method:      params.method,
      paid_at:     new Date().toISOString(),
      notes:       params.notes,
      received_by: params.receivedBy ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao registrar o abatimento: ${error.message}`)
  const paymentId = (payment as { id: string }).id

  if (result.allocations.length > 0) {
    const { error: allocError } = await supabase.from('payment_allocations').insert(
      result.allocations.map((a) => ({
        tenant_id:  tenantId,
        payment_id: paymentId,
        charge_id:  a.charge_id,
        amount:     a.amount,
        created_by: params.receivedBy ?? null,
      })),
    )
    if (allocError) throw new Error(`Falha ao alocar o abatimento: ${allocError.message}`)
  }

  return {
    paymentId,
    allocated: round2(params.amount - result.unallocated),
    unallocated: result.unallocated,
  }
}

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

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
