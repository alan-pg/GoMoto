import { test, expect } from '@playwright/test'
import { TEST_TAG, getModal, waitForPageLoad } from './helpers'

const DESCRIPTION = `${TEST_TAG} Troca de óleo — moto teste`
const EDITED_DESCRIPTION = `${TEST_TAG} Troca de óleo — moto teste — EDITADO`
const TODAY = new Date().toISOString().split('T')[0]

/**
 * Clica no botão de salvar do modal de despesas e lida com o aviso "sem nota fiscal".
 * Na primeira tentativa sem NF, a UI exibe um alerta e troca o botão para "Cadastrar sem NF".
 * Clicamos nesse botão secundário se ele aparecer.
 */
async function salvarDespesa(modal: ReturnType<typeof getModal>) {
  // Tenta clicar no botão principal (Criar Despesa / Salvar Alterações)
  const mainBtn = modal.getByRole('button', { name: /criar despesa|salvar alterações/i })
  if (await mainBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await mainBtn.click()
  }
  // Se aparecer o aviso de "sem NF", confirma com o botão danger
  const semNfBtn = modal.getByRole('button', { name: /cadastrar sem nf/i })
  if (await semNfBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await semNfBtn.click()
  }
}

test.describe('Despesas — CRUD', () => {
  test('criar, editar e excluir despesa', async ({ page }) => {
    await page.goto('/despesas')
    await waitForPageLoad(page)

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova despesa/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').fill(DESCRIPTION)
    await modal.getByLabel('Valor (R$)').fill('150')
    await modal.getByLabel('Data').fill(TODAY)
    await modal.getByLabel('Categoria').selectOption('Manutenção')

    await salvarDespesa(modal)
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').clear()
    await modal.getByLabel('Descrição').fill(EDITED_DESCRIPTION)
    await modal.getByLabel('Valor (R$)').fill('200')

    await salvarDespesa(modal)
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(EDITED_DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    await editedRow.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
