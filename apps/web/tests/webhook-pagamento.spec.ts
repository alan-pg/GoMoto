import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { receivePayment, reversePayment } from '../src/lib/financial/payments'

/**
 * P-5 (Spec 0014 §10.1) — o caminho do pagamento pelo gateway.
 *
 * A Edge Function do webhook não é exercitada aqui, e vale dizer por quê: ela
 * consulta a API do Mercado Pago para confirmar o pagamento (nunca confia no
 * payload recebido), então testá-la ponta a ponta exigiria simular um serviço
 * externo — e o que se provaria seria a qualidade do simulador.
 *
 * O que este spec cobre são as duas garantias que o webhook DEPENDE e que
 * vivem fora dele:
 *
 *   1. Idempotência é propriedade do BANCO, não do código: reenvio do mesmo
 *      evento morre no UNIQUE(provider, provider_event_id). É isso que torna
 *      seguro o gateway reentregar — e gateways reentregam.
 *   2. Estorno não apaga pagamento: marca e lança o inverso, devolvendo a
 *      cobrança para aberta.
 *
 * Fica descoberto: o parsing do payload e a chamada externa — a casca fina.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''

async function saldo(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances')
    .select('status, open_amount, paid_amount')
    .eq('charge_id', chargeId)
    .maybeSingle()
  return data as { status: string; open_amount: number; paid_amount: number } | null
}

async function novaCobranca(valor: number) {
  const tenantId = await getTestTenantId()
  const { chargeId } = await createCharge(admin(), tenantId, {
    customerId,
    rentalId,
    dueDate: new Date().toISOString().slice(0, 10),
    sourceModule: 'manual',
    sourceId: crypto.randomUUID(),
    items: [{
      description: `${TEST_TAG} Cobrança gateway ${RUN}`,
      credit_account_code: 'receita_locacao',
      quantity: 1, unit_amount: valor, amount: valor,
    }],
  })
  return chargeId
}

test.describe('Pagamento pelo gateway — garantias fora do webhook', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('evento repetido do gateway morre no banco', async () => {
    const tenantId = await getTestTenantId()
    const eventoId = `evt_${RUN}_${crypto.randomUUID()}`

    const gravar = () => admin().from('gateway_events').insert({
      tenant_id: tenantId, provider: 'mercadopago', provider_event_id: eventoId,
      event_type: 'payment.updated', payload: { id: eventoId }, signature_valid: true,
    })

    const { error: primeira } = await gravar()
    expect(primeira, primeira?.message).toBeNull()

    // Gateway reentrega — e reentrega mesmo. Sem esta trava, o segundo envio
    // registraria um segundo pagamento para o mesmo dinheiro.
    const { error: repetida } = await gravar()
    expect(repetida, 'o mesmo evento foi aceito duas vezes').not.toBeNull()

    const { count } = await admin()
      .from('gateway_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', eventoId)

    expect(count).toBe(1)
  })

  test('pagamento confirmado quita a cobrança e entra no caixa', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(400)

    await receivePayment(admin(), tenantId, {
      customerId,
      amount: 400,
      method: 'pix',
      paidAt: new Date(),
      allocations: [{ chargeId, amount: 400 }],
    })

    const s = await saldo(chargeId)
    expect(Number(s!.paid_amount)).toBe(400)
    expect(Number(s!.open_amount)).toBe(0)
    // Status é DERIVADO do saldo — não há coluna escrita a conferir.
    expect(s!.status).toBe('paid')

    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction, amount')
      .eq('charge_id', chargeId)

    const rows = (entries ?? []) as { account_code: string; direction: string; amount: number }[]
    const caixa = rows.find((e) => e.account_code === 'caixa_e_bancos')
    expect(caixa, 'pagamento não chegou ao caixa').toBeDefined()
    expect(caixa!.direction).toBe('debit')
    expect(Number(caixa!.amount)).toBe(400)
  })

  test('estorno não apaga o pagamento: marca e lança o inverso', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(250)

    const { paymentId } = await receivePayment(admin(), tenantId, {
      customerId,
      amount: 250,
      method: 'pix',
      paidAt: new Date(),
      allocations: [{ chargeId, amount: 250 }],
    })

    expect((await saldo(chargeId))!.status).toBe('paid')

    await reversePayment(admin(), tenantId, paymentId, 'Chargeback do gateway')

    // O pagamento continua existindo — marcado, não removido (Princípio 3).
    const { data: pagamento } = await admin()
      .from('payments')
      .select('id, reversed_at, reversal_reason')
      .eq('id', paymentId)
      .single()

    const p = pagamento as { reversed_at: string | null; reversal_reason: string | null }
    expect(p.reversed_at, 'estorno apagou o pagamento em vez de marcá-lo').not.toBeNull()
    expect(p.reversal_reason).toContain('Chargeback')

    // E a dívida volta: a alocação deixa de contar, então o saldo reabre.
    const depois = await saldo(chargeId)
    expect(Number(depois!.paid_amount)).toBe(0)
    expect(Number(depois!.open_amount)).toBe(250)
    expect(depois!.status).toBe('open')

    // O caixa recebeu o lançamento inverso — nada foi apagado do razão.
    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction, amount')
      .eq('charge_id', chargeId)

    const rows = (entries ?? []) as { account_code: string; direction: string; amount: number }[]
    const caixa = rows.filter((e) => e.account_code === 'caixa_e_bancos')
    expect(caixa.length, 'faltou o lançamento de estorno no caixa').toBe(2)
    expect(caixa.some((e) => e.direction === 'debit')).toBe(true)
    expect(caixa.some((e) => e.direction === 'credit')).toBe(true)
  })
})
