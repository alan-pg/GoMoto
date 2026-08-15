/**
 * Cancelamento e rateio — o que acontece com o razão quando se desfaz.
 *
 * Emitir tem cobertura farta. **Desfazer** não tinha, e é onde o dinheiro
 * escorre sem ninguém ver: um documento cancelado que continua lançado inflar
 * custo no DRE e mantém passivo que não existe mais.
 *
 * A simetria que se testa aqui é simples de enunciar e fácil de quebrar:
 * cancelar tem de estornar exatamente o que a criação lançou. Nem mais (senão
 * vira crédito do nada), nem menos (senão o custo fica).
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestCustomer, deleteTestCustomer,
} from './helpers'
import { createPayable } from '../src/lib/financial/payables'

const admin = () => getSupabaseAdmin()

let vehicleId = ''
let customerId = ''
const hoje = new Date().toISOString().slice(0, 10)

/** Soma líquida de uma conta no razão — o que o DRE enxerga. */
async function saldoConta(code: string): Promise<number> {
  const { data } = await admin()
    .from('financial_entries')
    .select('amount_signed')
    .eq('account_code', code)
  return Number(
    (data ?? [])
      .reduce((s, e) => s + Number((e as { amount_signed: number }).amount_signed), 0)
      .toFixed(2),
  )
}

test.beforeAll(async () => {
  const v = await createTestVehicle()
  vehicleId = v.id
  const c = await createTestCustomer()
  customerId = c.id
})

test.afterAll(async () => {
  if (customerId) await deleteTestCustomer(customerId).catch(() => {})
  if (vehicleId) await deleteTestVehicle(vehicleId).catch(() => {})
})

test.describe('Cancelar despesa', () => {
  test('cancelar estorna o custo em vez de deixá-lo no resultado', async ({ page }) => {
    const despesaAntes = await saldoConta('despesa_operacional')
    const pagarAntes   = await saldoConta('contas_a_pagar')

    const { payableId } = await createPayable(admin(), await getTestTenantId(), {
      description: `${TEST_TAG} Despesa a cancelar`,
      expenseAccountCode: 'despesa_operacional',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 400,
      responsibility: 'company',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    expect(await saldoConta('despesa_operacional') - despesaAntes, 'a despesa não foi lançada').toBe(400)

    await page.goto('/despesas')
    await page.waitForLoadState('networkidle')

    const linha = page.locator('tr', { hasText: 'Despesa a cancelar' }).first()
    await expect(linha).toBeVisible({ timeout: 15_000 })
    // Cancelar é imediato: não há confirmação nesta tela.
    await linha.getByTitle(/cancelar/i).click()

    await expect.poll(async () => {
      const { data } = await admin().from('payables').select('status').eq('id', payableId).single()
      return (data as { status: string } | null)?.status
    }, { timeout: 15_000 }).toBe('cancelled')

    // O documento foi cancelado; o razão precisa acompanhar. Sem o estorno, o
    // custo continua no DRE e `contas_a_pagar` mostra dívida inexistente.
    expect(
      await saldoConta('despesa_operacional') - despesaAntes,
      'despesa cancelada continuou lançada — o custo fica no DRE para sempre',
    ).toBe(0)

    expect(
      await saldoConta('contas_a_pagar') - pagarAntes,
      'passivo de despesa cancelada não foi baixado',
    ).toBe(0)
  })

  test('cancelar despesa rateada também cancela a cobrança do cliente', async ({ page }) => {
    const { payableId, chargeId } = await createPayable(admin(), await getTestTenantId(), {
      description: `${TEST_TAG} Rateada a cancelar`,
      expenseAccountCode: 'despesa_operacional',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'shared',
      customerId,
      customerAmount: 100,
      reimbursement: 'charge',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    expect(chargeId, 'rateio não gerou cobrança do cliente').toBeTruthy()

    await page.goto('/despesas')
    await page.waitForLoadState('networkidle')

    const linha = page.locator('tr', { hasText: 'Rateada a cancelar' }).first()
    await expect(linha).toBeVisible({ timeout: 15_000 })
    // Cancelar é imediato: não há confirmação nesta tela.
    await linha.getByTitle(/cancelar/i).click()

    await expect.poll(async () => {
      const { data } = await admin().from('payables').select('status').eq('id', payableId).single()
      return (data as { status: string } | null)?.status
    }, { timeout: 15_000 }).toBe('cancelled')

    // A cobrança do repasse nasceu DA despesa. Cancelada a despesa, cobrar o
    // cliente por ela é cobrar por um custo que a empresa diz não ter tido.
    const { data: charge } = await admin()
      .from('charges').select('status').eq('id', chargeId!).single()

    expect(
      (charge as { status: string }).status,
      'despesa cancelada deixou a cobrança do cliente viva',
    ).toBe('cancelled')
  })
})
