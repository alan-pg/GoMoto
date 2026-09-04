import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, waitForPageLoad,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'

/**
 * Rateio na tela de manutenção: o formulário tem de dizer a quem o custo vai
 * ANTES de salvar, e a gravação é tudo ou nada.
 *
 * O caminho quebrado: escolher uma moto SEM locação ativa, informar quanto o
 * cliente paga, salvar. A manutenção era criada, `registerMaintenanceCost`
 * recusava logo depois ("sem locação ativa para este veículo"), e o operador
 * recebia "Manutenção salva, mas o custo falhou" — com um registro sem custo
 * que ele não pediu e não consegue desfazer pela tela.
 *
 * Quem responde pelo repasse é o cliente da locação ATIVA do veículo. Não é
 * escolha: ou existe, ou não há a quem cobrar.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let comLocacao = ''
let semLocacao = ''
let customerId = ''
let rentalId = ''

test.beforeAll(async () => {
  const v1 = await createTestVehicle()
  comLocacao = v1.id
  const contrato = await createTestContract(comLocacao)
  customerId = contrato.customerId
  rentalId = contrato.contractId

  // Segunda moto, deliberadamente sem contrato.
  const v2 = await createTestVehicle()
  semLocacao = v2.id
})

test.afterAll(async () => {
  await admin().from('maintenances').delete().in('vehicle_id', [comLocacao, semLocacao])
  await admin().from('rentals').delete().eq('id', rentalId)
  await deleteTestCustomer(customerId).catch(() => {})
  await deleteTestVehicle(comLocacao).catch(() => {})
  await deleteTestVehicle(semLocacao).catch(() => {})
})

async function abrirFormularioExecutada(page: import('@playwright/test').Page) {
  await page.goto('/manutencao')
  await waitForPageLoad(page)
  await page.getByRole('button', { name: /nova manutenção|registrar manutenção/i }).first().click()
  const modal = page.locator('div.fixed.inset-0').first()
  await expect(modal).toBeVisible({ timeout: 10_000 })
  // Modo "já executada" é o que pede custo e rateio.
  await modal.getByText(/já executada/i).first().click()
  return modal
}

test.describe('Rateio de manutenção — a tela diz a quem cobrar', () => {
  test('moto SEM locação ativa: campo bloqueado e o motivo à vista', async ({ page }) => {
    const modal = await abrirFormularioExecutada(page)

    await modal.getByLabel('Motocicleta *').selectOption(semLocacao)

    const campo = modal.getByLabel('Quanto o cliente paga (R$)')
    await expect(campo, 'sem locação não há a quem repassar').toBeDisabled()
    await expect(modal.getByText(/sem locação ativa — não há a quem repassar/i)).toBeVisible()
  })

  test('moto COM locação ativa: o campo abre e nomeia quem vai pagar', async ({ page }) => {
    const modal = await abrirFormularioExecutada(page)

    await modal.getByLabel('Motocicleta *').selectOption(comLocacao)

    const campo = modal.getByLabel('Quanto o cliente paga (R$)')
    await expect(campo).toBeEnabled()
    await expect(
      modal.getByText(/será cobrado de /i),
      'o operador precisa ver de quem, antes de salvar',
    ).toBeVisible()
  })

  test('trocar para moto sem locação zera o repasse — nada fica escondido', async ({ page }) => {
    // O valor digitado continuava no estado depois da troca: o campo aparecia
    // vazio e o save era recusado por um número que a tela não mostrava mais.
    const modal = await abrirFormularioExecutada(page)

    await modal.getByLabel('Motocicleta *').selectOption(comLocacao)
    await modal.getByLabel('Quanto o cliente paga (R$)').fill('50')

    await modal.getByLabel('Motocicleta *').selectOption(semLocacao)
    await expect(modal.getByLabel('Quanto o cliente paga (R$)')).toHaveValue('')

    // E voltando, não ressuscita o valor antigo às escondidas.
    await modal.getByLabel('Motocicleta *').selectOption(comLocacao)
    await expect(modal.getByLabel('Quanto o cliente paga (R$)')).toHaveValue('')
  })

  test('salvar com rateio impossível não deixa manutenção órfã', async ({ page }) => {
    // A tela agora impede chegar aqui pelo campo desabilitado; o teste garante
    // que, se chegar, nada é gravado pela metade.
    const dialogos: string[] = []
    page.on('dialog', async (d) => { dialogos.push(d.message()); await d.dismiss() })

    const modal = await abrirFormularioExecutada(page)
    const marca = `${TEST_TAG} Rateio impossivel ${RUN}`

    await modal.getByLabel('Motocicleta *').selectOption(semLocacao)
    await modal.getByLabel('Descrição *').fill(marca)
    await modal.getByLabel('Custo (R$)').fill('300')

    // Força o valor por baixo da trava da tela, como faria um estado herdado.
    await modal.getByLabel('Quanto o cliente paga (R$)').evaluate((el) => {
      const input = el as HTMLInputElement
      input.disabled = false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '150')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await modal.getByRole('button', { name: /^salvar/i }).click()
    await page.waitForTimeout(2000)

    const { data } = await admin()
      .from('maintenances')
      .select('id')
      .eq('vehicle_id', semLocacao)
      .eq('description', marca)

    expect((data ?? []).length, 'nada pode ter sido salvo').toBe(0)
    expect(dialogos.join(' '), 'o erro tem que explicar, não dizer "salva mas"')
      .not.toContain('Manutenção salva, mas')
  })
})
