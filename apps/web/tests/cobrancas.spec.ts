import { test, expect } from '@playwright/test'
import {
  TEST_TAG, createTestCustomer, deleteTestCustomer, getModal, waitForPageLoad, getSupabaseAdmin,
} from './helpers'

/**
 * Cobranças — ciclo de vida sobre o ledger (Spec 0014 / ADR 0024).
 *
 * A suíte anterior testava criar → editar → pagar → excluir. Dois desses fluxos
 * deixaram de existir por decisão de modelo, não por remoção de funcionalidade:
 *
 * - EDITAR: documento emitido é imutável (Princípio 5). Corrigir valor exige
 *   cancelar e emitir outra cobrança.
 * - EXCLUIR: apagar registro financeiro viola o Princípio 3. Cancelar e dar
 *   baixa cobrem os casos, ambos com estorno rastreável no ledger.
 *
 * O que entra no lugar é o que o modelo antigo tornava impossível: pagamento
 * PARCIAL, com a cobrança seguindo em aberto pelo saldo restante.
 */

/**
 * Descrição única por execução.
 *
 * Registro financeiro não é apagável: `charges.customer_id` é ON DELETE
 * RESTRICT e `financial_entries` bloqueia DELETE por trigger (Princípio 3).
 * Logo o cliente de teste sobrevive ao afterAll e os dados acumulam entre
 * execuções — o identificador único evita colisão em vez de tentar limpar o
 * que o modelo protege de propósito.
 */
const RUN_ID = Date.now().toString(36)
const DESCRIPTION = `${TEST_TAG} Aluguel ${RUN_ID}`
/**
 * Vencimento no passado desde a emissão.
 *
 * A primeira versão deste spec criava a cobrança com vencimento hoje e depois
 * fazia UPDATE em `due_date` para habilitar a baixa. O banco recusou: o trigger
 * `fn_protect_issued_charge` torna o documento imutável (Princípio 5). O setup
 * teve que mudar porque a invariante funciona — inclusive contra o teste.
 */
const PAST_DUE = '2020-01-01'

let customerId = ''

/** Saldo derivado da view — a fonte de verdade que a tela exibe. */
async function chargeBalance(customer: string) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('charge_balances')
    .select('charge_id, total_amount, paid_amount, open_amount, status')
    .eq('customer_id', customer)
    .order('issue_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as {
    charge_id: string; total_amount: number; paid_amount: number
    open_amount: number; status: string
  } | null
}

