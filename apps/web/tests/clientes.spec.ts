/**
 * Clientes — editar e excluir.
 *
 * A spec esperava a edição num modal; ela virou rota (`/clientes/[id]/editar`).
 * Falhava no primeiro clique desde então, sem nunca chegar ao banco — foi por
 * isso que o cadastro de cliente pôde ficar quebrado por três dias sem nenhum
 * teste acusar (ver `cadastro-colunas-removidas.spec.ts`).
 *
 * As asserções agora conferem o BANCO, não só a tela: "sumiu da lista" pode
 * significar filtro, paginação ou revalidação — e nenhuma dessas é exclusão.
 */

import { test, expect } from '@playwright/test'
import {
  createTestCustomer, deleteTestCustomer, waitForPageLoad, getSupabaseAdmin,
} from './helpers'

const admin = () => getSupabaseAdmin()

let customerId = ''
let customerName = ''

test.describe('Clientes — Editar e Excluir', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
    customerName = customer.name
  })

  test.afterAll(async () => {
    if (customerId) await deleteTestCustomer(customerId).catch(() => {})
  })

  test('editar e excluir cliente', async ({ page }) => {
    await page.goto('/clientes')
    await waitForPageLoad(page)

    const linha = page.locator('tr', { hasText: customerName }).first()
    await expect(linha).toBeVisible({ timeout: 10_000 })

    // ── EDITAR ───────────────────────────────────────────────────────────────
    await linha.getByTitle('Editar').click()
    await page.waitForURL(`**/clientes/${customerId}/editar`, { timeout: 15_000 })
    await waitForPageLoad(page)

    await page.getByPlaceholder('email@exemplo.com').fill('teste.e2e@gomoto.com')
    await page.getByRole('button', { name: /^salvar$/i }).click()
    // Regex frouxa (/\/clientes/) casaria com a própria URL de edição e o teste
    // seguiria antes do save terminar.
    await page.waitForURL(/\/clientes(\/[0-9a-f-]+)?$/, { timeout: 15_000 })

    const { data: editado } = await admin()
      .from('customers').select('email').eq('id', customerId).single()
    expect((editado as { email: string }).email, 'edição não persistiu').toBe('teste.e2e@gomoto.com')

    // ── EXCLUIR ──────────────────────────────────────────────────────────────
    await page.goto('/clientes')
    await waitForPageLoad(page)

    const atualizada = page.locator('tr', { hasText: customerName }).first()
    await expect(atualizada).toBeVisible({ timeout: 10_000 })
    await atualizada.getByTitle('Excluir').click()

    // "Excluir" também é o title do ícone de cada linha: buscar dentro do modal.
    const modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await modal.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: customerName })).toHaveCount(0, { timeout: 15_000 })

    const { data: apagado } = await admin()
      .from('customers').select('id').eq('id', customerId).maybeSingle()
    expect(apagado, 'cliente sumiu da lista mas continuou no banco').toBeNull()

    customerId = ''
  })
})
