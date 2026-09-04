/**
 * Crédito do cliente — saldo e devolução em dinheiro.
 *
 * Crédito é PASSIVO: dívida da empresa com o cliente, nascida quando ele
 * desembolsou por algo que cabia à locadora. Existem duas formas de quitar essa
 * dívida, e elas produzem exatamente o mesmo resultado contábil:
 *
 *   1. Abater em cobrança futura — `credit_applied`, sem tocar no caixa.
 *   2. Devolver o dinheiro — `credit_settled`, tirando do caixa.
 *
 * A primeira só funciona enquanto existe cobrança futura. Encerrado o contrato,
 * ou pedido o dinheiro de volta, a segunda é a única saída honesta.
 *
 * O que NÃO serve para isso é estorno. Estorno desfaz o que não deveria ter
 * acontecido; o crédito aconteceu e era devido. Inverter `credit_granted`
 * apagaria também a despesa do serviço e a recuperação da parte do cliente — a
 * moto passaria a constar com custo zero no relatório.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Saldo real, derivado do razão. Nunca a soma dos créditos concedidos. */
export async function getCreditBalance(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('customer_credit_balances')
    .select('balance')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler saldo de crédito: ${error.message}`)
  return Number((data as { balance: number } | null)?.balance ?? 0)
}

export type SettleResult =
  | { ok: true; transactionId: string }
  | { ok: false; code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT'; message: string }

/**
 * Devolve crédito ao cliente em dinheiro.
 *
 * A verificação de saldo mora no banco, sob trava do cliente: o saldo é
 * derivado do razão e não há linha para travar, então duas devoluções
 * simultâneas leriam o mesmo valor e as duas pagariam — a empresa devolveria
 * mais do que devia.
 */
export async function settleCredit(
  supabase: SupabaseClient,
  tenantId: string,
  params: { customerId: string; amount: number; notes?: string | null; createdBy?: string | null },
): Promise<SettleResult> {
  const { data, error } = await supabase.rpc('fn_settle_customer_credit', {
    p_tenant_id:   tenantId,
    p_customer_id: params.customerId,
    p_amount:      params.amount,
    p_notes:       params.notes ?? null,
    p_created_by:  params.createdBy ?? null,
  })

  if (!error) return { ok: true, transactionId: data as string }

  if (error.message.includes('AMOUNT_MUST_BE_POSITIVE')) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'O valor a devolver deve ser maior que zero.' }
  }
  if (error.message.includes('CUSTOMER_NOT_FOUND')) {
    return { ok: false, code: 'NOT_FOUND', message: 'Cliente não encontrado.' }
  }
  if (error.message.includes('AMOUNT_EXCEEDS_BALANCE')) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'O valor pedido é maior que o saldo de crédito do cliente.',
    }
  }
  return { ok: false, code: 'CONFLICT', message: `Falha ao devolver crédito: ${error.message}` }
}
