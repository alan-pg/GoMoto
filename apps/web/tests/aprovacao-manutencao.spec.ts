/**
 * Aprovação de manutenção enviada pelo app.
 *
 * Aprovar marcava o registro como `approved` e mais nada. O custo que o cliente
 * informou — e desembolsou, quando foi ele quem levou a moto à oficina — não
 * virava despesa, não virava crédito, e não aparecia no resultado do veículo.
 * Sumia.
 *
 * A origem está no comentário que sobrou no `handleApprove`: quando a ADR 0024
 * tirou `cost` de `maintenances`, o payload parou de enviá-lo para o UPDATE
 * deixar de falhar — e nada passou a criar a conta a pagar no lugar.
 *
 * É o TERCEIRO ponto de entrada com o mesmo defeito. `manutencao.spec.ts` já
 * documenta os dois primeiros: "havia dois caminhos para registrar manutenção
 * concluída, e só um lançava... quem lançava direto digitava o custo e ele
 * morria na tela".
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
  waitForPageLoad,
} from './helpers'

const admin = () => getSupabaseAdmin()

let vehicleId = ''
let customerId = ''
let rentalId = ''

async function criarRegistroPendente(custo: number): Promise<string> {
  const tenantId = await getTestTenantId()
  const { data, error } = await admin()
    .from('maintenance_records')
    .insert({
      tenant_id: tenantId, customer_id: customerId, vehicle_id: vehicleId,
      actual_km: 21500, cost: custo, workshop: 'Oficina E2E',
      notes: `${TEST_TAG} Enviado pelo app`, status: 'pending',
    })
    .select('id')
    .single()

  if (error) throw new Error(`setup: ${error.message}`)
  return (data as { id: string }).id
}

test.describe('Aprovação de manutenção do app', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    await admin().from('maintenance_records').delete().eq('vehicle_id', vehicleId)
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('aprovar com o CLIENTE executando lança o custo e credita quem pagou', async ({ page }) => {
    const recordId = await criarRegistroPendente(480)

    await page.goto('/aprovacoes')
    await waitForPageLoad(page)

    await expect(page.getByText(`${TEST_TAG} Enviado pelo app`)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^aprovar$/i }).first().click()

    const modal = page.locator('div.fixed.inset-0').filter({ has: page.locator(':visible') }).last()
    await expect(modal).toBeVisible()
    await modal.locator('select').selectOption('customer')
    await modal.getByRole('button', { name: /confirmar aprovação/i }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    const { data: registro } = await admin()
      .from('maintenance_records').select('status').eq('id', recordId).single()
    expect((registro as { status: string }).status).toBe('approved')

    // O custo precisa EXISTIR. Antes o registro virava `approved` e o dinheiro
    // sumia — nenhuma asserção acima teria notado.
    const { data: payable } = await admin()
      .from('payables')
      .select('amount, status, responsibility, reimbursement, vendor_name')
      .eq('source_module', 'maintenance_record')
      .eq('source_id', recordId)
      .maybeSingle()

    const p = payable as {
      amount: number; status: string; responsibility: string
      reimbursement: string; vendor_name: string | null
    } | null

    expect(p, 'aprovar não lançou o custo informado pelo cliente').not.toBeNull()
    expect(Number(p!.amount)).toBe(480)
    // Cliente levou à oficina e pagou: a empresa nunca deveu ao fornecedor.
    expect(p!.status, 'a empresa não deve à oficina que o cliente já pagou').toBe('paid')
    expect(p!.reimbursement).toBe('credit')
    expect(p!.vendor_name).toBe('Oficina E2E')

    // E quem pagou precisa ser ressarcido.
    const { data: saldo } = await admin()
      .from('customer_credit_balances').select('balance').eq('customer_id', customerId).maybeSingle()
    expect(
      Number((saldo as { balance: number } | null)?.balance ?? 0),
      'cliente pagou a oficina e não recebeu crédito',
    ).toBe(480)

    // Razão sem contas a pagar, e com a dimensão do veículo.
    const { data: pernas } = await admin()
      .from('financial_entries')
      .select('account_code, amount_signed, vehicle_id')
      .eq('customer_id', customerId)

    const legs = (pernas ?? []) as { account_code: string; amount_signed: number; vehicle_id: string | null }[]
    const porConta = Object.fromEntries(legs.map(l => [l.account_code, Number(l.amount_signed)]))

    expect(porConta['despesa_manutencao']).toBe(480)
    expect(porConta['creditos_de_clientes']).toBe(-480)
    expect(porConta['contas_a_pagar'], 'passivo com oficina já paga pelo cliente').toBeUndefined()
    expect(
      legs.every(l => l.vehicle_id !== null),
      'lançamento sem veículo some do resultado da moto',
    ).toBe(true)
  })

  test('aprovar de novo não duplica a despesa nem o crédito', async ({ page }) => {
    // O operador reabre a tela e clica outra vez; ou a action é reexecutada
    // após uma falha parcial. Nenhum dos dois pode cobrar o custo em dobro.
    const { data: antes } = await admin()
      .from('payables').select('id').eq('source_module', 'maintenance_record')

    const antesCount = ((antes ?? []) as unknown[]).length

    const recordId = await criarRegistroPendente(0)
    await admin().from('maintenance_records')
      .update({ status: 'pending' }).eq('id', recordId)

    await page.goto('/aprovacoes')
    await waitForPageLoad(page)
    await page.getByRole('button', { name: /^aprovar$/i }).first().click()

    const modal = page.locator('div.fixed.inset-0').filter({ has: page.locator(':visible') }).last()
    await modal.getByRole('button', { name: /confirmar aprovação/i }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // Custo zero é legítimo — garantia, ou nota ainda não recebida — e não
    // pode inventar despesa de R$ 0,00.
    const { data: depois } = await admin()
      .from('payables').select('id').eq('source_module', 'maintenance_record')

    expect(
      ((depois ?? []) as unknown[]).length,
      'registro sem custo gerou conta a pagar',
    ).toBe(antesCount)
  })
})
