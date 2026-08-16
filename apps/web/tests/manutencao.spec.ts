/**
 * Manutenção — CRUD.
 *
 * A spec falhava por locator ambíguo: `getModal(page)` pega o primeiro
 * `div.fixed.inset-0`, e esta tela monta cinco modais (form, detalhe, KM,
 * exclusão, conclusão). Com mais de um no DOM, "o primeiro" não é o aberto, e
 * `name: /salvar|agendar|confirmar/` casava com botão de dois modais ao mesmo
 * tempo — strict mode violation antes de qualquer asserção de negócio.
 *
 * Aqui cada etapa busca o modal **visível**, e as asserções conferem o banco:
 * "a linha sumiu da tabela" pode ser filtro, não exclusão.
 *
 * A tela abre com o filtro de status em "Vencidas" (`statusFilter` nasce em
 * `'overdue'`), então uma manutenção recém-agendada não aparece até clicar o
 * card correspondente — os KPIs contam tudo, a lista mostra só a aba ativa.
 * O teste clica a aba de propósito, em vez de mascarar isso com um `waitFor`.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, createTestVehicle, deleteTestVehicle, waitForPageLoad, getSupabaseAdmin,
} from './helpers'

const admin = () => getSupabaseAdmin()

const SUFIXO = Date.now().toString().slice(-5)
// Descrição que NÃO casa com item de plano padrão e data bem no futuro: o
// status é calculado por km E por data, e agendar para hoje com uma descrição
// conhecida ("Troca de corrente") jogava o item ora em "Vencidas" ora em
// "Próximas", conforme o km do veículo naquele run. O teste é sobre CRUD, não
// sobre a regra de status — que tem cobertura própria em @gomoto/core.
const DESCRICAO = `${TEST_TAG} Ajuste avulso ${SUFIXO}`
const DESCRICAO_EDITADA = `${DESCRICAO} EDITADO`
const DATA_FUTURA = new Date(Date.now() + 120 * 86_400_000).toISOString().split('T')[0]

let motoId = ''

/** O modal aberto — a tela mantém vários montados. */
const modalAberto = (page: import('@playwright/test').Page) =>
  page.locator('div.fixed.inset-0').filter({ has: page.locator(':visible') }).last()

test.describe('Manutenção — CRUD', () => {
  test.beforeAll(async () => {
    const moto = await createTestVehicle()
    motoId = moto.id
  })

  test.afterAll(async () => {
    await admin().from('maintenances').delete().eq('vehicle_id', motoId)
    await deleteTestVehicle(motoId).catch(() => {})
  })

  test('agendar, editar e excluir manutenção', async ({ page }) => {
    await page.goto('/manutencao')
    await waitForPageLoad(page)

    // ── AGENDAR ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova manutenção/i }).click()

    const modal = modalAberto(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })

    await modal.getByLabel('Motocicleta *').selectOption(motoId)
    await modal.getByLabel('Item / Descrição *').fill(DESCRICAO)
    await modal.getByLabel('Data Agendada').fill(DATA_FUTURA)
    await modal.getByLabel('Oficina / Mecânico').fill('Oficina E2E')

    await modal.getByRole('button', { name: /^salvar$/i }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // A lista abre em "Vencidas"; a recém-agendada vive na aba "Agendadas".
    await page.getByRole('button', { name: /agendadas/i }).click()
    await expect(page.locator('tr', { hasText: DESCRICAO }).first()).toBeVisible({ timeout: 15_000 })

    const { data: criada } = await admin()
      .from('maintenances').select('id, description')
      .eq('vehicle_id', motoId).maybeSingle()
    expect(criada, 'manutenção não foi criada').not.toBeNull()
    const maintenanceId = (criada as { id: string }).id

    // ── EDITAR ───────────────────────────────────────────────────────────────
    await page.locator('tr', { hasText: DESCRICAO }).first().getByTitle('Editar').click()

    const modalEdicao = modalAberto(page)
    await expect(modalEdicao).toBeVisible({ timeout: 10_000 })
    await modalEdicao.getByLabel('Item / Descrição *').fill(DESCRICAO_EDITADA)
    await modalEdicao.getByRole('button', { name: /^salvar$/i }).click()

    await expect(page.locator('tr', { hasText: DESCRICAO_EDITADA }).first()).toBeVisible({ timeout: 15_000 })

    const { data: editada } = await admin()
      .from('maintenances').select('description').eq('id', maintenanceId).single()
    expect((editada as { description: string }).description, 'edição não persistiu').toBe(DESCRICAO_EDITADA)

    // ── EXCLUIR ──────────────────────────────────────────────────────────────
    await page.locator('tr', { hasText: DESCRICAO_EDITADA }).first().getByTitle('Excluir').click()

    const modalExclusao = modalAberto(page)
    await expect(modalExclusao).toBeVisible({ timeout: 10_000 })
    await modalExclusao.getByRole('button', { name: /excluir/i }).last().click()

    await expect(page.locator('tr', { hasText: DESCRICAO_EDITADA })).toHaveCount(0, { timeout: 15_000 })

    const { data: apagada } = await admin()
      .from('maintenances').select('id').eq('id', maintenanceId).maybeSingle()
    expect(apagada, 'manutenção sumiu da tabela mas continuou no banco').toBeNull()
  })

  test('manutenção já executada lança o custo, não o descarta', async ({ page }) => {
    // Havia dois caminhos para registrar manutenção concluída, e só um lançava:
    // "Agendar" → "Registrar conclusão" chamava `registerMaintenanceCost`; o
    // modo "Já executada" do modal não. Quem lançava direto digitava o custo e
    // ele morria na tela — `maintenances.cost` saiu na ADR 0024, o payload não
    // o carrega, e nada mais o recebia.
    const descricao = `${TEST_TAG} Executada com custo ${SUFIXO}`

    await page.goto('/manutencao')
    await waitForPageLoad(page)
    await page.getByRole('button', { name: /nova manutenção/i }).click()

    const modal = modalAberto(page)
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await modal.getByRole('button', { name: /^já executada$/i }).click()

    await modal.getByLabel('Motocicleta *').selectOption(motoId)
    await modal.getByLabel('Item / Descrição *').fill(descricao)
    await modal.getByLabel('KM no Serviço *').fill('20000')
    await modal.getByLabel('Custo (R$)').fill('450')

    await modal.getByRole('button', { name: /^salvar$/i }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    const { data: manutencao } = await admin()
      .from('maintenances').select('id, completed').eq('description', descricao).single()
    const m = manutencao as { id: string; completed: boolean }
    expect(m.completed).toBe(true)

    const { data: payable } = await admin()
      .from('payables')
      .select('amount, expense_account_code, responsibility')
      .eq('source_module', 'maintenance')
      .eq('source_id', m.id)
      .maybeSingle()

    const p = payable as { amount: number; expense_account_code: string; responsibility: string } | null
    expect(p, 'custo digitado na manutenção executada foi descartado').not.toBeNull()
    expect(Number(p!.amount)).toBe(450)
    expect(p!.expense_account_code).toBe('despesa_manutencao')

    // E chega ao resultado do veículo, que é onde a decisão de trocar a moto
    // é tomada.
    const { data: posicao } = await admin()
      .from('vehicle_financial_position')
      .select('maintenance_cost').eq('vehicle_id', motoId).single()

    expect(
      Number((posicao as { maintenance_cost: number }).maintenance_cost),
      'custo não chegou ao resultado do veículo',
    ).toBe(450)
  })
})
