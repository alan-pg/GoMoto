import { test, expect } from '@playwright/test'
import {
  TEST_TAG,
  createTestVehicle,
  deleteTestVehicle,
  createTestCustomer,
  deleteTestCustomer,
  createTestContract,
  deleteTestContract,
  waitForPageLoad,
} from './helpers'

// ---------------------------------------------------------------------------
// Helpers de setup
// ---------------------------------------------------------------------------

let vehicleId = ''
let customerId   = ''
let contractId   = ''

test.describe('Locações — tela e fila de espera', () => {
  test.beforeAll(async () => {
    const moto = await createTestVehicle()
    vehicleId = moto.id
    const customer = await createTestCustomer()
    customerId = customer.id
    const contract = await createTestContract(vehicleId)
    contractId = contract.contractId
  })

  test.afterAll(async () => {
    await deleteTestContract(contractId, customerId)
    await deleteTestVehicle(vehicleId)
  })

  // ── RF-013 — Listar locações ──────────────────────────────────────────────
  test('exibe página de locações acessível via sidebar', async ({ page }) => {
    await page.goto('/locacoes')
    await waitForPageLoad(page)
    await expect(page).toHaveURL(/\/locacoes/)
    // Página placeholder ou real deve ser visível
    await expect(page.locator('h1, [data-testid="locacoes-header"]').first()).toBeVisible()
  })

  test('sidebar aponta para /locacoes (não /fila)', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForPageLoad(page)
    await expect(page.getByRole('link', { name: /locações/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /fila de locadores/i })).not.toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Stub tests (implementar quando locacoes/page.tsx tiver UI completa)
// ---------------------------------------------------------------------------

test.describe.skip('Locações — criar e gerenciar (stub)', () => {
  // RF-003, RF-004, RF-005, RF-006, RF-007
  test('operador cria locação mensal e N cobranças são geradas automaticamente', async ({ page }) => {
    await page.goto('/locacoes')
    await waitForPageLoad(page)
    // TODO: implementar quando o formulário de criação estiver disponível
    expect(true).toBe(true)
  })

  // RF-036 — Preview obrigatório
  test('preview de cobranças exibido antes da confirmação', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: formulário → preview → confirmar
    expect(true).toBe(true)
  })

  // RF-006 — Veículo já com locação ativa
  test('criação falha com mensagem quando veículo já tem locação ativa', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: tentar criar locação para moto já ativa
    expect(true).toBe(true)
  })

  // RF-014, RF-015, RF-016 — Encerramento antecipado
  test('encerrar locação cancela cobranças futuras e preserva vencidas', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: encerrar e verificar cobranças
    expect(true).toBe(true)
  })

  // RF-017, RF-018, RF-019, RF-020 — Renovação
  test('renovar locação estende data de fim e gera novas cobranças', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: renovar e verificar
    expect(true).toBe(true)
  })

  // RF-010, RF-011, RF-012 — Fila de espera
  test('adicionar cliente à fila e criar locação a partir dela', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: fila de espera UI
    expect(true).toBe(true)
  })

  // RF-038 — Rent-to-Own
  test('criar locação Rent-to-Own sugere data de fim 2 anos à frente', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: formulário com tipo rent_to_own
    expect(true).toBe(true)
  })
})
