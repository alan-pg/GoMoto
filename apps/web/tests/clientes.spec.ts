import { test, expect } from '@playwright/test'
import { TEST_TAG, createTestCustomer, deleteTestCustomer, getModal, waitForPageLoad } from './helpers'

let customerId = ''
let customerName = ''

test.describe('Clientes — Editar e Excluir', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
    customerName = customer.name
  })

  test.afterAll(async () => {
    // Segurança: remove caso o teste tenha falhado antes de excluir via UI
    if (customerId) await deleteTestCustomer(customerId).catch(() => {})
  })

  test('editar e excluir cliente', async ({ page }) => {
    await page.goto('/clientes')
    await waitForPageLoad(page)

    // Verifica que o cliente de teste está visível (busca pelo nome único)
    const clientRow = page.locator('tr', { hasText: customerName }).first()
    await expect(clientRow).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    await clientRow.getByTitle('Editar').click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Telefone').clear()
    await modal.getByLabel('Telefone').fill('21911112222')

    await modal.getByLabel('Email').clear()
    await modal.getByLabel('Email').fill('teste.e2e@gomoto.com')

    await modal.getByRole('button', { name: /salvar/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // Cliente ainda aparece na lista
    await expect(page.locator('tr', { hasText: customerName }).first()).toBeVisible({ timeout: 10_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    const updatedRow = page.locator('tr', { hasText: customerName }).first()
    await updatedRow.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /excluir/i }).last().click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.locator('tr', { hasText: customerName }).first()).not.toBeVisible({ timeout: 10_000 })

    // Marca como já excluído para o afterAll não tentar novamente
    customerId = ''
  })
})
