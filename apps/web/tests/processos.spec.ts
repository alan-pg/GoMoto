import { test, expect } from '@playwright/test'
import { TEST_TAG, getModal, waitForPageLoad } from './helpers'

const QUESTION = `${TEST_TAG} Qual é o prazo mínimo de locação?`
const ANSWER = `${TEST_TAG} O prazo mínimo é de 7 dias corridos.`
const EDITED_QUESTION = `${TEST_TAG} Qual é o prazo mínimo de locação? — ATUALIZADO`

test.describe('Processos — CRUD', () => {
  test('criar, editar e excluir processo', async ({ page }) => {
    await page.goto('/processos')
    await waitForPageLoad(page)

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /adicionar processo/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Pergunta').fill(QUESTION)
    await modal.getByLabel('Resposta').fill(ANSWER)
    await modal.getByLabel('Categoria').selectOption('Geral')

    await modal.getByRole('button', { name: /adicionar processo/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const card = page.locator('button', { hasText: QUESTION }).first()
    await card.getByTitle('Editar processo').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Pergunta').clear()
    await modal.getByLabel('Pergunta').fill(EDITED_QUESTION)

    await modal.getByRole('button', { name: /salvar alterações/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(EDITED_QUESTION)).toBeVisible({ timeout: 10_000 })

    // ── DELETE — processos usam window.confirm() ───────────────────────────────
    page.on('dialog', (d) => d.accept())

    const editedCard = page.locator('button', { hasText: EDITED_QUESTION }).first()
    await editedCard.getByTitle('Excluir processo').click()

    await expect(page.getByText(EDITED_QUESTION)).not.toBeVisible({ timeout: 10_000 })
  })
})
