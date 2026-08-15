import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
  waitForPageLoad,
} from './helpers'

/**
 * Multas — cadastro e a cobrança que ele gera (PRD 0013 + Spec 0014).
 *
 * Esta spec estava quebrada desde 03/07: procurava um modal e um campo
 * "Cliente" que o redesenho do cadastro substituiu por página dedicada e pela
 * cadeia Placa → Locação → Cliente. Ficou vermelha por mais de um mês sem
 * ninguém notar, e com ela o único teste do caminho multa → cobrança.
 *
 * O que ela cobre agora é justamente o que faltava: registrar a multa com
 * responsável = cliente **emite uma cobrança**, e trocar para empresa a
 * cancela. Nenhum teste verificava isso — o fluxo nunca tinha rodado sequer
 * uma vez neste banco.
 */

const RUN = Date.now().toString(36)
const DESCRICAO = `${TEST_TAG} Excesso de velocidade ${RUN}`
const VALOR = 293.47

const hoje = new Date().toISOString().slice(0, 10)
const vencimento = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

const admin = () => getSupabaseAdmin()

let vehicleId = ''
let customerId = ''
let rentalId = ''
let fineId = ''

/** Cobrança viva gerada por esta multa, se houver. */
async function cobrancaDaMulta() {
  const { data: item } = await admin()
    .from('charge_items')
    .select('charge_id, amount, vehicle_id')
    .eq('source_module', 'fine')
    .eq('source_id', fineId)
    .maybeSingle()

  const i = item as { charge_id: string; amount: number; vehicle_id: string | null } | null
  if (!i) return null

  const { data: balance } = await admin()
    .from('charge_balances')
    .select('charge_id, status, total_amount, customer_id')
    .eq('charge_id', i.charge_id)
    .maybeSingle()

  return {
    item: i,
    balance: balance as { status: string; total_amount: number; customer_id: string } | null,
  }
}

test.describe('Multas — cadastro e cobrança do cliente', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    // A cobrança só nasce se a placa levar a uma locação ativa, que é quem
    // determina o cliente responsável.
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    if (fineId) await admin().from('fines').delete().eq('id', fineId)
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('registrar multa do cliente emite a cobrança correspondente', async ({ page }) => {
    await page.goto('/multas/novo')
    await waitForPageLoad(page)

    await page.getByLabel('Placa *').selectOption(vehicleId)

    // A locação aparece só depois que a placa é escolhida.
    const locacao = page.getByLabel('Locação')
    await expect(locacao).toBeEnabled({ timeout: 10_000 })
    await locacao.selectOption(rentalId)

    // O cliente é DERIVADO da locação, de forma assíncrona. Sem esperar, o
    // submit é barrado por uma validação que existe justamente porque a
    // cobrança não pode ser gerada sem cliente identificado.
    // O campo Cliente é um painel de exibição, não um controle: espera-se o
    // texto trocar do placeholder para o nome resolvido.
    await expect(page.getByText('Selecione uma locação')).toHaveCount(0, { timeout: 10_000 })

    await page.getByLabel('Descrição da infração *').fill(DESCRICAO)
    await page.getByLabel('Data da infração *').fill(hoje)
    await page.getByLabel('Valor (R$) *').fill(String(VALOR))
    await page.getByLabel('Responsável pelo pagamento *').selectOption('customer')
    await page.getByLabel(/Data de vencimento/).fill(vencimento)

    // A página tem 'Registrar' no cabeçalho e no rodapé do formulário.
    await page.getByRole('button', { name: 'Registrar', exact: true }).first().click()
    await page.waitForURL((u) => new URL(u).pathname === '/multas', { timeout: 15_000 })

    const { data: fine } = await admin()
      .from('fines')
      .select('id, amount, responsible, vehicle_id')
      .eq('description', DESCRICAO)
      .maybeSingle()

    const f = fine as { id: string; amount: number; responsible: string; vehicle_id: string } | null
    expect(f, 'multa não foi criada').not.toBeNull()
    fineId = f!.id
    expect(Number(f!.amount)).toBe(VALOR)
    expect(f!.responsible).toBe('customer')

    // ── O que nenhum teste verificava ────────────────────────────────────────
    const cobranca = await cobrancaDaMulta()
    expect(cobranca, 'multa do cliente não gerou cobrança').not.toBeNull()
    expect(Number(cobranca!.item.amount)).toBe(VALOR)
    expect(cobranca!.balance?.status).toBe('open')
    expect(cobranca!.balance?.customer_id).toBe(customerId)

    // Sem o veículo, o repasse não aparece no resultado do veículo.
    expect(cobranca!.item.vehicle_id, 'cobrança de multa sem veículo').toBe(vehicleId)
  })

  test('a cobrança credita repasse, não receita de locação', async () => {
    // Multa repassada é RECUPERAÇÃO de despesa, não venda. Em qual linha do
    // resultado isso entra é política do tenant — mas a conta creditada tem
    // que distinguir os dois casos, senão a escolha some.
    const cobranca = await cobrancaDaMulta()
    expect(cobranca).not.toBeNull()

    const { data: item } = await admin()
      .from('charge_items')
      .select('credit_account_code')
      .eq('charge_id', cobranca!.item.charge_id)
      .single()

    expect((item as { credit_account_code: string }).credit_account_code).toBe('repasse_multa')

    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction, amount')
      .eq('charge_id', cobranca!.item.charge_id)

    const rows = (entries ?? []) as { account_code: string; direction: string; amount: number }[]
    expect(rows.length, 'cobrança de multa sem lançamento no ledger').toBeGreaterThan(0)

    const debito = rows.find((e) => e.direction === 'debit')
    const credito = rows.find((e) => e.direction === 'credit')
    expect(debito?.account_code).toBe('contas_a_receber')
    expect(credito?.account_code).toBe('repasse_multa')
  })

  test('passar a responsabilidade para a empresa cancela a cobrança', async ({ page }) => {
    await page.goto(`/multas/${fineId}/editar`)
    await waitForPageLoad(page)

    await page.getByLabel('Responsável pelo pagamento *').selectOption('company')
    await page.getByRole('button', { name: /salvar|atualizar/i }).first().click()
    await page.waitForURL((u) => new URL(u).pathname === '/multas', { timeout: 15_000 })

    const cobranca = await cobrancaDaMulta()
    expect(cobranca, 'a cobrança sumiu — deveria ser cancelada, não apagada').not.toBeNull()
    expect(cobranca!.balance?.status).toBe('cancelled')

    // Documento cancelado sai de contas a receber por estorno, não por exclusão.
    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction')
      .eq('charge_id', cobranca!.item.charge_id)

    const rows = (entries ?? []) as { account_code: string; direction: string }[]
    const creditosARecebe = rows.filter(
      (e) => e.account_code === 'contas_a_receber' && e.direction === 'credit',
    )
    expect(creditosARecebe.length, 'cancelamento não estornou o recebível').toBeGreaterThan(0)
  })
})
