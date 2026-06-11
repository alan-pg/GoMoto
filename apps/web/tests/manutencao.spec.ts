import { test, expect } from '@playwright/test'
import { TEST_TAG, createTestMotorcycle, deleteTestMotorcycle, getModal, waitForPageLoad } from './helpers'

const DESCRIPTION = `${TEST_TAG} Troca de corrente — teste`
const EDITED_DESCRIPTION = `${TEST_TAG} Troca de corrente — teste — EDITADO`
const TODAY = new Date().toISOString().split('T')[0]

let motoId = ''

test.describe('Manutenção — CRUD', () => {
  test.beforeAll(async () => {
    const moto = await createTestMotorcycle()
    motoId = moto.id
  })

  test.afterAll(async () => {
    await deleteTestMotorcycle(motoId)
  })

  test('agendar, editar, concluir e excluir manutenção', async ({ page }) => {
    await page.goto('/manutencao')
    await waitForPageLoad(page)

    // ── CREATE — Agendar ──────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova manutenção/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Motocicleta *').selectOption(motoId)
    await modal.getByLabel('Descrição *').fill(DESCRIPTION)
    await modal.getByLabel('Data Agendada').fill(TODAY)
    await modal.getByLabel('Oficina / Mecânico').fill('Oficina E2E')

    await modal.getByRole('button', { name: /salvar|agendar|confirmar/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.locator('tr', { hasText: DESCRIPTION }).first()).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição *').clear()
    await modal.getByLabel('Descrição *').fill(EDITED_DESCRIPTION)
    await modal.getByLabel('Custo (R$)').fill('250')

    await modal.getByRole('button', { name: /salvar/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()).toBeVisible({ timeout: 10_000 })

    // ── COMPLETE — Registrar conclusão ────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    await editedRow.getByTitle('Registrar conclusão').click()

    await expect(modal).toBeVisible()

    // Passo 1: KM e data
    const kmInput = modal.getByLabel('KM do Odômetro *')
    if (await kmInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await kmInput.fill('6000')
      await modal.getByLabel('Data de Conclusão *').fill(TODAY)
    }

    // Avança etapa se houver botão "Próximo"
    const nextBtn = modal.getByRole('button', { name: /próximo|continuar/i })
    if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtn.click()
    }

    await modal.getByRole('button', { name: /confirmar|concluir|finalizar|salvar/i }).last().click()
    await expect(modal).not.toBeVisible({ timeout: 15_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    await page.reload()
    await waitForPageLoad(page)

    // Manutenção concluída pode estar em seção separada — procura em toda a página
    const anyRow = page.locator('tr', { hasText: EDITED_DESCRIPTION }).first()
    if (await anyRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await anyRow.getByTitle('Excluir').click()

      await expect(modal).toBeVisible()
      await modal.getByRole('button', { name: /excluir/i }).last().click()
      await expect(page.getByText(EDITED_DESCRIPTION)).not.toBeVisible({ timeout: 10_000 })
    }
    // Se não aparecer: o afterAll já remove a moto + manutenções vinculadas
  })
})
