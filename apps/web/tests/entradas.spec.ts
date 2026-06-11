import { test, expect } from '@playwright/test'
import {
  TEST_TAG,
  createTestMotorcycle,
  deleteTestMotorcycle,
  createTestContract,
  deleteTestContract,
  cleanupTestIncomesByLessee,
  getModal,
  waitForPageLoad,
} from './helpers'

// A descrição não aparece na tabela; o locatário (nome do cliente do contrato) aparece
const LESSEE_NAME = `${TEST_TAG} Cliente Contrato E2E`
const TODAY = new Date().toISOString().split('T')[0]

let motoId = ''
let motoPlate = ''
let contractId = ''
let contractCustomerId = ''

test.describe('Entradas — CRUD', () => {
  test.beforeAll(async () => {
    const moto = await createTestMotorcycle()
    motoId = moto.id
    motoPlate = moto.license_plate
    // Cria contrato ativo para que lookupLessee encontre o locatário automaticamente
    const contract = await createTestContract(motoId)
    contractId = contract.contractId
    contractCustomerId = contract.customerId
  })

  test.afterAll(async () => {
    await deleteTestContract(contractId, contractCustomerId)
    await deleteTestMotorcycle(motoId)
    // Limpa entradas órfãs caso o teste tenha falhado antes do step DELETE
    await cleanupTestIncomesByLessee(`${TEST_TAG}%`)
  })

  test('criar, editar e excluir entrada financeira', async ({ page }) => {
    await page.goto('/entradas')
    await waitForPageLoad(page)

    // ── CREATE ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova entrada/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').fill(`Aluguel — ${motoPlate}`)
    await modal.getByLabel('Valor (R$)').fill('350')
    await modal.getByLabel('Data').fill(TODAY)
    // Seleciona a moto de teste — value = license_plate
    await modal.getByLabel('Vínculo').selectOption(motoPlate)
    // Aguarda lookupLessee completar e preencher o locatário
    await page.waitForTimeout(2_500)

    await modal.getByRole('button', { name: /salvar entrada/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // O locatário (nome do cliente do contrato) aparece na coluna "Locatário" da tabela
    await expect(page.locator('tr', { hasText: LESSEE_NAME }).first()).toBeVisible({ timeout: 10_000 })

    // ── EDIT ──────────────────────────────────────────────────────────────────
    const row = page.locator('tr', { hasText: LESSEE_NAME }).first()
    await row.getByTitle('Editar').click()

    await expect(modal).toBeVisible()

    await modal.getByLabel('Valor (R$)').fill('400')

    await modal.getByRole('button', { name: /salvar alterações/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // Locatário ainda aparece após edição
    await expect(page.locator('tr', { hasText: LESSEE_NAME }).first()).toBeVisible({ timeout: 10_000 })

    // ── DELETE ────────────────────────────────────────────────────────────────
    const editedRow = page.locator('tr', { hasText: LESSEE_NAME }).first()
    await editedRow.getByTitle('Excluir').click()

    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: LESSEE_NAME }).first()).not.toBeVisible({ timeout: 10_000 })
  })
})
