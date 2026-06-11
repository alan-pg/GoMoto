import { test, expect } from '@playwright/test'
import { TEST_TAG, createTestCustomer, deleteTestCustomer, getModal, waitForPageLoad } from './helpers'

const DESCRIPTION = `${TEST_TAG} Cobrança de aluguel — teste`
const EDITED_DESCRIPTION = `${TEST_TAG} Cobrança de aluguel — teste — EDITADO`
const TODAY = new Date().toISOString().split('T')[0]

let customerId = ''

test.describe('Cobranças — CRUD', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
  })

  test.afterAll(async () => {
    await deleteTestCustomer(customerId)
  })

  test('criar, editar, pagar e excluir cobrança', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova cobrança/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Cliente').selectOption(customerId)
    await modal.getByLabel('Descrição').fill(DESCRIPTION)
    await modal.getByLabel('Valor (R$)').fill('500')
    await modal.getByLabel('Vencimento').fill(TODAY)

    await modal.getByRole('button', { name: /criar cobrança|salvar alterações/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').clear()
    await modal.getByLabel('Descrição').fill(EDITED_DESCRIPTION)
    await modal.getByLabel('Valor (R$)').fill('600')

    await modal.getByRole('button', { name: /salvar/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(EDITED_DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── MARK AS PAID ──────────────────────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    const payBtn = editedRow.getByTitle(/pagar|marcar como pago/i)
    if (await payBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await payBtn.click()
      // Modal de pagamento requer selecionar método antes de confirmar
      if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await modal.getByLabel('Método de Pagamento').selectOption('PIX')
        await modal.getByRole('button', { name: /confirmar pagamento/i }).click()
        await expect(modal).not.toBeVisible({ timeout: 10_000 })
      }
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    // Busca em todas as abas (a cobrança pode estar em "Pagas" após marcar como pago)
    const anyRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    if (!await anyRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.getByRole('button', { name: 'Pagas' }).click()
    }

    const rowToDelete = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    await rowToDelete.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
