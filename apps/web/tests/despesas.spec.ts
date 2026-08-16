import { test, expect } from '@playwright/test'
import {
  TEST_TAG, createTestCustomer, deleteTestCustomer, getModal, waitForPageLoad, getSupabaseAdmin,
} from './helpers'

/**
 * Despesas — responsabilidade e rateio (Spec 0014 / ADR 0024).
 *
 * A suíte anterior testava criar → editar → excluir. Excluir saiu: apagar
 * registro financeiro viola o Princípio 3; cancelar preserva o histórico.
 *
 * O que entra é o que a tabela `expenses` tornava inmodelável (F-07): despesa
 * com responsabilidade compartilhada, rateada em VALORES e não em percentual
 * inteiro (Princípio 7), gerando cobrança automática da parte do cliente.
 */

const RUN_ID = Date.now().toString(36)
const DESCRIPTION = `${TEST_TAG} Manutenção ${RUN_ID}`
const TODAY = new Date().toISOString().split('T')[0]!

let customerId = ''

test.describe('Despesas — responsabilidade e rateio', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
  })

  test.afterAll(async () => {
    // Falha esperada quando há cobrança vinculada (ON DELETE RESTRICT).
    await deleteTestCustomer(customerId).catch(() => {})
  })

  test('despesa da empresa não gera cobrança ao cliente', async ({ page }) => {
    await page.goto('/despesas')
    await waitForPageLoad(page)

    await page.getByRole('button', { name: /nova despesa/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').fill(`${DESCRIPTION} empresa`)
    await modal.getByLabel('Valor total').fill('150')
    await modal.getByLabel('Categoria').selectOption('despesa_manutencao')
    await modal.getByLabel('Competência').fill(TODAY)
    await modal.getByLabel('Vencimento').fill(TODAY)

    await modal.getByRole('button', { name: /registrar despesa/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(`${DESCRIPTION} empresa`)).toBeVisible({ timeout: 10_000 })

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('payables')
      .select('amount, customer_amount, responsibility, reimbursement')
      .eq('description', `${DESCRIPTION} empresa`)
      .maybeSingle()

    const p = data as {
      amount: number; customer_amount: number; responsibility: string; reimbursement: string
    } | null

    expect(p).not.toBeNull()
    expect(p!.responsibility).toBe('company')
    expect(Number(p!.customer_amount)).toBe(0)
    expect(p!.reimbursement).toBe('none')
  })

  test('rateio de 1/3 fecha em valores e gera cobrança do cliente', async ({ page }) => {
    await page.goto('/despesas')
    await waitForPageLoad(page)

    await page.getByRole('button', { name: /nova despesa/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Descrição').fill(`${DESCRIPTION} rateada`)
    await modal.getByLabel('Valor total').fill('1000')
    await modal.getByLabel('Categoria').selectOption('despesa_manutencao')
    await modal.getByLabel('Competência').fill(TODAY)
    await modal.getByLabel('Vencimento').fill(TODAY)

    await modal.getByLabel('Responsabilidade financeira').selectOption('shared')
    await modal.getByLabel('Cliente', { exact: true }).selectOption(customerId)

    // Um terço EXATO de 1000. A tela pedia percentual inteiro e derivava o
    // valor, então 1/3 era inalcançável: 33% dá 333,00 e nenhum inteiro dá
    // 333,33. Agora o operador informa o valor, que é o que o modelo guarda
    // (ADR 0024, Princípio 7) e a frase que ele tem na cabeça.
    await modal.getByLabel(/parte do cliente/i).fill('333.33')

    // A prévia mostra a divisão antes de gravar.
    await expect(modal.getByText(/o rateio é informado e gravado em valores/i)).toBeVisible()

    await modal.getByRole('button', { name: /registrar despesa/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('payables')
      .select('id, amount, customer_amount, responsibility, reimbursement')
      .eq('description', `${DESCRIPTION} rateada`)
      .maybeSingle()

    const p = data as {
      id: string; amount: number; customer_amount: number
      responsibility: string; reimbursement: string
    } | null

    expect(p).not.toBeNull()
    expect(p!.responsibility).toBe('shared')
    expect(Number(p!.customer_amount)).toBe(333.33)
    // A soma fecha exatamente: nada se perde no arredondamento. O `toFixed` é
    // da subtração em JS, não do dado — o banco guarda NUMERIC exato.
    expect(Number((Number(p!.amount) - Number(p!.customer_amount)).toFixed(2))).toBe(666.67)
    expect(p!.reimbursement).toBe('charge')

    // A parte do cliente virou cobrança, num passo só.
    const { data: item } = await supabase
      .from('charge_items')
      .select('amount, credit_account_code')
      .eq('source_module', 'expense')
      .eq('source_id', p!.id)
      .maybeSingle()

    const i = item as { amount: number; credit_account_code: string } | null
    expect(i).not.toBeNull()
    expect(Number(i!.amount)).toBe(333.33)
    // Repasse credita conta de REPASSE, não receita: é custo recuperado,
    // não faturamento (R-03).
    expect(i!.credit_account_code).toBe('repasse_manutencao')
  })

  test('custo bruto e valor repassado ficam separados no ledger', async () => {
    const supabase = getSupabaseAdmin()

    const { data } = await supabase
      .from('financial_entries')
      .select('account_code, direction, amount')
      .eq('customer_id', customerId)

    const rows = (data ?? []) as { account_code: string; direction: string; amount: number }[]

    const despesa = rows.find((e) => e.account_code === 'despesa_manutencao' && e.direction === 'debit')
    const repasse = rows.find((e) => e.account_code === 'repasse_manutencao' && e.direction === 'credit')

    // A despesa entra integral; a recuperação vem em lançamento separado. Somar
    // um dentro do outro esconderia o custo bruto.
    expect(Number(despesa?.amount)).toBe(1000)
    expect(Number(repasse?.amount)).toBe(333.33)
  })
})
