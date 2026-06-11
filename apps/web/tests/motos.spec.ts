import { test, expect } from '@playwright/test'
import { getModal, waitForPageLoad } from './helpers'

const PLATE = `T${Date.now().toString().slice(-4)}E2E`.slice(0, 7).toUpperCase()
const EDITED_MODEL = 'Fan 160 EDITADO'

test.describe('Motocicletas — CRUD', () => {
  test('criar via wizard, editar e excluir moto', async ({ page }) => {
    await page.goto('/motos')
    await waitForPageLoad(page)

    // ── CREATE — Passo 1 ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova moto/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })

    await modal.getByLabel('Placa do Veículo').fill(PLATE)
    await modal.getByLabel('Código RENAVAM').fill('00000000001')
    await modal.getByLabel('Marca / Fabricante').fill('HONDA')
    await modal.getByLabel('Modelo Comercial').fill('CG 160 Fan')
    await modal.getByLabel('Ano (Fab/Mod)').fill('2024/2024')
    await modal.getByLabel('Cor Predominante').fill('VERMELHO')
    await modal.getByLabel('Número do Chassi').fill(
      `9C2TEST${Date.now().toString().slice(-10)}`.slice(0, 17)
    )
    await modal.getByLabel('Quilometragem de Entrada').fill('5000')

    // Avança para o Passo 2
    await modal.getByRole('button', { name: /próximo passo/i }).click()

    // ── CREATE — Passo 2 (bootstrap de manutenções — pode deixar em branco) ──
    await expect(modal.getByRole('button', { name: /concluir cadastro/i })).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: /concluir cadastro/i }).click()

    await expect(modal).not.toBeVisible({ timeout: 15_000 })

    // Verifica a placa na tabela
    await expect(page.getByText(PLATE)).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const motoRow = page.locator('tr', { hasText: PLATE }).first()
    await motoRow.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Modelo Comercial').clear()
    await modal.getByLabel('Modelo Comercial').fill(EDITED_MODEL)

    await modal.getByRole('button', { name: /salvar alterações/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(EDITED_MODEL).first()).toBeVisible({ timeout: 10_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: PLATE }).first()
    await editedRow.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /confirmar exclusão/i }).click()

    await expect(page.locator('tr', { hasText: PLATE }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