test.describe('Cobranças — emissão, pagamento parcial e baixa', () => {
  test.beforeAll(async () => {
    const customer = await createTestCustomer()
    customerId = customer.id
  })

  test.afterAll(async () => {
    // Best-effort: falha esperada quando há cobrança vinculada (ON DELETE
    // RESTRICT). Não é erro do teste — é a proteção do modelo funcionando.
    await deleteTestCustomer(customerId).catch(() => {})
  })

  test('emite cobrança, recebe parcial e o saldo permanece em aberto', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    // ── Emissão ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /nova cobrança/i }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()

    await modal.getByLabel('Cliente').selectOption(customerId)
    await modal.getByLabel('Descrição').fill(DESCRIPTION)
    await modal.getByLabel('Valor').fill('500')
    await modal.getByLabel('Vencimento').fill(PAST_DUE)

    await modal.getByRole('button', { name: /criar cobrança/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(DESCRIPTION)).toBeVisible({ timeout: 10_000 })

    // O documento nasce com saldo integral em aberto.
    const emitida = await chargeBalance(customerId)
    expect(emitida).not.toBeNull()
    expect(Number(emitida!.total_amount)).toBe(500)
    expect(Number(emitida!.open_amount)).toBe(500)
    expect(emitida!.status).toBe('open')

    // ── Recebimento PARCIAL ──────────────────────────────────────────────────
    // O UNIQUE(billing_id) da ADR 0013 tornava isto fisicamente impossível.
    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle(/registrar recebimento/i).click()

    await expect(modal).toBeVisible()
    await modal.getByLabel('Valor recebido').fill('200')

    // A tela avisa o saldo que permanece, antes de confirmar.
    await expect(modal.getByText(/recebimento parcial/i)).toBeVisible()

    await modal.getByRole('button', { name: /^registrar$/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    const parcial = await chargeBalance(customerId)
    expect(Number(parcial!.paid_amount)).toBe(200)

    // Saldo pela RELAÇÃO, não por número fixo: receber realiza o encargo do
    // atraso antes de alocar, e esta cobrança vence em 2020 — seis anos de
    // juros. O que o teste afirma é que pagamento parcial não quita o
    // documento, e isso vale qualquer que seja o encargo.
    expect(Number(parcial!.open_amount)).toBeCloseTo(
      Number(parcial!.total_amount) - 200, 2,
    )
    expect(Number(parcial!.open_amount), 'parcial quitou o documento').toBeGreaterThan(0)
    expect(Number(parcial!.total_amount), 'encargo do atraso não foi realizado').toBeGreaterThan(500)
    expect(parcial!.status).toBe('open')
  })

  test('não oferece editar nem excluir cobrança emitida', async ({ page }) => {
    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })

    // Documento emitido é imutável (Princípio 5) e nunca é apagado (Princípio 3).
    await expect(row.getByTitle('Editar')).toHaveCount(0)
    await expect(row.getByTitle('Excluir')).toHaveCount(0)
  })

  test('baixa por inadimplência reconhece a perda e sai de contas a receber', async ({ page }) => {
    const supabase = getSupabaseAdmin()
    const antes = await chargeBalance(customerId)

    await page.goto('/cobrancas')
    await waitForPageLoad(page)

    const row = page.locator('tr', { hasText: DESCRIPTION }).first()
    await row.getByTitle(/baixa por inadimplência/i).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    await modal.getByLabel('Motivo').fill(`${TEST_TAG} Cliente inadimplente`)
    await modal.getByRole('button', { name: /dar baixa/i }).click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    const depois = await chargeBalance(customerId)
    expect(depois!.status).toBe('written_off')

    // A perda vira lançamento: o recebível é creditado contra a conta de perda.
    const { data: entries } = await supabase
      .from('financial_entries')
      .select('account_code, direction, amount')
      .eq('charge_id', antes!.charge_id)

    const rows = (entries ?? []) as { account_code: string; direction: string; amount: number }[]
    const perda = rows.find((e) => e.account_code === 'perda_inadimplencia')

    expect(perda).toBeDefined()
    expect(perda!.direction).toBe('debit')
    // O saldo EM ABERTO, não o total: o que já foi recebido não é perda.
    expect(Number(perda!.amount)).toBeCloseTo(Number(antes!.open_amount), 2)

    // A BAIXA em si não realiza encargo novo: dar por perdido não é receber, e
    // reconhecer receita para logo perdê-la infla receita e perda ao mesmo
    // tempo. O encargo que aparece na cobrança veio do pagamento parcial
    // anterior — por isso a asserção olha a transação da baixa, não a cobrança.
    const { data: daBaixa } = await supabase
      .from('financial_entries')
      .select('account_code, financial_transactions!inner(event_type)')
      .eq('charge_id', antes!.charge_id)
      .eq('financial_transactions.event_type', 'charge_written_off')

    const contas = ((daBaixa ?? []) as { account_code: string }[]).map((e) => e.account_code).sort()
    expect(contas, 'a baixa lançou em conta inesperada').toEqual(
      ['contas_a_receber', 'perda_inadimplencia'],
    )
  })

  test('todo lançamento gerado fecha em zero', async () => {
    const supabase = getSupabaseAdmin()

    // Invariante do Princípio 1, verificada sobre os dados que este spec criou.
    const { data } = await supabase
      .from('financial_entries')
      .select('transaction_id, amount_signed')
      .eq('customer_id', customerId)

    const porTransacao = new Map<string, number>()
    for (const e of (data ?? []) as { transaction_id: string; amount_signed: number }[]) {
      porTransacao.set(e.transaction_id, (porTransacao.get(e.transaction_id) ?? 0) + Number(e.amount_signed))
    }

    for (const [tx, saldo] of porTransacao) {
      expect(Math.round(saldo * 100) / 100, `transação ${tx} não fecha`).toBe(0)
    }
  })
})
