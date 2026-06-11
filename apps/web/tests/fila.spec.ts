import { test, expect } from '@playwright/test'
import { TEST_TAG, cleanupTestCustomersByName, getModal, waitForPageLoad } from './helpers'

const ts = Date.now().toString().slice(-9)
const CANDIDATE_NAME = `${TEST_TAG} João da Silva ${ts}`
const CPF = `${ts.slice(0,3)}.${ts.slice(3,6)}.${ts.slice(6,9)}-44`
const PHONE = '21988887777'

test.describe('Fila de Espera — CRUD', () => {
  test.afterAll(async () => {
    // A página só seta in_queue=false ao remover — não deleta o customer.
    // Este afterAll garante que qualquer candidato [E2E] seja removido do banco.
    await cleanupTestCustomersByName(`${TEST_TAG} João da Silva%`)
  })

  test('adicionar, editar e remover candidato da fila', async ({ page }) => {
    await page.goto('/fila')
    await waitForPageLoad(page)

    // ── CREATE — Adicionar candidato ──────────────────────────────────────────
    await page.getByRole('button', { name: /adicionar à fila/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Nome *').fill(CANDIDATE_NAME)
    await modal.getByLabel('CPF *').fill(CPF)
    await modal.getByLabel('Telefone *').fill(PHONE)

    // Campo CNH (opcional)
    const cnhField = modal.getByLabel('Número da CNH')
    if (await cnhField.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await cnhField.fill('12345678900')
    }

    await modal.getByRole('button', { name: /adicionar à fila/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // Nome aparece na tabela da fila (pode também aparecer no card "Próximo" — usar locator de tr)
    await expect(page.locator('tr', { hasText: CANDIDATE_NAME }).first()).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const candidateRow = page.locator('tr', { hasText: CANDIDATE_NAME }).first()
    await candidateRow.getByTitle(/editar/i).click()

    await expect(modal).toBeVisible()

    // Edita algum campo disponível no modal de edição
    const obsField = modal.getByLabel('Observações')
    if (await obsField.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await obsField.clear()
      await obsField.fill(`${TEST_TAG} Observações atualizadas.`)
    } else {
      // Tenta editar telefone
      const phoneField = modal.getByLabel('Telefone')
      if (await phoneField.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await phoneField.clear()
        await phoneField.fill('21911112222')
      }
    }

    await modal.getByRole('button', { name: /salvar|confirmar/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // Candidato ainda aparece na fila
    await expect(page.locator('tr', { hasText: CANDIDATE_NAME }).first()).toBeVisible({ timeout: 10_000 })

    // ── DELETE — Remover da fila ──────────────────────────────────────────────
    const updatedRow = page.locator('tr', { hasText: CANDIDATE_NAME }).first()
    await updatedRow.getByTitle(/remover|excluir/i).click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Remover' }).click()

    await expect(page.locator('tr', { hasText: CANDIDATE_NAME }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
