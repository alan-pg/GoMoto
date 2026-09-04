import { test, expect } from '@playwright/test'
import { TEST_TAG, getSupabaseAdmin, getTestTenantId, deleteTestAuthUser } from './helpers'

test.describe('Definir senha — continuação do convite (Spec 0011 §3.5)', () => {
  // Cada caso cria usuário e faz login de verdade, ida e volta pelo GoTrue:
  // cabe nos 30s padrão sozinho, não com a suíte inteira disputando.
  test.slow()

  test('link de convite válido permite definir senha e entra no dashboard (RF-002/007)', async ({ browser }) => {
    const admin = getSupabaseAdmin()
    const email = `e2e-definir-senha-${Date.now()}@teste.com`
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000'

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${appUrl}/definir-senha`, data: { name: `${TEST_TAG} Definir Senha` } },
    })
    expect(error).toBeNull()
    expect(data.user).toBeTruthy()

    const tenantId = await getTestTenantId()
    await admin.from('tenant_members').insert({ tenant_id: tenantId, user_id: data.user!.id, role: 'operator', status: 'active' })

    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(data.properties!.action_link)
      await page.waitForURL(/\/definir-senha/, { timeout: 15_000 })

      await page.getByLabel('Nova senha').fill('senha12345')
      await page.getByLabel('Confirmar senha').fill('senha12345')
      await page.getByRole('button', { name: /definir senha e entrar/i }).click()

      // 30s: primeira visita ao dashboard nesta sessão, compilado sob demanda.
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    } finally {
      await context.close()
      await deleteTestAuthUser(data.user!.id)
    }
  })

  test('sem token de sessão na URL, mostra mensagem de link expirado/já utilizado', async ({ page }) => {
    await page.goto('/definir-senha')
    await expect(page.getByText(/link expirado ou já utilizado/i)).toBeVisible({ timeout: 10_000 })
  })
})
