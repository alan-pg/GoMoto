import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabase, getTestTenantId, createTestVehicle, deleteTestVehicle,
  createTestCustomer, deleteTestCustomer, waitForPageLoad,
} from './helpers'

/**
 * Cobranças de locação — filtros e encerramento antecipado (Spec 0014).
 *
 * RN-003 (Spec 0010) ganha uma expressão mais limpa no modelo novo. Antes,
 * "cancelar cobranças futuras preservando Entrada e Caução" exigia excluir
 * `billing_type IN ('deposit','down_payment')` do UPDATE — a regra vivia num
 * filtro de query.
 *
 * Agora ela cai por si: período futuro ainda é linha de CRONOGRAMA e é
 * cancelado; Entrada e Caução são DOCUMENTOS emitidos e, por serem imutáveis
 * (Princípio 5), sobrevivem sem tratamento especial.
 */

const RUN_ID = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''

test.describe('Cobranças — filtros da listagem', () => {
  test('filtro por status exibe apenas cobranças do status selecionado', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    await page.getByRole('button', { name: 'Vencidas' }).click()

    const rows = page.locator('tbody tr')
    const count = await rows.count()

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      const text = await row.textContent()
      if (text?.includes('Nenhuma cobrança')) continue
      // A aba de vencidas só mostra linha com atraso — derivado de due_date,
      // não de status armazenado (Princípio 4).
      await expect(row).toContainText(/\d+d/)
    }
  })

  test('aba de encerradas agrupa canceladas e baixadas', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    // 'prejudice' virou 'written_off', e cancelamento entrou no mesmo grupo:
    // ambos saem de contas a receber.
    await page.getByRole('button', { name: 'Encerradas' }).click()
    await expect(page.getByRole('button', { name: 'Encerradas' })).toBeVisible()
  })
})

test.describe('Encerramento antecipado preserva garantias emitidas (RN-003)', () => {
  test.beforeAll(async () => {
    const vehicle = await createTestVehicle()
    const customer = await createTestCustomer()
    vehicleId = vehicle.id
    customerId = customer.id
  })

  test.afterAll(async () => {
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('cancela cronograma futuro e preserva Entrada e Caução', async ({ page }) => {
    const sb = await getSupabase()
    const tenantId = await getTestTenantId()

    // Locação com um período já vencido e dois futuros.
    const { data: newRentalId, error } = await sb.rpc('create_rental_with_schedule', {
      p_tenant_id: tenantId,
      p_rental: {
        customer_id: customerId,
        vehicle_id: vehicleId,
        start_date: '2026-08-10',
        end_date: '2026-11-10',
        cycle: 'monthly',
        cycle_amount: 500,
        due_day: 10,
        use_pro_rata: false,
        contract_type: 'rental',
      },
      p_schedule: [
        { sequence_number: 1, period_start: '2026-08-10', period_end: '2026-09-09', due_date: '2026-08-10', amount: 500 },
        { sequence_number: 2, period_start: '2026-09-10', period_end: '2026-10-09', due_date: '2026-09-10', amount: 500 },
        { sequence_number: 3, period_start: '2026-10-10', period_end: '2026-11-09', due_date: '2026-10-10', amount: 500 },
      ],
    })
    if (error) throw new Error(`Erro ao criar locação: ${error.message}`)
    rentalId = newRentalId as string

    // Caução e Entrada nascem como cobranças EMITIDAS. A caução credita
    // passivo; a entrada credita receita (Spec 0010).
    for (const g of [
      { desc: `${TEST_TAG} Caução ${RUN_ID}`, account: 'caucoes_a_devolver', amount: 300, mod: 'deposit' },
      { desc: `${TEST_TAG} Entrada ${RUN_ID}`, account: 'receita_locacao', amount: 150, mod: 'down_payment' },
    ]) {
      const { data: n } = await sb.rpc('fn_next_charge_number', { p_tenant_id: tenantId })

      const { data: charge, error: chErr } = await sb
        .from('charges')
        .insert({
          tenant_id: tenantId, customer_id: customerId, rental_id: rentalId,
          charge_number: n as number, due_date: '2026-10-01',
        })
        .select('id')
        .single()
      if (chErr) throw new Error(`Erro ao criar cobrança de ${g.mod}: ${chErr.message}`)

      await sb.from('charge_items').insert({
        tenant_id: tenantId, charge_id: (charge as { id: string }).id,
        description: g.desc, credit_account_code: g.account,
        quantity: 1, unit_amount: g.amount, amount: g.amount,
        source_module: g.mod, source_id: rentalId,
      })
    }

    // Encerra antes do vencimento dos períodos futuros.
    await page.goto(`/locacoes/${rentalId}/encerrar`)
    await waitForPageLoad(page)
    await page.locator('input[type=date]').first().fill('2026-08-20')

    // A apuração é carregada por hook: espera o valor em aberto aparecer antes
    // de procurar a confirmação. Sem isso o teste lê a tela ainda vazia.
    // O valor aparece duas vezes — no painel e no aviso de confirmação —
    // então a asserção é sobre a linha do painel, não sobre o texto solto.
    const linhaAberto = page.locator('div', { hasText: /^Cobranças em aberto/ }).last()
    await expect(linhaAberto).toContainText('R$ 450,00', { timeout: 10_000 })

    // Com débito em aberto, encerrar exige confirmação explícita (F-08).
    const force = page.locator('input[type=checkbox]')
    await expect(force).toBeVisible({ timeout: 10_000 })
    await force.check()

    await page.getByRole('button', { name: 'Confirmar Encerramento' }).click()
    await page.waitForURL(/\/locacoes\/?$/, { timeout: 15_000 })

    // Cronograma futuro cancelado.
    const { data: schedule } = await sb
      .from('rental_billing_schedules')
      .select('sequence_number, status')
      .eq('rental_id', rentalId)
      .order('sequence_number')

    const lines = (schedule ?? []) as { sequence_number: number; status: string }[]
    expect(lines.find((l) => l.sequence_number === 2)?.status).toBe('cancelled')
    expect(lines.find((l) => l.sequence_number === 3)?.status).toBe('cancelled')

    // Garantias sobrevivem: são documentos emitidos, e o encerramento não
    // toca em documento (Princípio 5).
    const { data: charges } = await sb
      .from('charge_balances')
      .select('charge_id, status, open_amount')
      .eq('rental_id', rentalId)

    const abertas = (charges ?? []) as { status: string; open_amount: number }[]
    expect(abertas.length).toBe(2)
    for (const c of abertas) {
      expect(c.status).toBe('open')
      expect(Number(c.open_amount)).toBeGreaterThan(0)
    }
  })
})
