/**
 * Confirmação de pagamento vinda do gateway — dinheiro de terceiro entrando
 * pelo webhook, sem ninguém olhando.
 *
 * O caminho `approved` do webhook fazia quatro requisições HTTP separadas ao
 * PostgREST: inseria em `payments`, inseria a alocação, lançava no razão e
 * marcava o intent como `paid`. Nada de transação em volta. Cada forma de
 * falhar no meio produzia um estrago diferente — cobrança quitada sem caixa no
 * razão, caixa no razão sem cobrança quitada — e todas tinham o mesmo agravante:
 *
 * o guarda de idempotência perguntava pelo status do INTENT, que é o último dos
 * quatro passos. Se a execução morreu antes dele, a retentativa do provedor
 * passava direto pelo guarda e criava um SEGUNDO recebimento do mesmo dinheiro.
 * Provedor de pagamento reentrega por design; isto não era hipótese remota.
 *
 * `fn_confirm_gateway_payment` faz os quatro passos numa transação e ancora a
 * idempotência no fato que não pode faltar — o pagamento ligado ao intent.
 *
 * O que se prova aqui: a segunda entrega do mesmo evento não move nada, o
 * dinheiro chega inteiro ao razão e ao saldo, e o estorno pelo gateway devolve
 * tudo ao estado anterior.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { reversePayment } from '../src/lib/financial/payments'

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''
let accountId = ''

/**
 * Remove a conta do provedor e o que depende dela.
 *
 * `payment_intents.provider_account_id` é `ON DELETE RESTRICT`: apagar a conta
 * direto falha assim que um teste tiver gerado uma tentativa. Como o erro do
 * `afterAll` não era conferido, a falha passava despercebida e cada execução
 * deixava mais uma conta ATIVA no banco — resíduo que chegou a mudar o
 * resultado de um teste que perguntava "existe conta ativa?".
 */
async function removerContaProvedor(accountId: string) {
  if (!accountId) return
  await admin().from('payment_intents').delete().eq('provider_account_id', accountId)
  const { error } = await admin().from('payment_provider_accounts').delete().eq('id', accountId)
  if (error) console.warn(`[limpeza] conta ${accountId} sobreviveu: ${error.message}`)
}

async function saldo(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances')
    .select('status, total_amount, paid_amount, open_amount')
    .eq('charge_id', chargeId)
    .single()
  return data as { status: string; total_amount: number; paid_amount: number; open_amount: number }
}

/** Soma líquida de uma conta para um pagamento — o que o razão enxerga. */
async function caixaDoPagamento(paymentId: string): Promise<number> {
  const { data } = await admin()
    .from('financial_entries')
    .select('amount_signed, financial_transactions!inner(source_id)')
    .eq('account_code', 'caixa_e_bancos')
    .eq('financial_transactions.source_id', paymentId)
  return ((data ?? []) as { amount_signed: number }[])
    .reduce((s, e) => s + Number(e.amount_signed), 0)
}

/** Cria cobrança + intent pendente, como o `payment-intent` faria. */
async function cobrancaComIntent(valor: number) {
  const tenantId = await getTestTenantId()
  const charge = await createCharge(admin(), tenantId, {
    customerId,
    rentalId,
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    sourceModule: 'manual',
    items: [{
      description: `${TEST_TAG} Gateway ${RUN}`,
      credit_account_code: 'receita_locacao',
      quantity: 1, unit_amount: valor, amount: valor,
    }],
  })

  const { data: intent, error } = await admin()
    .from('payment_intents')
    .insert({
      tenant_id: tenantId, charge_id: charge.chargeId, provider: 'mercadopago',
      provider_account_id: accountId, provider_intent_id: `mp-${RUN}-${valor}`,
      amount: valor, status: 'pending', method: 'pix',
    })
    .select('id')
    .single()
  if (error) throw new Error(`intent: ${error.message}`)

  return { tenantId, chargeId: charge.chargeId, intentId: (intent as { id: string }).id }
}

/** Uma entrega do evento `approved`, exatamente como o webhook a faz. */
async function entregaEvento(tenantId: string, intentId: string, valor: number) {
  const { data, error } = await admin().rpc('fn_confirm_gateway_payment', {
    p_tenant_id: tenantId,
    p_intent_id: intentId,
    p_amount: valor,
    p_paid_at: new Date().toISOString(),
  })
  if (error) throw new Error(`confirmação: ${error.message}`)
  return data as string
}

test.beforeAll(async () => {
  const tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const contract = await createTestContract(vehicleId)
  customerId = contract.customerId
  rentalId = contract.contractId

  const { data, error } = await admin()
    .from('payment_provider_accounts')
    .insert({
      tenant_id: tenantId, provider: 'mercadopago',
      external_account_id: `teste-${RUN}`,
    })
    .select('id')
    .single()
  if (error) throw new Error(`conta do provedor: ${error.message}`)
  accountId = (data as { id: string }).id
})

