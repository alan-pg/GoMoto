import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId, waitForPageLoad,
  createTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { receivePayment } from '../src/lib/financial/payments'
import { ACCOUNTS } from '@gomoto/core'

/**
 * Caução nos indicadores de caixa e recebíveis.
 *
 * Ela É recebível e ELA entra no caixa, então sair dos totais faria os cards
 * deixarem de bater com o extrato. Mas somada ao aluguel sem distinção,
 * "Recebido no mês: R$ 500,00" pode ser 100% depósito — dinheiro que a empresa
 * devolve — enquanto o DRE, que ignora passivo corretamente, mostra outro
 * número sem explicar a diferença.
 *
 * A regra é: o total continua inteiro, a parcela de caução vem declarada.
 */

const admin = () => getSupabaseAdmin()

function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let tenantId: string
let customerId: string
let rentalId: string
let vehicleId: string
const marca = `${TEST_TAG} KpiCaucao ${Date.now().toString(36)}`

test.beforeAll(async () => {
  tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const contrato = await createTestContract(vehicleId)
  customerId = contrato.customerId
  rentalId = contrato.contractId
})

test.afterAll(async () => {
  await admin().from('rentals').delete().eq('id', rentalId)
  await deleteTestCustomer(customerId).catch(() => {})
  await admin().from('vehicles').delete().eq('id', vehicleId)
})

test.describe('Caução declarada nos indicadores', () => {
  test('a view separa a parcela de caução do total', async () => {
    const antes = await admin()
      .from('receivables_by_month')
      .select('issued_total, paid_total, deposit_issued, deposit_paid')
      .eq('tenant_id', tenantId)
      .eq('month', `${hoje().slice(0, 7)}-01`)
      .maybeSingle()

    const a = (antes.data ?? { issued_total: 0, paid_total: 0, deposit_issued: 0, deposit_paid: 0 }) as {
      issued_total: number; paid_total: number; deposit_issued: number; deposit_paid: number
    }

    // Uma de caução (passivo) e uma de aluguel (receita), ambas recebidas.
    const caucao = await createCharge(admin(), tenantId, {
      customerId, rentalId, dueDate: hoje(),
      sourceModule: 'deposit', sourceId: crypto.randomUUID(),
      items: [{
        description: `${marca} Caução`,
        credit_account_code: ACCOUNTS.DEPOSITS_PAYABLE,
        quantity: 1, unit_amount: 500, amount: 500,
      }],
    })
    const aluguel = await createCharge(admin(), tenantId, {
      customerId, rentalId, dueDate: hoje(),
      sourceModule: 'manual', sourceId: crypto.randomUUID(),
      items: [{
        description: `${marca} Aluguel`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 300, amount: 300,
      }],
    })

    for (const [chargeId, valor] of [[caucao.chargeId, 500], [aluguel.chargeId, 300]] as const) {
      await receivePayment(admin(), tenantId, {
        customerId, amount: valor, method: 'cash', paidAt: new Date(),
        allocations: [{ chargeId, amount: valor }],
      })
    }

    const { data } = await admin()
      .from('receivables_by_month')
      .select('issued_total, paid_total, deposit_issued, deposit_paid')
      .eq('tenant_id', tenantId)
      .eq('month', `${hoje().slice(0, 7)}-01`)
      .single()

    const d = data as {
      issued_total: number; paid_total: number; deposit_issued: number; deposit_paid: number
    }

    // Deltas, não absolutos: o mês tem o que outros testes deixaram.
    expect(Number(d.issued_total) - Number(a.issued_total),
      'o total emitido soma caução E aluguel').toBeCloseTo(800, 2)
    expect(Number(d.paid_total) - Number(a.paid_total),
      'o total recebido soma os dois').toBeCloseTo(800, 2)

    expect(Number(d.deposit_issued) - Number(a.deposit_issued),
      'só a caução conta como caução emitida').toBeCloseTo(500, 2)
    expect(Number(d.deposit_paid) - Number(a.deposit_paid),
      'só a caução conta como caução recebida').toBeCloseTo(500, 2)
  })

  test('os cards dizem quanto do valor é caução', async ({ page }) => {
    // Painel financeiro
    await page.goto('/financeiro')
    await waitForPageLoad(page)

    // `.last()` é o div MAIS INTERNO que contém o rótulo — o card. Sem isso o
    // filtro casa também os contêineres acima, e a asserção passaria por
    // encontrar o texto em qualquer outro lugar da página.
    const card = (rotulo: string) =>
      page.locator('div').filter({ has: page.getByText(rotulo, { exact: true }) }).last()

    await expect(card('Emitido no mês'))
      .toContainText(/inclui R\$\s[\d.,]+ de caução/, { timeout: 10_000 })
    await expect(card('Recebido no mês'))
      .toContainText(/inclui R\$\s[\d.,]+ de caução/)

    // Lista de cobranças
    await page.goto('/cobrancas')
    await waitForPageLoad(page)
    await expect(
      page.getByText(/Inclui R\$\s[\d.,]+ de caução/),
      'o card Recebido precisa declarar a parcela de caução',
    ).toBeVisible({ timeout: 10_000 })
  })

  test('o DRE segue ignorando a caução — passivo não é resultado', async ({ page }) => {
    // O par de controle: é a diferença entre os painéis e o DRE que precisava
    // de explicação, e ela só faz sentido se o DRE realmente excluir a caução.
    await page.goto('/financeiro/dre')
    await waitForPageLoad(page)
    await expect(page.getByText('Demonstrativo de resultado')).toBeVisible({ timeout: 10_000 })

    // A asserção é sobre a TABELA, não sobre a página.
    //
    // Buscar /[Cc]auç/ na página inteira passou a falhar quando o bloco "Como
    // ler este demonstrativo" ganhou a frase que explica por que a caução NÃO
    // entra no resultado. O texto certo derrubava o teste certo — o que se quer
    // provar é que nenhuma LINHA do demonstrativo é caução.
    const linhas = page.locator('table').getByRole('cell')
    await expect(linhas.filter({ hasText: /[Cc]auç/ }), 'caução não pode ter linha no DRE')
      .toHaveCount(0)
  })
})
