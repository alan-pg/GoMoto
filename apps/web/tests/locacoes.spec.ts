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
  getSupabase,
} from './helpers'

// ---------------------------------------------------------------------------
// Helper de formulário — RentalForm não usa htmlFor/id, então navegamos pelo
// texto do label até o campo irmão (mesmo padrão em toda a seção "form").
// ---------------------------------------------------------------------------

function fieldAfterLabel(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]')
}

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
// Entrada (Spec 0010) — RF-001..RF-005, RN-002
// ---------------------------------------------------------------------------

test.describe('Locações — Entrada na criação (Spec 0010)', () => {
  let vehiclePaidId = ''
  let vehiclePendingId = ''
  let customerId = ''
  let leasePaidId = ''
  let leasePendingId = ''

  test.beforeAll(async () => {
    vehiclePaidId = (await createTestVehicle()).id
    vehiclePendingId = (await createTestVehicle()).id
    customerId = (await createTestCustomer()).id
  })

  test.afterAll(async () => {
    const sb = await getSupabase()
    if (leasePaidId) await sb.from('rentals').delete().eq('id', leasePaidId)
    if (leasePendingId) await sb.from('rentals').delete().eq('id', leasePendingId)
    await deleteTestVehicle(vehiclePaidId)
    await deleteTestVehicle(vehiclePendingId)
    await deleteTestCustomer(customerId)
  })

  // RF-001, RF-002, RF-003, RF-004 — Entrada já paga nasce recebida, sem
  // cobrança em aberto, e soma na receita do veículo (source != 'deposit').
  test('Entrada já paga na criação: nasce recebida e soma na receita do veículo', async ({ page }) => {
    await page.goto('/locacoes/nova')
    await waitForPageLoad(page)

    await fieldAfterLabel(page, 'Cliente *').selectOption(customerId)
    await fieldAfterLabel(page, 'Veículo *').selectOption(vehiclePaidId)
    await fieldAfterLabel(page, 'Valor do ciclo (R$) *').fill('500')
    await fieldAfterLabel(page, 'Data de início *').fill('2026-08-10')
    await fieldAfterLabel(page, 'Entrada (R$)').fill('150')
    // "Entrada já foi paga" fica marcada por padrão — não precisa tocar.

    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByText('Resumo do contrato')).toBeVisible()
    await expect(page.locator('tr', { hasText: 'Entrada' })).toBeVisible()

    await page.getByRole('button', { name: /Confirmar/ }).click()
    await page.waitForURL(/\/locacoes\/[0-9a-f-]{36}$/, { timeout: 15_000 })
    leasePaidId = page.url().split('/').pop()!

    const sb = await getSupabase()
    const { data: billing } = await sb
      .from('billings')
      .select('status, original_amount, source, billing_type')
      .eq('lease_id', leasePaidId)
      .eq('billing_type', 'down_payment')
      .single()
    expect(billing?.status).toBe('paid')
    expect(billing?.original_amount).toBe(150)
    expect(billing?.source).toBe('down_payment')

    await page.goto(`/financeiro/veiculos/${vehiclePaidId}`)
    await waitForPageLoad(page)
    await expect(page.locator('main')).toContainText('R$ 150,00')
    await expect(page.locator('main')).toContainText('Entrada')
  })

  // RF-001, RF-002, RF-003, RF-005 — Entrada pendente gera cobrança em
  // aberto, visível no preview e no extrato financeiro da locação.
  test('Entrada pendente na criação: gera cobrança em aberto e aparece no preview e no extrato', async ({ page }) => {
    await page.goto('/locacoes/nova')
    await waitForPageLoad(page)

    await fieldAfterLabel(page, 'Cliente *').selectOption(customerId)
    await fieldAfterLabel(page, 'Veículo *').selectOption(vehiclePendingId)
    await fieldAfterLabel(page, 'Valor do ciclo (R$) *').fill('500')
    await fieldAfterLabel(page, 'Data de início *').fill('2026-08-10')
    await fieldAfterLabel(page, 'Entrada (R$)').fill('150')
    await page.getByLabel('Entrada já foi paga').uncheck()

    await page.getByRole('button', { name: 'Preview' }).click()
    const previewRow = page.locator('tr', { hasText: 'Entrada' })
    await expect(previewRow).toBeVisible()
    await expect(previewRow).toContainText('R$ 150,00')

    await page.getByRole('button', { name: /Confirmar/ }).click()
    await page.waitForURL(/\/locacoes\/[0-9a-f-]{36}$/, { timeout: 15_000 })
    leasePendingId = page.url().split('/').pop()!

    const sb = await getSupabase()
    const { data: billing } = await sb
      .from('billings')
      .select('status, original_amount, source, billing_type')
      .eq('lease_id', leasePendingId)
      .eq('billing_type', 'down_payment')
      .single()
    expect(billing?.status).toBe('pending')
    expect(billing?.original_amount).toBe(150)

    await page.goto(`/locacoes/${leasePendingId}/financeiro`)
    await waitForPageLoad(page)
    const extratoRow = page.locator('tr', { hasText: 'Entrada' })
    await expect(extratoRow).toBeVisible()
    await expect(extratoRow).toContainText('R$ 150,00')
    await expect(extratoRow).toContainText('Pendente')
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