test.afterAll(async () => {
  await removerContaProvedor(accountId)
  await deleteTestCustomer(customerId)
  await deleteTestVehicle(vehicleId)
})

test.describe('Confirmação do gateway', () => {
  test('uma entrega quita a cobrança e lança o caixa no razão', async () => {
    const { tenantId, chargeId, intentId } = await cobrancaComIntent(250)

    const antes = await saldo(chargeId)
    expect(antes.open_amount).toBe(250)

    const paymentId = await entregaEvento(tenantId, intentId, 250)

    const depois = await saldo(chargeId)
    expect(depois.open_amount).toBe(0)
    expect(depois.status).toBe('paid')
    expect(await caixaDoPagamento(paymentId)).toBe(250)

    const { data: intent } = await admin()
      .from('payment_intents').select('status').eq('id', intentId).single()
    expect((intent as { status: string }).status).toBe('paid')
  })

  test('a REENTREGA do mesmo evento não cria um segundo recebimento', async () => {
    const { tenantId, chargeId, intentId } = await cobrancaComIntent(400)

    const primeiro = await entregaEvento(tenantId, intentId, 400)
    const segundo = await entregaEvento(tenantId, intentId, 400)
    const terceiro = await entregaEvento(tenantId, intentId, 400)

    // Sempre o mesmo pagamento: a função devolve o que já existe.
    expect(segundo).toBe(primeiro)
    expect(terceiro).toBe(primeiro)

    const { count: pagamentos } = await admin()
      .from('payments').select('id', { count: 'exact', head: true })
      .eq('payment_intent_id', intentId)
    expect(pagamentos, 'reentrega duplicou o pagamento').toBe(1)

    const { count: alocacoes } = await admin()
      .from('payment_allocations').select('id', { count: 'exact', head: true })
      .eq('payment_id', primeiro)
    expect(alocacoes, 'reentrega duplicou a alocação').toBe(1)

    const { count: lancamentos } = await admin()
      .from('financial_transactions').select('id', { count: 'exact', head: true })
      .eq('source_module', 'payment').eq('source_id', primeiro)
    expect(lancamentos, 'reentrega duplicou o recebimento no razão').toBe(1)

    // E o cliente não foi creditado duas vezes.
    const s = await saldo(chargeId)
    expect(s.paid_amount).toBe(400)
    expect(await caixaDoPagamento(primeiro)).toBe(400)
  })

  test('o banco recusa um segundo pagamento para o mesmo intent', async () => {
    // A garantia não pode depender só do código da função: é o índice único que
    // torna a duplicata impossível, inclusive para quem inserir por fora.
    const { tenantId, chargeId, intentId } = await cobrancaComIntent(120)
    await entregaEvento(tenantId, intentId, 120)

    const { error } = await admin().from('payments').insert({
      tenant_id: tenantId, customer_id: customerId, amount: 120,
      method: 'pix', paid_at: new Date().toISOString(), payment_intent_id: intentId,
    })

    expect(error, 'o banco aceitou dois pagamentos para o mesmo intent').not.toBeNull()
    expect(error?.code).toBe('23505')
    void chargeId
  })

  test('estorno pelo gateway devolve o saldo e zera o caixa', async () => {
    const { tenantId, chargeId, intentId } = await cobrancaComIntent(180)
    const paymentId = await entregaEvento(tenantId, intentId, 180)

    expect((await saldo(chargeId)).open_amount).toBe(0)

    // É o mesmo caminho que o webhook usa para `refunded`/`charged_back`.
    await reversePayment(admin(), tenantId, paymentId, 'Gateway: refunded (teste)')

    const depois = await saldo(chargeId)
    expect(depois.open_amount, 'a dívida não voltou após o estorno').toBe(180)
    expect(depois.status).toBe('open')
    expect(await caixaDoPagamento(paymentId), 'o caixa não voltou a zero').toBe(0)

    // O pagamento não some — fica marcado. Documento emitido não se apaga.
    const { data: p } = await admin()
      .from('payments').select('reversed_at').eq('id', paymentId).single()
    expect((p as { reversed_at: string | null }).reversed_at).not.toBeNull()
  })

  test('valor não positivo é recusado', async () => {
    const { tenantId, intentId } = await cobrancaComIntent(90)
    const { error } = await admin().rpc('fn_confirm_gateway_payment', {
      p_tenant_id: tenantId, p_intent_id: intentId,
      p_amount: 0, p_paid_at: new Date().toISOString(),
    })
    expect(error?.message).toContain('AMOUNT_MUST_BE_POSITIVE')
  })
})
