/**
 * Regressão: cadastros que gravavam colunas removidas pela ADR 0024.
 *
 * A limpeza do financeiro derrubou `customers.payment_status` e
 * `vehicle_obligations.amount/status/paid_at`. Typecheck, lint e unit test não
 * enxergam o banco — nome de coluna é string livre até o PostgREST responder.
 * Os dois formulários continuaram enviando as colunas e quebraram em silêncio:
 *
 *   - Criar/editar cliente falhava com "Could not find the 'payment_status'
 *     column", e a mensagem só aparecia dentro do form.
 *   - Criar veículo empurrava o erro das obrigações para um `warnings.push`:
 *     o veículo salvava e o IPVA sumia sem ninguém notar.
 *
 * Estes testes existem para que a próxima remoção de coluna quebre aqui.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG,
  waitForPageLoad,
  getSupabaseAdmin,
  getTestTenantId,
  createTestVehicle,
  deleteTestVehicle,
} from './helpers'

const admin = () => getSupabaseAdmin()
const uniq = (t: string) => `${TEST_TAG} ${t} ${Date.now() % 1000000}`

test.describe('Cadastros após a remoção de colunas de estado', () => {
  test('criar cliente grava sem payment_status', async ({ page }) => {
    const nome = uniq('cliente')

    await page.goto('/clientes/novo')
    await waitForPageLoad(page)
    await page.getByPlaceholder('Nome completo do cliente').fill(nome)
    await page.getByRole('button', { name: /^salvar$/i }).click()

    // Sem o fix, a navegação nunca acontece: o form fica na página exibindo
    // "Erro ao criar cliente: Could not find the 'payment_status' column".
    await page.waitForURL('/clientes', { timeout: 15_000 })

    const { data } = await admin().from('customers').select('id').eq('name', nome).maybeSingle()
    expect(data, 'cliente não foi criado').not.toBeNull()

    await admin().from('customers').delete().eq('id', (data as { id: string }).id)
  })

  test('obrigação do veículo vira conta a pagar em vez de sumir', async ({ page }) => {
    const tenantId = await getTestTenantId()
    const vehicle = await createTestVehicle()

    await page.goto(`/veiculos/${vehicle.id}/editar`)
    await waitForPageLoad(page)

    // O valor do IPVA não mora mais na obrigação: ele tem de virar payable,
    // que é o que o fluxo de caixa e o DRE enxergam.
    const linhaIpva = page.locator('div.grid').filter({ has: page.getByText('IPVA', { exact: true }) })
    await linhaIpva.getByPlaceholder('0,00').fill('1.200,00')
    await page.getByRole('button', { name: /^salvar$/i }).click()
    await page.waitForURL(`/veiculos/${vehicle.id}`, { timeout: 15_000 })

    const { data: obligation } = await admin()
      .from('vehicle_obligations')
      .select('id, payable_id, type, reference_year')
      .eq('vehicle_id', vehicle.id)
      .eq('type', 'ipva')
      .maybeSingle()

    expect(obligation, 'obrigação não foi salva').not.toBeNull()
    const o = obligation as { id: string; payable_id: string | null }
    expect(o.payable_id, 'obrigação salva sem conta a pagar — o valor foi descartado').not.toBeNull()

    const { data: payable } = await admin()
      .from('payables')
      .select('amount, expense_account_code, responsibility, source_module, source_id, vehicle_id')
      .eq('id', o.payable_id!)
      .single()

    const p = payable as {
      amount: number; expense_account_code: string; responsibility: string
      source_module: string; source_id: string; vehicle_id: string
    }
    expect(Number(p.amount)).toBe(1200)
    expect(p.expense_account_code).toBe('despesa_documentacao')
    expect(p.responsibility).toBe('company')
    expect(p.source_module).toBe('vehicle_obligation')
    expect(p.source_id).toBe(o.id)
    expect(p.vehicle_id).toBe(vehicle.id)

    // Regravar não duplica o payable: a obrigação já está vinculada, e o índice
    // único por origem em `payables` fecha a corrida.
    await page.goto(`/veiculos/${vehicle.id}/editar`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: /^salvar$/i }).click()
    await page.waitForURL(`/veiculos/${vehicle.id}`, { timeout: 15_000 })

    const { count } = await admin()
      .from('payables')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('source_module', 'vehicle_obligation')
      .eq('source_id', o.id)

    expect(count, 'salvar de novo duplicou a conta a pagar').toBe(1)

    await admin().from('payables').delete().eq('id', o.payable_id!)
    await deleteTestVehicle(vehicle.id).catch(() => {})
  })
})
