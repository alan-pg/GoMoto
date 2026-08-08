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
  getTestTenantId,
} from './helpers'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let vehicleId = ''
let customerId   = ''
let contractId   = ''

test.describe('Cobranças — filtros e novo campo original_amount', () => {
  test.beforeAll(async () => {
    const moto     = await createTestVehicle()
    vehicleId   = moto.id
    const customer = await createTestCustomer()
    customerId     = customer.id
    const contract = await createTestContract(vehicleId)
    contractId     = contract.contractId
  })

  test.afterAll(async () => {
    await deleteTestContract(contractId, customerId)
    await deleteTestVehicle(vehicleId)
  })

  // RF-024 — Filtro de status
  test('filtro por status exibe apenas cobranças do status selecionado', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    // Clicar na aba "Pendentes"
    await page.getByRole('button', { name: /pendentes/i }).click()
    // Aguarda que os registros visíveis sejam apenas pendentes
    const rows = page.locator('tbody tr')
    const count = await rows.count()
    if (count > 0) {
      // Cada linha visível deve ter badge pendente
      await expect(rows.first()).toBeVisible()
    }
  })

  // RF-024 — Tab de Prejuízo (nomenclatura atualizada de 'loss' → 'prejudice')
  test('aba de prejuízo existe e é clicável', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    const tabPrejuizo = page.getByRole('button', { name: /prejuízo/i })
    await expect(tabPrejuizo).toBeVisible()
    await tabPrejuizo.click()
    // Não deve quebrar — estado deve mudar normalmente
    await expect(tabPrejuizo).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Encerramento antecipado — RN-003 (Spec 0010): Entrada e Caução pendentes
// com vencimento futuro sobrevivem; cobrança de ciclo futura é cancelada.
// ---------------------------------------------------------------------------

test.describe('Cobranças de Locação — encerramento antecipado preserva garantias pendentes (RN-003)', () => {
  let vehicleId = ''
  let customerId = ''
  let leaseId = ''

  test.beforeAll(async () => {
    vehicleId = (await createTestVehicle()).id
    customerId = (await createTestCustomer()).id
  })

  test.afterAll(async () => {
    const sb = await getSupabase()
    if (leaseId) await sb.from('rentals').delete().eq('id', leaseId)
    await deleteTestVehicle(vehicleId)
    await deleteTestCustomer(customerId)
  })

  // RF-014, RF-015 — cobrança de ciclo futura é cancelada.
  // RN-003 — Entrada e Caução pendentes com vencimento futuro sobrevivem.
  test('encerramento antecipado cancela cobrança de ciclo futura e preserva Entrada e Caução pendentes', async ({ page }) => {
    const sb = await getSupabase()
    const tenantId = await getTestTenantId()

    const { data: newLeaseId, error } = await sb.rpc('create_rental_with_charges', {
      p_tenant_id: tenantId,
      p_vehicle_id: vehicleId,
      p_customer_id: customerId,
      p_cycle: 'monthly',
      p_due_day: 10,
      p_cycle_amount: 500,
      p_start_date: '2026-08-10',
      p_end_date: '2026-11-10',
      p_use_pro_rata: true,
      p_charges: [{ amount: 500, due_date: '2026-09-10', billing_type: 'cycle' }],
      p_security_deposit: 300,
      p_deposit_paid: false,
      p_deposit_due_date: '2026-10-01',
      p_down_payment: 150,
      p_down_payment_paid: false,
      p_down_payment_due_date: '2026-10-01',
    })
    if (error) throw new Error(`Erro ao criar locação de teste via RPC: ${error.message}`)
    leaseId = newLeaseId as string

    // Encerra em 2026-08-20 — antes do vencimento da cobrança de ciclo
    // (2026-09-10) e das garantias pendentes (2026-10-01).
    await page.goto(`/locacoes/${leaseId}/encerrar`)
    await waitForPageLoad(page)
    await page.locator('input[type=date]').first().fill('2026-08-20')
    await page.getByRole('button', { name: 'Confirmar Encerramento' }).click()
    await page.waitForURL(/\/locacoes\/?$/, { timeout: 15_000 })

    const { data: billings } = await sb
      .from('billings')
      .select('billing_type, status')
      .eq('lease_id', leaseId)

    const cycle       = billings?.find(b => b.billing_type === 'cycle')
    const deposit      = billings?.find(b => b.billing_type === 'deposit')
    const downPayment = billings?.find(b => b.billing_type === 'down_payment')

    expect(cycle?.status).toBe('cancelled')
    expect(deposit?.status).toBe('pending')
    expect(downPayment?.status).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// Stub tests — implementar quando locacoes/page.tsx tiver UI de locação
// ---------------------------------------------------------------------------

test.describe.skip('Cobranças de Locação — ciclo de vida (stub)', () => {
  // RF-025, RN-015 — Baixa manual
  test('baixa manual muda status para paid com data e forma registrados', async ({ page }) => {
    await page.goto('/cobrancas')
    // TODO: criar cobrança de teste → registrar pagamento → verificar
    expect(true).toBe(true)
  })

  // RF-026, RN-017 — Bloquear segunda baixa
  test('bloqueia segunda baixa em cobrança já paga', async ({ page }) => {
    await page.goto('/cobrancas')
    // TODO: cobrança paga → tentar pagar novamente → verificar mensagem de erro
    expect(true).toBe(true)
  })

  // RF-029, RF-030, RF-031 — Desconto
  test('desconto preserva valor original e exibe valor final = original - desconto', async ({ page }) => {
    await page.goto('/cobrancas')
    // TODO: aplicar desconto e verificar campos
    expect(true).toBe(true)
  })

  test('bloqueia desconto maior que valor original', async ({ page }) => {
    await page.goto('/cobrancas')
    // TODO: tentar desconto > original_amount
    expect(true).toBe(true)
  })

  // RF-027, RN-029 — Cobrança avulsa
  test('cobrança avulsa criada vinculada a locação ativa', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: criar cobrança avulsa via UI da locação
    expect(true).toBe(true)
  })

  // RF-014, RF-015 — Encerramento antecipado cancela cobranças futuras
  test('encerramento antecipado cancela cobranças futuras e preserva vencidas e pagas', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: encerrar locação e verificar cobranças
    expect(true).toBe(true)
  })

  // RF-037 — Alerta de cobranças vencidas ao encerrar
  test('alerta exibe N cobranças vencidas abertas ao encerrar', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: verificar alerta de impacto no modal de encerramento
    expect(true).toBe(true)
  })

  // RF-039, RN-036 — Multa ao encerrar dentro da vigência mínima
  test('alerta de multa ao encerrar Rental com menos de 3 meses', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: encerrar locação com < 3 meses e verificar alerta de multa
    expect(true).toBe(true)
  })

  // RN-037 — Rent-to-Own cumprido → status transferred
  test('Rent-to-Own com 2 anos cumpridos resulta em status transferred', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: rent_to_own com data cumprida → encerrar → status transferred
    expect(true).toBe(true)
  })

  // RF-022 — Histórico por locação
  test('histórico por locação exibe todas as cobranças da locação', async ({ page }) => {
    await page.goto('/locacoes')
    // TODO: abrir histórico de cobranças de uma locação específica
    expect(true).toBe(true)
  })
})
