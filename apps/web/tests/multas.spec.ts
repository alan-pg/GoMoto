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

  test('a multa do cliente também lança a despesa da empresa', async () => {
    // Quem responde ao órgão é a proprietária do veículo: a multa é despesa da
    // empresa mesmo quando o cliente é o responsável — ser "do cliente" muda
    // apenas que existe recuperação depois.
    //
    // Enquanto só o caso `company` lançava a despesa, uma multa repassada
    // creditava `repasse_multa` sem `despesa_multa` do outro lado, e o DRE
    // mostrava LUCRO no valor da multa. Recuperação sem custo é contradição no
    // próprio nome da conta.
    const { data: payable } = await admin()
      .from('payables')
      .select('id, amount, expense_account_code, responsibility, status')
      .eq('source_module', 'fine')
      .eq('source_id', fineId)
      .maybeSingle()

    const p = payable as {
      amount: number; expense_account_code: string; responsibility: string; status: string
    } | null

    expect(p, 'multa do cliente não lançou a despesa da empresa').not.toBeNull()
    expect(Number(p!.amount)).toBe(VALOR)
    expect(p!.expense_account_code).toBe('despesa_multa')
    expect(p!.status).toBe('open')

    // Custo e recuperação se anulam no resultado: a empresa desembolsa e
    // recebe de volta o mesmo valor.
    const { data: lancamentos } = await admin()
      .from('financial_entries')
      .select('account_code, amount_signed')
      .in('account_code', ['despesa_multa', 'repasse_multa'])
      .eq('vehicle_id', vehicleId)

    const soma = (lancamentos ?? []).reduce(
      (s, e) => s + Number((e as { amount_signed: number }).amount_signed), 0,
    )
    expect(Number(soma.toFixed(2)), 'multa repassada mexeu no resultado').toBe(0)
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

  test('multa da empresa vira despesa no ledger, não só um registro', async () => {
    // A migration que criou `fines.payable_id` dizia que responsabilidade e
    // rateio viveriam no payable — mas nada o criava. `despesa_multa` tinha
    // zero lançamentos, e multa paga pela empresa não aparecia no custo do
    // veículo nem no resultado.
    const { data: payable } = await admin()
      .from('payables')
      .select('id, amount, expense_account_code, status, vehicle_id')
      .eq('source_module', 'fine')
      .eq('source_id', fineId)
      .maybeSingle()

    const p = payable as {
      id: string; amount: number; expense_account_code: string
      status: string; vehicle_id: string | null
    } | null

    expect(p, 'multa da empresa não gerou conta a pagar').not.toBeNull()
    expect(Number(p!.amount)).toBe(VALOR)
    expect(p!.expense_account_code).toBe('despesa_multa')
    expect(p!.status).toBe('open')
    expect(p!.vehicle_id, 'sem veículo o custo some do resultado do veículo').toBe(vehicleId)

    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction, amount, vehicle_id')
      .eq('payable_id', p!.id)

    const rows = (entries ?? []) as {
      account_code: string; direction: string; amount: number; vehicle_id: string | null
    }[]

    const despesa = rows.find((e) => e.account_code === 'despesa_multa')
    expect(despesa, 'custo da multa não chegou ao ledger').toBeDefined()
    expect(despesa!.direction).toBe('debit')
    expect(Number(despesa!.amount)).toBe(VALOR)
    expect(despesa!.vehicle_id).toBe(vehicleId)

    const contrapartida = rows.find((e) => e.account_code === 'contas_a_pagar')
    expect(contrapartida?.direction).toBe('credit')

    // O estorno da cobrança cancelada precisa carregar as MESMAS dimensões da
    // emissão. Sem o veículo, a reversão fica fora da view (que exige
    // vehicle_id) enquanto a emissão permanece: o veículo aparecia recuperando
    // um valor cancelado, e o prejuízo real da empresa sumia.
    const { data: repasses } = await admin()
      .from('financial_entries')
      .select('direction, amount')
      .eq('account_code', 'repasse_multa')
      .eq('vehicle_id', vehicleId)

    const r = (repasses ?? []) as { direction: string; amount: number }[]
    const liquido = r.reduce((s, e) => s + (e.direction === 'credit' ? Number(e.amount) : -Number(e.amount)), 0)
    expect(liquido, 'repasse cancelado continua contando como recuperado').toBe(0)
  })
})
