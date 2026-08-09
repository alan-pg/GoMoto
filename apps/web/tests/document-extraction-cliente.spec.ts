/**
 * @file document-extraction-cliente.spec.ts
 * @description Spec 0012 §9.2 — extração de CNH via IA na tela de Cliente.
 *
 * Requer o servidor dev rodando com `DOCUMENT_EXTRACTION_MOCK=1`
 * (ver obsidian-notes/Desenvolvimento Local.md) — sem isso, o Server Action
 * tentaria chamar o Gemini de verdade e essa suíte falharia/travaria no timeout.
 *
 * Cleanup é por teste (afterEach), não afterAll: o fixture mockado de CNH usa
 * sempre o mesmo CPF (Spec 0012 — "ExtractionResult fixo"), então dois testes
 * que salvam o cliente extraído em sequência colidem na constraint de CPF
 * único se o primeiro não for removido antes do segundo rodar.
 */
import { test, expect } from '@playwright/test'
import { TEST_TAG, deleteTestCustomer, getSupabase, waitForPageLoad } from './helpers'

const FAKE_PDF = Buffer.from('%PDF-1.4 conteúdo fake pra teste')

function uniqueName(tag: string): string {
  return `${TEST_TAG} CNH ${tag} ${Date.now()}`
}

async function fetchCustomerByName(name: string) {
  const sb = await getSupabase()
  const { data } = await sb.from('customers').select('id, drivers_license_photo_url').eq('name', name).maybeSingle()
  return data as { id: string; drivers_license_photo_url: string | null } | null
}

test.describe('Extração de documentos via IA — Cliente (CNH)', () => {
  let customerId = ''

  test.afterEach(async () => {
    if (customerId) await deleteTestCustomer(customerId).catch(() => {})
    customerId = ''
  })

  test('sem-anexar-fluxo-manual-intacto', async ({ page }) => {
    const name = uniqueName('manual')
    await page.goto('/clientes/novo')
    await waitForPageLoad(page)

    // CPF é opcional no schema — sem anexar documento, zero chamada de extração (RN-003).
    await page.getByPlaceholder('Nome completo do cliente').fill(name)

    await page.getByRole('button', { name: /^salvar$/i }).click()
    await page.waitForURL('/clientes', { timeout: 10_000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 })

    const customer = await fetchCustomerByName(name)
    expect(customer).not.toBeNull()
    if (customer) customerId = customer.id
  })

  test('anexa-arquivo-invalido', async ({ page }) => {
    await page.goto('/clientes/novo')
    await waitForPageLoad(page)

    // Rejeitado pelo mesmo schema Zod do client, antes de qualquer chamada de IA (RNF-003).
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'documento.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('não é um documento válido'),
    })

    await expect(page.getByText(/formato não suportado/i)).toBeVisible({ timeout: 5_000 })
  })

  test('anexa-cnh-valida', async ({ page }) => {
    const name = uniqueName('extraida')
    await page.goto('/clientes/novo')
    await waitForPageLoad(page)

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'cnh.pdf',
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })

    // RF-005/CA-005 — contagem de campos identificados
    await expect(page.getByText(/campos identificados/i)).toBeVisible({ timeout: 10_000 })
    // RF-004/CA-004 — RG vem com confidence 'low' no fixture mockado
    await expect(page.getByText('Confira').first()).toBeVisible()

    // RF-003/CA-003 — campos pré-preenchidos com os valores extraídos
    await expect(page.getByPlaceholder('Nome completo do cliente')).toHaveValue('Maria Extração Teste')
    await expect(page.getByPlaceholder('000.000.000-00')).toHaveValue('529.982.247-25')

    // RF-006/CA-006 — edição do operador sobrescreve o valor extraído
    await page.getByPlaceholder('Nome completo do cliente').fill(name)

    // RF-007/CA-007/RN-002 — salva mesmo com campo de baixa confiança (RG) não corrigido
    await page.getByRole('button', { name: /^salvar$/i }).click()
    await page.waitForURL('/clientes', { timeout: 10_000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 })

    const customer = await fetchCustomerByName(name)
    expect(customer).not.toBeNull()
    if (customer) customerId = customer.id
  })

  test('extracao-falha-mensagem-retry', async ({ page }) => {
    await page.goto('/clientes/novo')
    await waitForPageLoad(page)

    await page.getByPlaceholder('Nome completo do cliente').fill('Dado digitado antes da falha')

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'cnh-mock-fail.pdf',
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })

    // RF-009/CA-010
    await expect(page.getByText(/tentar novamente/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/preencher manualmente/i)).toBeVisible()

    // Nada do que já tinha sido digitado se perde
    await expect(page.getByPlaceholder('Nome completo do cliente')).toHaveValue('Dado digitado antes da falha')
  })

  test('apos-salvar-documento-anexado', async ({ page }) => {
    const name = uniqueName('anexo')
    await page.goto('/clientes/novo')
    await waitForPageLoad(page)

    // Anexa primeiro — extração preenche o nome com o fixture; renomear ANTES
    // do upload seria sobrescrito quando a extração aplicar o resultado.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'cnh.pdf',
      mimeType: 'application/pdf',
      buffer: FAKE_PDF,
    })
    await expect(page.getByText(/campos identificados/i)).toBeVisible({ timeout: 10_000 })

    await page.getByPlaceholder('Nome completo do cliente').fill(name)

    await page.getByRole('button', { name: /^salvar$/i }).click()
    await page.waitForURL('/clientes', { timeout: 10_000 })
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 })

    const customer = await fetchCustomerByName(name)
    if (customer) customerId = customer.id // registra pro cleanup ANTES do assert poder lançar

    // RF-010/CA-011/RN-004 — documento original fica anexado ao registro
    expect(customer?.drivers_license_photo_url).toBeTruthy()
  })
})
