import { test, expect } from '@playwright/test'
import {
  TEST_TAG,
  createTestCustomer,
  deleteTestCustomer,
  createTestMotorcycle,
  deleteTestMotorcycle,
  getModal,
  waitForPageLoad,
} from './helpers'

const DESCRIPTION = `${TEST_TAG} Excesso de velocidade — teste`
const EDITED_DESCRIPTION = `${TEST_TAG} Excesso de velocidade — teste — EDITADO`
const TODAY = new Date().toISOString().split('T')[0]
const DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

let customerId = ''
let motoId = ''

test.describe('Multas — CRUD', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
    const moto = await createTestMotorcycle()
    motoId = moto.id
  })

  test.afterAll(async () => {
    await deleteTestCustomer(customerId)
    await deleteTestMotorcycle(motoId)
  })

  test('criar, editar, pagar e excluir multa', async ({ page }) => {
    await page.goto('/multas')
    await waitForPageLoad(page)

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /registrar multa/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Cliente').selectOption(customerId)
    await modal.getByLabel('Moto').selectOption(motoId)
    await modal.getByLabel('Descrição da Infração').fill(DESCRIPTION)
    await modal.getByLabel('Data da Infração').fill(TODAY)
    await modal.getByLabel('Data de Vencimento').fill(DUE_DATE)
    await modal.getByLabel('Valor (R$)').fill('293.47')
    await modal.getByLabel('Responsável').selectOption('customer')

    await modal.getByRole('button', { name: /registrar multa/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição da Infração').clear()
    await modal.getByLabel('Descrição da Infração').fill(EDITED_DESCRIPTION)
    await modal.getByLabel('Valor (R$)').fill('195.23')

    await modal.getByRole('button', { name: /salvar alterações/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(EDITED_DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── MARK AS PAID ──────────────────────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    await editedRow.getByTitle('Registrar pagamento').click()

    await expect(modal).toBeVisible()
    const payDateInput = modal.getByLabel('Data do Pagamento')
    if (await payDateInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await payDateInput.fill(TODAY)
    }
    await modal.getByRole('button', { name: /confirmar|pagar/i }).last().click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    await page.reload()
    await waitForPageLoad(page)

    // Filtra pela moto de teste para não interferir com outras motos do banco
    await page.locator('select').first().selectOption(motoId)
    await page.waitForTimeout(500)

    // Multas pagas ficam no "histórico" colapsado — expandir
    const historyToggle = page.getByRole('button', { name: /ver histórico/i }).first()
    if (await historyToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await historyToggle.click()
    }

    const paidRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    await expect(paidRow).toBeVisible({ timeout: 5_000 })
    await paidRow.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
