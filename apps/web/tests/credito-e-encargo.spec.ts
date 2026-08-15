import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
  waitForPageLoad, getModal,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'

/**
 * Crédito do cliente e encargo por atraso — dois fluxos que movimentam dinheiro
 * e nunca tinham sido exercitados.
 *
 * Os dois compartilham a mesma ideia: o valor existe como PROJEÇÃO até alguém
 * decidir realizá-lo. Encargo projetado não é receita; crédito disponível não é
 * abatimento. Só viram lançamento quando o operador confirma — e é exatamente
 * essa transição que nenhum teste cobria.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''
const extras: { vehicleId: string; customerId: string; rentalId: string }[] = []

async function saldo(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances')
    .select('status, open_amount, total_amount, is_overdue, days_overdue')
    .eq('charge_id', chargeId)
    .maybeSingle()
  return data as {
    status: string; open_amount: number; total_amount: number
    is_overdue: boolean; days_overdue: number
  } | null
}

/** Cobrança já vencida: a data não pode ser alterada depois (Princípio 5). */
async function cobrancaVencida(valor: number, diasAtras: number, cliente = customerId, locacao = rentalId) {
  const tenantId = await getTestTenantId()
  const vencimento = new Date(Date.now() - diasAtras * 864e5).toISOString().slice(0, 10)

  const { chargeId } = await createCharge(admin(), tenantId, {
    customerId: cliente,
    rentalId: locacao,
    dueDate: vencimento,
    sourceModule: 'manual',
    sourceId: crypto.randomUUID(),
    items: [{
      description: `${TEST_TAG} Aluguel ${RUN}`,
      credit_account_code: 'receita_locacao',
      quantity: 1, unit_amount: valor, amount: valor,
    }],
  })
  return chargeId
}

test.describe('Crédito do cliente e encargo por atraso', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    for (const e of extras) {
      await admin().from('customer_credits').delete().eq('customer_id', e.customerId)
      await admin().from('rentals').delete().eq('id', e.rentalId)
      await deleteTestCustomer(e.customerId).catch(() => {})
      await deleteTestVehicle(e.vehicleId).catch(() => {})
    }
    await admin().from('customer_credits').delete().eq('customer_id', customerId)
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('encargo só vira receita quando consolidado', async ({ page }) => {
    const chargeId = await cobrancaVencida(500, 40)

    const antes = await saldo(chargeId)
    expect(antes!.is_overdue, 'setup: a cobrança precisa estar vencida').toBe(true)

    // Enquanto projetado, o encargo NÃO existe no razão.
    const { data: semEncargo } = await admin()
      .from('financial_entries')
      .select('id')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')

    expect(semEncargo ?? [], 'encargo projetado não pode estar lançado').toEqual([])

    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Consolidar encargo' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Consolidar' }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // Agora sim: item na cobrança e receita no razão.
    const { data: itens } = await admin()
      .from('charge_items')
      .select('amount, credit_account_code, source_module')
      .eq('charge_id', chargeId)
      .eq('source_module', 'late_charge')

    const it = (itens ?? []) as { amount: number; credit_account_code: string }[]
    expect(it.length, 'consolidar não gerou item de encargo').toBe(1)
    expect(it[0]!.credit_account_code).toBe('receita_encargos_atraso')

    const { data: lancamentos } = await admin()
      .from('financial_entries')
      .select('direction, amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')

    const l = (lancamentos ?? []) as { direction: string; amount: number }[]
    expect(l.length, 'encargo consolidado sem lançamento').toBe(1)
    expect(l[0]!.direction).toBe('credit')

    // O saldo devido cresce pelo valor do encargo — nem mais, nem menos.
    const depois = await saldo(chargeId)
    expect(Number(depois!.total_amount)).toBe(500 + Number(it[0]!.amount))
  })

  test('crédito disponível abate a dívida e some do saldo do cliente', async ({ page }) => {
    const tenantId = await getTestTenantId()

    // Cliente próprio: `applyCredits` ataca a cobrança MAIS ANTIGA do cliente,
    // então reaproveitar o cliente do teste anterior faria o crédito cair na
    // cobrança errada — e a asserção olharia para a cobrança que não mudou.
    const v2 = await createTestVehicle()
    const contrato2 = await createTestContract(v2.id)
    extras.push({ vehicleId: v2.id, customerId: contrato2.customerId, rentalId: contrato2.contractId })

    const cliente2 = contrato2.customerId
    const chargeId = await cobrancaVencida(300, 5, cliente2, contrato2.contractId)

    // O crédito precisa do LANÇAMENTO, não só da linha: `customer_credit_balances`
    // agrega o ledger. Inserir só a linha dava saldo zero — foi assim que
    // descobri que a concessão pelo produto também não lançava.
    const { data: credito } = await admin().from('customer_credits').insert({
      tenant_id: tenantId, customer_id: cliente2, amount: 120,
      origin: 'manual_adjustment', reason: `${TEST_TAG} Crédito ${RUN}`,
    }).select('id').single()

    await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'credit_granted',
        description: `${TEST_TAG} Crédito concedido`,
        source_module: 'customer_credit',
        source_id: (credito as { id: string }).id,
      },
      p_entries: [
        { account_code: 'despesa_operacional', direction: 'debit', amount: 120, customer_id: cliente2 },
        { account_code: 'creditos_de_clientes', direction: 'credit', amount: 120, customer_id: cliente2 },
      ],
    })

    const antes = await saldo(chargeId)
    expect(Number(antes!.open_amount)).toBe(300)

    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Aplicar crédito' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    // O valor não vem preenchido: o operador informa quanto aplicar, e o
    // placeholder mostra o disponível.
    await modal.locator('input[type=number]').fill('120')
    await modal.getByRole('button', { name: 'Aplicar crédito' }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // A dívida cai pelo crédito aplicado.
    const depois = await saldo(chargeId)
    expect(Number(depois!.open_amount), 'crédito não abateu a dívida').toBe(180)

    // E o passivo com o cliente é baixado no razão — crédito é dívida NOSSA
    // com ele, então aplicá-lo debita `creditos_de_clientes`.
    const { data: lancamentos } = await admin()
      .from('financial_entries')
      .select('direction, amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'creditos_de_clientes')

    const l = (lancamentos ?? []) as { direction: string; amount: number }[]
    expect(l.length, 'aplicação de crédito sem lançamento').toBe(1)
    expect(l[0]!.direction).toBe('debit')
    expect(Number(l[0]!.amount)).toBe(120)

    // O saldo de crédito do cliente zera: não pode ser aplicado duas vezes.
    const { data: saldoCredito } = await admin()
      .from('customer_credit_balances')
      .select('available')
      .eq('customer_id', cliente2)
      .maybeSingle()

    expect(
      Number((saldoCredito as { available: number } | null)?.available ?? 0),
      'crédito continuou disponível depois de aplicado',
    ).toBe(0)
  })
})
