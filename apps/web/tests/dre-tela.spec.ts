/**
 * Tela do DRE.
 *
 * A view, o repositório e o hook existiam desde o redesenho e nenhuma tela os
 * consumia (P-10). O teste da view (`dre.spec.ts`) prova que o número está
 * certo; este prova que o número chega ao operador — que era exatamente o elo
 * que faltava, e o mesmo padrão que já tinha escondido a trava de inadimplência
 * e o botão de consolidar encargo.
 *
 * O que se verifica aqui é a travessia: lançamento no razão → view → tela, com
 * o sinal e a linha certos. Não repete as regras contábeis, que já têm dono.
 */

import { test, expect } from '@playwright/test'
import { TEST_TAG, getSupabaseAdmin, getTestTenantId, createTestCustomer, deleteTestCustomer, waitForPageLoad } from './helpers'

const admin = () => getSupabaseAdmin()

/** Mês corrente, primeiro dia — o DRE trunca por mês. */
function esteMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

let customerId = ''

async function lancar(entries: { account_code: string; direction: 'debit' | 'credit'; amount: number }[]) {
  const tenantId = await getTestTenantId()
  const { error } = await admin().rpc('post_financial_transaction', {
    p_tenant_id: tenantId,
    p_transaction: {
      event_type: 'charge_issued',
      description: `${TEST_TAG} DRE tela`,
      occurred_at: new Date().toISOString().slice(0, 10),
      source_module: 'manual',
    },
    p_entries: entries.map((e) => ({ ...e, customer_id: customerId })),
  })
  if (error) throw new Error(`post_financial_transaction: ${error.message}`)
}

/** Soma da linha no mês corrente, direto da view — a referência da tela. */
async function totalDaLinha(code: string): Promise<number> {
  const tenantId = await getTestTenantId()
  const { data } = await admin()
    .from('income_statement')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('period', esteMes())
    .eq('report_line_code', code)
  return (data ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0)
}

test.beforeAll(async () => {
  const c = await createTestCustomer()
  customerId = c.id
})

test.afterAll(async () => {
  // Lançamento é imutável por trigger; some junto com o `db:reset`.
  if (customerId) await deleteTestCustomer(customerId).catch(() => {})
})

test.describe('Tela do DRE', () => {
  test('mostra receita e despesa do mês com o sinal certo', async ({ page }) => {
    await lancar([
      { account_code: 'contas_a_receber', direction: 'debit',  amount: 2500 },
      { account_code: 'receita_locacao',  direction: 'credit', amount: 2500 },
    ])
    await lancar([
      { account_code: 'despesa_manutencao', direction: 'debit',  amount: 900 },
      { account_code: 'contas_a_pagar',     direction: 'credit', amount: 900 },
    ])

    const receitaBruta = await totalDaLinha('gross_revenue')
    const custo        = await totalDaLinha('operating_cost')
    expect(receitaBruta, 'setup não gerou receita').toBeGreaterThan(0)
    expect(custo, 'setup não gerou custo').toBeLessThan(0)

    await page.goto('/financeiro/dre?meses=3')
    await waitForPageLoad(page)

    await expect(page.getByRole('heading', { name: /demonstrativo de resultado/i })).toBeVisible()

    // As linhas aparecem com o nome de `report_lines`, não com o código cru —
    // era exatamente isso que a view não devolvia antes.
    await expect(page.getByRole('cell', { name: 'Receita bruta' })).toBeVisible()
    await expect(page.getByRole('cell', { name: /custos operacionais/i })).toBeVisible()
    await expect(page.getByText('gross_revenue')).toBeHidden()

    // O valor exibido bate com a view. Formatação pt-BR: 2.500,00.
    const fmt = (v: number) =>
      Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    await expect(page.getByText(new RegExp(fmt(receitaBruta))).first()).toBeVisible()
    await expect(page.getByText(new RegExp(fmt(custo))).first()).toBeVisible()

    // A despesa aparece negativa: se a inversão de sinal da view quebrar, o
    // custo vira receita e o resultado ainda "fecha" — só a asserção pega.
    const linhaCusto = page.getByRole('row').filter({ hasText: /custos operacionais/i })
    await expect(linhaCusto.getByText(/-\s*R\$/).first()).toBeVisible()
  })

  test('o resultado exibido é a soma das linhas, e o período muda com o filtro', async ({ page }) => {
    await page.goto('/financeiro/dre?meses=3')
    await waitForPageLoad(page)

    const tenantId = await getTestTenantId()
    const { data } = await admin()
      .from('income_statement')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('period', esteMes())

    const somaDoMes = (data ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0)
    const fmt = Math.abs(somaDoMes).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    // A coluna do mês corrente na linha "Resultado" tem de bater com a view.
    const rodape = page.getByRole('row').filter({ hasText: /^Resultado/ })
    await expect(rodape.getByText(new RegExp(fmt)).first()).toBeVisible()

    // Trocar o intervalo muda as colunas: 12 meses mostra mais que 3.
    const colunas3 = await page.getByRole('columnheader').count()
    await page.getByRole('link', { name: '12 meses' }).click()
    await page.waitForURL(/meses=12/, { timeout: 15_000 })
    await waitForPageLoad(page)
    await expect(page.getByRole('link', { name: '12 meses' })).toHaveClass(/bg-primary/)
    const colunas12 = await page.getByRole('columnheader').count()
    expect(colunas12, 'o filtro de período não mudou as colunas').toBeGreaterThan(colunas3)
  })
})
