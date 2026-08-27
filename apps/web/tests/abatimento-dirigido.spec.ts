import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId, waitForPageLoad,
  createTestVehicle, createTestContract, deleteTestCustomer, getModal,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'

/**
 * Abatimento de crédito é DIRIGIDO: este valor, nesta cobrança.
 *
 * O modal pedia qual crédito e quanto, validava os dois e chamava
 * `applyCustomerCredits(customerId)` — que não recebe nenhum dos dois. A action
 * varria todo o saldo para as cobranças MAIS ANTIGAS em aberto: abrir a #7,
 * escolher R$ 50 e ver R$ 200 abatidos na #3 era o comportamento correto do
 * código e o oposto do que a tela prometia.
 */

const admin = () => getSupabaseAdmin()

function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daquiA(dias: number): string {
  const d = new Date(Date.now() + dias * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let tenantId = ''
let customerId = ''
let rentalId = ''
let vehicleId = ''

test.beforeAll(async () => {
  tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const c = await createTestContract(vehicleId)
  customerId = c.customerId
  rentalId = c.contractId
})

test.afterAll(async () => {
  await admin().from('rentals').delete().eq('id', rentalId)
  await deleteTestCustomer(customerId).catch(() => {})
  await admin().from('vehicles').delete().eq('id', vehicleId)
})

async function cobranca(valor: number, dueDate: string, marca: string) {
  const { chargeId } = await createCharge(admin(), tenantId, {
    customerId, rentalId, dueDate,
    sourceModule: 'manual', sourceId: crypto.randomUUID(),
    items: [{
      description: marca, credit_account_code: 'receita_locacao',
      quantity: 1, unit_amount: valor, amount: valor,
    }],
  })
  return chargeId
}

/**
 * Concede crédito como o app concede: linha em `customer_credits` E lançamento.
 *
 * O saldo sai do RAZÃO (`creditos_de_clientes`), mas a tela só oferece o botão
 * "Aplicar crédito" quando existe linha em `customer_credits` — são fontes
 * diferentes para a mesma coisa, e o teste precisa das duas para exercitar a
 * tela de verdade.
 */
async function concederCredito(valor: number) {
  const { error: linhaErr } = await admin().from('customer_credits').insert({
    tenant_id: tenantId, customer_id: customerId, amount: valor,
    origin: 'manual', reason: `${TEST_TAG} crédito de teste`,
  })
  if (linhaErr) throw new Error(`customer_credits: ${linhaErr.message}`)

  const { error } = await admin().rpc('post_financial_transaction', {
    p_tenant_id: tenantId,
    p_transaction: {
      event_type: 'credit_granted',
      description: `${TEST_TAG} crédito de teste`,
      source_module: 'manual',
      source_id: crypto.randomUUID(),
    },
    p_entries: [
      { account_code: 'despesa_manutencao', direction: 'debit', amount: valor, customer_id: customerId },
      { account_code: 'creditos_de_clientes', direction: 'credit', amount: valor, customer_id: customerId },
    ],
  })
  if (error) throw new Error(`crédito: ${error.message}`)
}

async function saldoDe(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances').select('open_amount, paid_amount, status')
    .eq('charge_id', chargeId).single()
  return data as { open_amount: number; paid_amount: number; status: string }
}

test.describe('Abatimento dirigido à cobrança aberta', () => {
  test('abate na cobrança escolhida, não na mais antiga', async () => {
    const run = Date.now().toString(36)
    const antiga = await cobranca(300, daquiA(-40), `${TEST_TAG} Antiga ${run}`)
    const atual  = await cobranca(200, hoje(), `${TEST_TAG} Atual ${run}`)
    await concederCredito(150)

    const { error } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: atual, p_amount: 150, p_created_by: null,
    })
    expect(error).toBeNull()

    // O ponto do bug: a antiga NÃO pode ter sido tocada.
    expect((await saldoDe(antiga)).paid_amount, 'a cobrança antiga não era o alvo').toBe(0)
    const alvo = await saldoDe(atual)
    expect(Number(alvo.paid_amount)).toBe(150)
    expect(Number(alvo.open_amount)).toBe(50)
  })

  test('recusa acima do saldo de crédito', async () => {
    const run = Date.now().toString(36)
    const c = await cobranca(500, hoje(), `${TEST_TAG} AcimaSaldo ${run}`)
    await concederCredito(40)

    const { data: saldoAntes } = await admin()
      .from('customer_credit_balances').select('balance').eq('customer_id', customerId).maybeSingle()
    const disponivel = Number((saldoAntes as { balance: number } | null)?.balance ?? 0)

    const { error } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: c, p_amount: disponivel + 10, p_created_by: null,
    })

    expect(error?.message ?? '').toContain('AMOUNT_EXCEEDS_BALANCE')
    expect((await saldoDe(c)).paid_amount, 'recusa antes de escrever').toBe(0)
  })

  test('recusa acima do que a cobrança deve', async () => {
    const run = Date.now().toString(36)
    const c = await cobranca(60, hoje(), `${TEST_TAG} AcimaDivida ${run}`)
    await concederCredito(500)

    const { error } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: c, p_amount: 61, p_created_by: null,
    })

    expect(error?.message ?? '').toContain('AMOUNT_EXCEEDS_CHARGE')
    expect((await saldoDe(c)).open_amount, 'nada foi abatido').toBe(60)
  })

  test('crédito de um cliente não abate dívida de outro', async () => {
    const run = Date.now().toString(36)
    const outro = await createTestContract((await createTestVehicle()).id)
    const dele = await createCharge(admin(), tenantId, {
      customerId: outro.customerId, rentalId: outro.contractId,
      dueDate: hoje(), sourceModule: 'manual', sourceId: crypto.randomUUID(),
      items: [{
        description: `${TEST_TAG} DeOutro ${run}`, credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 100, amount: 100,
      }],
    })
    await concederCredito(200)

    const { error } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: dele.chargeId, p_amount: 50, p_created_by: null,
    })

    expect(error?.message ?? '').toContain('CHARGE_BELONGS_TO_ANOTHER_CUSTOMER')

    await admin().from('rentals').delete().eq('id', outro.contractId)
    await deleteTestCustomer(outro.customerId).catch(() => {})
  })

  test('o modal mostra saldo, dívida e teto — e trava o campo neles', async ({ page }) => {
    const run = Date.now().toString(36)
    const c = await cobranca(80, hoje(), `${TEST_TAG} Modal ${run}`)
    await concederCredito(500)

    await page.goto(`/cobrancas/${c}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Aplicar crédito' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    // O que o operador precisa ver ANTES de confirmar.
    await expect(modal.getByText('Saldo de crédito')).toBeVisible()
    await expect(modal.getByText('Esta cobrança deve')).toBeVisible()
    await expect(modal.getByText('Pode abater até')).toBeVisible()

    // Teto é o MENOR entre saldo e dívida: aqui a dívida, R$ 80.
    const campo = modal.locator('input[type="number"]')
    await expect(campo).toHaveValue('80.00')

    await campo.fill('')
    await campo.type('999')
    expect(await campo.inputValue(), 'não passa do teto').toBe('80.00')
  })
})
