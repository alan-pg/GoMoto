/**
 * @file document-extraction-multa.spec.ts
 * @description Spec 0012 §9.2 — extração de notificação de multa via IA.
 *
 * Requer o servidor dev rodando com `DOCUMENT_EXTRACTION_MOCK=1`
 * (ver obsidian-notes/Desenvolvimento Local.md).
 */
import { test, expect } from '@playwright/test'
import { createTestVehicle, deleteTestVehicle, getSupabase, waitForPageLoad } from './helpers'

const FAKE_PDF = Buffer.from('%PDF-1.4 conteúdo fake pra teste')

// Filtra por vehicle_id (único por teste), não por description — o fixture
// mockado usa sempre o mesmo texto de descrição em todo teste desta suíte.
async function fetchFineByVehicleId(vehicleId: string) {
  const sb = await getSupabase()
  const { data } = await sb
    .from('fines')
    .select('id, vehicle_id')
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  return data as { id: string; vehicle_id: string } | null
}

async function deleteTestFine(id: string): Promise<void> {
  const sb = await getSupabase()
  await sb.from('fine_attachments').delete().eq('fine_id', id)
  await sb.from('fines').delete().eq('id', id)
}

test.describe('Extração de documentos via IA — Multa (notificação de autuação)', () => {
  const vehicleIds: string[] = []
  const fineIds: string[] = []

  test.afterAll(async () => {
    for (const id of fineIds) await deleteTestFine(id).catch(() => {})
    for (const id of vehicleIds) await deleteTestVehicle(id).catch(() => {})
  })

  test('anexa-multa-com-placa-cadastrada', async ({ page }) => {
    const vehicle = await createTestVehicle()
    vehicleIds.push(vehicle.id)

    await page.goto('/multas/novo')
    await waitForPageLoad(page)

    await page.locator('input[type="file"]').first().setInputFiles({
      name: `mock-plate-${vehicle.license_plate}.pdf`,
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })

    await expect(page.getByText(/campos identificados/i)).toBeVisible({ timeout: 10_000 })
    // RF-008/CA-008 — veículo pré-selecionado pela placa extraída
    await expect(page.getByText(/veículo pré-selecionado/i)).toBeVisible()
    await expect(page.locator('#sec-link select').first()).toHaveValue(vehicle.id)

    await page.getByRole('button', { name: /^registrar multa$/i }).click()
    await page.waitForURL('/multas', { timeout: 10_000 })

    const fine = await fetchFineByVehicleId(vehicle.id)
    expect(fine).not.toBeNull()
    expect(fine?.vehicle_id).toBe(vehicle.id)
    if (fine) fineIds.push(fine.id)
  })

  test('placa-sem-match-campo-vazio', async ({ page }) => {
    const vehicle = await createTestVehicle()
    vehicleIds.push(vehicle.id)

    await page.goto('/multas/novo')
    await waitForPageLoad(page)

    // Fixture padrão do mock usa placa "ABC1234", que não bate com o veículo criado acima.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'multa.pdf',
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })

    await expect(page.getByText(/campos identificados/i)).toBeVisible({ timeout: 10_000 })
    // CA-009/RN-006 — campo de veículo permanece vazio, sem bloquear o resto do preenchimento
    await expect(page.getByText(/placa não encontrada/i)).toBeVisible()
    await expect(page.locator('#sec-link select').first()).toHaveValue('')

    // Seleção manual do veículo — resto do fluxo funciona normalmente
    await page.locator('#sec-link select').first().selectOption(vehicle.id)

    await page.getByRole('button', { name: /^registrar multa$/i }).click()
    await page.waitForURL('/multas', { timeout: 10_000 })

    const fine = await fetchFineByVehicleId(vehicle.id)
    expect(fine).not.toBeNull()
    if (fine) fineIds.push(fine.id)
  })

  test('apos-salvar-documento-anexado', async ({ page }) => {
    const vehicle = await createTestVehicle()
    vehicleIds.push(vehicle.id)

    await page.goto('/multas/novo')
    await waitForPageLoad(page)

    await page.locator('input[type="file"]').first().setInputFiles({
      name: `mock-plate-${vehicle.license_plate}.pdf`,
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })
    await expect(page.getByText(/campos identificados/i)).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /^registrar multa$/i }).click()
    await page.waitForURL('/multas', { timeout: 10_000 })

    const fine = await fetchFineByVehicleId(vehicle.id)
    expect(fine).not.toBeNull()
    if (!fine) return
    fineIds.push(fine.id)

    // RF-010/CA-011/RN-004 — documento original fica anexado ao registro
    const sb = await getSupabase()
    const { data: attachments } = await sb
      .from('fine_attachments')
      .select('id, type')
      .eq('fine_id', fine.id)
    expect(attachments?.length).toBeGreaterThan(0)
    expect(attachments?.[0].type).toBe('ait')
  })
})
