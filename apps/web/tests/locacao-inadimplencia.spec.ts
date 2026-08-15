import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestCustomer, deleteTestCustomer,
  waitForPageLoad,
} from './helpers'

/**
 * Trava de inadimplência na criação de locação (F-04).
 *
 * É a regra que já falhou uma vez em produção — e de um jeito que nenhum portão
 * pegava: a checagem existia, correta, dentro de `createRentalWithDeposit`, que
 * NENHUM componente chamava. O `RentalForm` usa `createRental` direto, então
 * cliente bloqueado abria locação nova normalmente pela tela.
 *
 * Regra correta e função sem chamador passam por typecheck, lint e teste
 * unitário. Só percorrer a tela revela — e foi assim que apareceu.
 *
 * Os campos são localizados pelo texto do placeholder porque este formulário
 * não associa `<label>` ao controle (nem `htmlFor`, nem aninhamento), o que
 * também impede o leitor de tela de anunciá-los. Lacuna registrada, não
 * corrigida aqui.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''

const inicio = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
const fim    = new Date(Date.now() + 93 * 864e5).toISOString().slice(0, 10)

async function bloquear(acao: 'block' | 'unblock') {
  const tenantId = await getTestTenantId()
  const { data: users } = await admin().auth.admin.listUsers({ perPage: 200 })
  const actor = users.users.find((u) => u.email === 'empresa01@teste.com')!.id

  const { error } = await admin().from('delinquency_blocks').insert({
    tenant_id: tenantId, customer_id: customerId, action: acao,
    reason: `${TEST_TAG} ${acao} ${RUN}`, actor_id: actor,
    acted_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Falha ao ${acao}: ${error.message}`)
}

async function preencherFormulario(page: import('@playwright/test').Page) {
  await page.goto('/locacoes/nova')
  await waitForPageLoad(page)

  await page.locator('select').filter({ hasText: 'Selecione um cliente' }).selectOption(customerId)
  await page.locator('select').filter({ hasText: 'Selecione um veículo' }).selectOption(vehicleId)
  await page.getByPlaceholder('0,00').first().fill('600')

  const datas = page.locator('input[type=date]')
  await datas.nth(0).fill(inicio)
  await datas.nth(1).fill(fim)

  await page.getByRole('button', { name: 'Preview' }).click()
}

async function locacoesDoCliente() {
  const { count } = await admin()
    .from('rentals')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
  return count ?? 0
}

test.describe('Locação — cliente bloqueado por inadimplência', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    const c = await createTestCustomer()
    vehicleId = v.id
    customerId = c.id
  })

  test.afterAll(async () => {
    const { data: rs } = await admin().from('rentals').select('id').eq('customer_id', customerId)
    for (const r of (rs ?? []) as { id: string }[]) {
      await admin().from('rental_billing_schedules').delete().eq('rental_id', r.id)
    }
    await admin().from('rentals').delete().eq('customer_id', customerId)
    await admin().from('delinquency_blocks').delete().eq('customer_id', customerId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('cliente bloqueado não consegue abrir locação pela tela', async ({ page }) => {
    await bloquear('block')

    const antes = await locacoesDoCliente()

    await preencherFormulario(page)
    await page.getByRole('button', { name: /Confirmar/ }).click()

    await expect(page.getByText(/bloqueado por inadimpl/i)).toBeVisible({ timeout: 15_000 })

    // A mensagem sozinha não basta: o que importa é que nada foi criado.
    expect(await locacoesDoCliente(), 'locação criada apesar do bloqueio').toBe(antes)
  })

  test('desbloqueado, o mesmo cliente abre locação normalmente', async ({ page }) => {
    // Contraprova: sem ela, o teste acima passaria mesmo se a criação
    // estivesse quebrada por qualquer outro motivo.
    await bloquear('unblock')

    const antes = await locacoesDoCliente()

    await preencherFormulario(page)
    await page.getByRole('button', { name: /Confirmar/ }).click()
    await page.waitForURL((u) => /\/locacoes\/[0-9a-f-]{36}/.test(new URL(u).pathname), { timeout: 15_000 })

    expect(await locacoesDoCliente(), 'desbloqueado e ainda assim não criou').toBe(antes + 1)
  })
})
