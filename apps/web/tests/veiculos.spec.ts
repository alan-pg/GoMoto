/**
 * Veículos — CRUD.
 *
 * A spec estava presa ao wizard em modal que existia em julho; o cadastro virou
 * página (`/veiculos/novo`) e a edição virou rota (`/veiculos/[id]/editar`).
 * Ela falhava desde então no primeiro clique, sem nunca chegar ao banco — ou
 * seja, não protegia nada.
 *
 * Os campos são alcançados por rótulo. O `Field` deste form passou a envolver o
 * controle com o `<label>`: antes eram irmãos sem `htmlFor`, o que deixava o
 * input sem nome acessível e obrigava o teste a caçar placeholder e posição.
 */

import { test, expect } from '@playwright/test'
import { waitForPageLoad, getSupabaseAdmin } from './helpers'

const SUFIXO = Date.now().toString().slice(-4)
// Padrão Mercosul (LLLNLNN): a máscara do form rejeita qualquer outro formato,
// e a spec antiga montava "T1234E2", que não passa.
const PLACA = `TST${SUFIXO[0]}E${SUFIXO.slice(1, 3)}`.toUpperCase()
const MODELO_EDITADO = 'Fan 160 EDITADO'

test.afterAll(async () => {
  await getSupabaseAdmin().from('vehicles').delete().eq('license_plate', PLACA)
})

test.describe('Veículos — CRUD', () => {
  // Três navegações completas (criar, editar, excluir) num form grande: cabe
  // nos 30s padrão sozinho, mas não com a suíte inteira disputando o servidor.
  test.slow()

  test('criar, editar e excluir veículo', async ({ page }) => {
    // ── CRIAR ────────────────────────────────────────────────────────────────
    await page.goto('/veiculos')
    await waitForPageLoad(page)
    await page.getByRole('link', { name: /novo veículo/i }).click()
    await page.waitForURL('**/veiculos/novo', { timeout: 15_000 })
    await waitForPageLoad(page)

    await page.getByLabel('Placa *').fill(PLACA)
    // RENAVAM é único por tenant: valor fixo colide com execução anterior.
    await page.getByLabel(/RENAVAM/i).fill(Date.now().toString().slice(-11).padStart(11, '1'))
    await page.getByLabel(/^Marca/i).fill('HONDA')
    await page.getByLabel(/^Modelo/i).fill('CG 160 Fan')
    await page.getByLabel(/^Ano fabrica/i).fill('2024')
    await page.getByLabel(/^Ano modelo/i).fill('2024')
    await page.getByLabel(/^Cor/i).fill('VERMELHO')
    await page.getByLabel(/^Chassi/i).fill(`9C2${Date.now()}`.padEnd(17, '0').slice(0, 17))

    // O rótulo do submit muda entre criar e editar ("Cadastrar" / "Salvar").
    await page.getByRole('button', { name: /^cadastrar$/i }).first().click()
    await page.waitForURL(/\/veiculos(\/[0-9a-f-]+)?$/, { timeout: 20_000 })
    await waitForPageLoad(page)

    const { data: criado } = await getSupabaseAdmin()
      .from('vehicles').select('id, model').eq('license_plate', PLACA).maybeSingle()
    expect(criado, 'veículo não foi criado').not.toBeNull()
    const vehicleId = (criado as { id: string }).id

    // ── EDITAR ───────────────────────────────────────────────────────────────
    await page.goto(`/veiculos/${vehicleId}/editar`)
    await waitForPageLoad(page)

    const campoModelo = page.getByLabel(/^Modelo/i)
    await campoModelo.clear()
    await campoModelo.fill(MODELO_EDITADO)
    await page.getByRole('button', { name: /^salvar( alterações)?$/i }).first().click()
    await page.waitForURL(`**/veiculos/${vehicleId}`, { timeout: 20_000 })

    const { data: editado } = await getSupabaseAdmin()
      .from('vehicles').select('model').eq('id', vehicleId).single()
    expect((editado as { model: string }).model, 'edição não persistiu').toBe(MODELO_EDITADO)

    // ── EXCLUIR ──────────────────────────────────────────────────────────────
    await page.goto('/veiculos')
    await waitForPageLoad(page)

    const linha = page.locator('tr', { hasText: PLACA }).first()
    await expect(linha).toBeVisible({ timeout: 10_000 })
    await linha.getByTitle('Excluir').click()

    // "Excluir" também é o title do ícone em cada linha da tabela: o botão de
    // confirmação tem de ser buscado DENTRO do modal.
    const modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await modal.getByRole('button', { name: /^excluir$/i }).click()

    await expect(page.locator('tr', { hasText: PLACA })).toHaveCount(0, { timeout: 15_000 })

    const { data: apagado } = await getSupabaseAdmin()
      .from('vehicles').select('id').eq('id', vehicleId).maybeSingle()
    expect(apagado, 'veículo continuou no banco depois da exclusão').toBeNull()
  })
})
