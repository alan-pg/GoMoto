/**
 * Cancelamento e rateio — o que acontece com o razão quando se desfaz.
 *
 * Emitir tem cobertura farta. **Desfazer** não tinha, e é onde o dinheiro
 * escorre sem ninguém ver: um documento cancelado que continua lançado inflar
 * custo no DRE e mantém passivo que não existe mais.
 *
 * A simetria que se testa aqui é simples de enunciar e fácil de quebrar:
 * cancelar tem de estornar exatamente o que a criação lançou. Nem mais (senão
 * vira crédito do nada), nem menos (senão o custo fica).
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestCustomer, deleteTestCustomer,
} from './helpers'
import { createPayable } from '../src/lib/financial/payables'
import { createCharge } from '../src/lib/financial/charges'

const admin = () => getSupabaseAdmin()

let vehicleId = ''
let customerId = ''
const hoje = new Date().toISOString().slice(0, 10)

/** Contagem de linhas — o que sobra depois de uma falha. */
async function contar(tabela: string): Promise<number> {
  const { count } = await admin().from(tabela).select('id', { count: 'exact', head: true })
  return count ?? 0
}

/** Soma líquida de uma conta no razão — o que o DRE enxerga. */
async function saldoConta(code: string): Promise<number> {
  const { data } = await admin()
    .from('financial_entries')
    .select('amount_signed')
    .eq('account_code', code)
  return Number(
    (data ?? [])
      .reduce((s, e) => s + Number((e as { amount_signed: number }).amount_signed), 0)
      .toFixed(2),
  )
}

test.beforeAll(async () => {
  const v = await createTestVehicle()
  vehicleId = v.id
  const c = await createTestCustomer()
  customerId = c.id
})

test.afterAll(async () => {
  if (customerId) await deleteTestCustomer(customerId).catch(() => {})
  if (vehicleId) await deleteTestVehicle(vehicleId).catch(() => {})
})

test.describe('Cancelar despesa', () => {
  test('cancelar estorna o custo em vez de deixá-lo no resultado', async ({ page }) => {
    const despesaAntes = await saldoConta('despesa_operacional')
    const pagarAntes   = await saldoConta('contas_a_pagar')

    const { payableId } = await createPayable(admin(), await getTestTenantId(), {
      description: `${TEST_TAG} Despesa a cancelar`,
      expenseAccountCode: 'despesa_operacional',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 400,
      responsibility: 'company',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    expect(await saldoConta('despesa_operacional') - despesaAntes, 'a despesa não foi lançada').toBe(400)

    await page.goto('/despesas')
    await page.waitForLoadState('networkidle')

    const linha = page.locator('tr', { hasText: 'Despesa a cancelar' }).first()
    await expect(linha).toBeVisible({ timeout: 15_000 })
    // Cancelar é imediato: não há confirmação nesta tela.
    await linha.getByTitle(/cancelar/i).click()

    await expect.poll(async () => {
      const { data } = await admin().from('payables').select('status').eq('id', payableId).single()
      return (data as { status: string } | null)?.status
    }, { timeout: 15_000 }).toBe('cancelled')

    // O documento foi cancelado; o razão precisa acompanhar. Sem o estorno, o
    // custo continua no DRE e `contas_a_pagar` mostra dívida inexistente.
    expect(
      await saldoConta('despesa_operacional') - despesaAntes,
      'despesa cancelada continuou lançada — o custo fica no DRE para sempre',
    ).toBe(0)

    expect(
      await saldoConta('contas_a_pagar') - pagarAntes,
      'passivo de despesa cancelada não foi baixado',
    ).toBe(0)
  })

  test('cancelar despesa rateada também cancela a cobrança do cliente', async ({ page }) => {
    const { payableId, chargeId } = await createPayable(admin(), await getTestTenantId(), {
      description: `${TEST_TAG} Rateada a cancelar`,
      expenseAccountCode: 'despesa_operacional',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'shared',
      customerId,
      customerAmount: 100,
      reimbursement: 'charge',
      vehicleId,
      sourceModule: 'expense',
      // SEM `sourceId`, como a tela de despesas faz: despesa avulsa não tem
      // registro de origem, e a cobrança passa a usar o id do próprio payable.
      // Com origem injetada, o teste não exercitava o caminho real — e foi
      // assim que o cancelamento incompleto sobreviveu à suíte.
    })

    expect(chargeId, 'rateio não gerou cobrança do cliente').toBeTruthy()

    await page.goto('/despesas')
    await page.waitForLoadState('networkidle')

    const linha = page.locator('tr', { hasText: 'Rateada a cancelar' }).first()
    await expect(linha).toBeVisible({ timeout: 15_000 })
    // Cancelar é imediato: não há confirmação nesta tela.
    await linha.getByTitle(/cancelar/i).click()

    await expect.poll(async () => {
      const { data } = await admin().from('payables').select('status').eq('id', payableId).single()
      return (data as { status: string } | null)?.status
    }, { timeout: 15_000 }).toBe('cancelled')

    // A cobrança do repasse nasceu DA despesa. Cancelada a despesa, cobrar o
    // cliente por ela é cobrar por um custo que a empresa diz não ter tido.
    const { data: charge } = await admin()
      .from('charges').select('status').eq('id', chargeId!).single()

    expect(
      (charge as { status: string }).status,
      'despesa cancelada deixou a cobrança do cliente viva',
    ).toBe('cancelled')
  })
})

test.describe('Atomicidade da emissão', () => {
  test('falha no meio não deixa cobrança nem item para trás', async () => {
    const tenantId = await getTestTenantId()

    const antesCobrancas = await contar('charges')
    const antesItens     = await contar('charge_items')
    const antesEntradas  = await contar('financial_entries')

    // Conta inexistente: o INSERT do documento e dos itens passa, e o
    // lançamento quebra na FK do plano de contas. É exatamente o ponto em que
    // a versão anterior — três chamadas separadas ao PostgREST — deixava
    // cobrança órfã, porque cada chamada era a sua própria transação.
    const { error } = await admin().rpc('fn_create_charge', {
      p_tenant_id: tenantId,
      p_charge: {
        customer_id: customerId,
        due_date: hoje,
        source_module: 'manual',
        source_id: crypto.randomUUID(),
      },
      p_items: [{
        description: `${TEST_TAG} Item que não deve sobrar`,
        credit_account_code: 'conta_que_nao_existe',
        quantity: 1, unit_amount: 100, amount: 100,
      }],
    })

    expect(error, 'a conta inexistente foi aceita — o teste não prova nada').not.toBeNull()

    expect(await contar('charges'),           'cobrança sobrou depois da falha').toBe(antesCobrancas)
    expect(await contar('charge_items'),      'item sobrou depois da falha').toBe(antesItens)
    expect(await contar('financial_entries'), 'lançamento sobrou depois da falha').toBe(antesEntradas)
  })

  test('falha no repasse desfaz também a despesa', async () => {
    const tenantId = await getTestTenantId()

    const antesPayables = await contar('payables')
    const antesEntradas = await contar('financial_entries')

    // Rateio com cliente inexistente: a despesa é gravada e lançada, e a
    // cobrança de repasse quebra na FK do cliente. Antes isso deixava a empresa
    // com o custo registrado e o cliente nunca cobrado.
    const { error } = await admin().rpc('fn_create_payable', {
      p_tenant_id: tenantId,
      p_payable: {
        description: `${TEST_TAG} Rateio que não deve sobrar`,
        expense_account_code: 'despesa_operacional',
        competence_date: hoje,
        due_date: hoje,
        amount: 300,
        responsibility: 'shared',
        customer_id: '00000000-0000-0000-0000-0000000000ff',
        customer_amount: 100,
        reimbursement: 'charge',
        source_module: 'manual',
        source_id: crypto.randomUUID(),
      },
    })

    expect(error, 'o cliente inexistente foi aceito — o teste não prova nada').not.toBeNull()

    expect(await contar('payables'),          'conta a pagar sobrou depois da falha').toBe(antesPayables)
    expect(await contar('financial_entries'), 'lançamento de custo sobrou sem o repasse').toBe(antesEntradas)
  })
})

test.describe('Resultado por cliente', () => {
  test('separa custo bruto, repasse e o que a empresa absorveu', async ({ page }) => {
    const tenantId = await getTestTenantId()
    const { createTestCustomer: novoCliente } = await import('./helpers')
    const cliente = await novoCliente()

    // Receita de 1.000 e uma despesa rateada de 300, sendo 100 do cliente.
    // O que a empresa absorve são os 200 restantes — e é esse o número que
    // responde "este cliente dá lucro?". Somar o custo bruto responderia
    // outra pergunta.
    await createCharge(admin(), tenantId, {
      customerId: cliente.id,
      dueDate: hoje,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
      items: [{
        description: `${TEST_TAG} Aluguel`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 1000, amount: 1000,
      }],
    })

    await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} Manutenção rateada`,
      expenseAccountCode: 'despesa_manutencao',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'shared',
      customerId: cliente.id,
      customerAmount: 100,
      reimbursement: 'charge',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    const { data } = await admin()
      .from('customer_financial_position')
      .select('revenue, attributed_cost, reimbursed, absorbed_cost, net_result')
      .eq('customer_id', cliente.id)
      .single()

    const p = data as {
      revenue: number; attributed_cost: number; reimbursed: number
      absorbed_cost: number; net_result: number
    }

    expect(Number(p.revenue), 'receita do cliente').toBe(1000)
    // Custo chega positivo (débito), espelhando `vehicle_financial_position`.
    expect(Number(p.attributed_cost), 'custo bruto que passou pelo cliente').toBe(300)
    expect(Number(p.reimbursed), 'parte recuperada dele').toBe(100)
    expect(Number(p.absorbed_cost), 'o que a empresa absorveu').toBe(200)
    expect(Number(p.net_result), 'resultado do cliente').toBe(800)

    // E a tela mostra o mesmo número.
    await page.goto(`/clientes/${cliente.id}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Custo absorvido')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('R$ 800,00').first()).toBeVisible()

    await deleteTestCustomer(cliente.id).catch(() => {})
  })
})

test.describe('Quem pagou o fornecedor', () => {
  /**
   * `fn_create_payable` deduzia "o cliente desembolsou" de
   * `reimbursement = 'credit'`. Funciona enquanto sobra algo a devolver, e some
   * exatamente quando não sobra: custo 100% do cliente que ELE levou à oficina
   * e pagou. Nada muda de mão, o modo é 'none', e a função caía no ramo "a
   * empresa deve à oficina" — inventando despesa e passivo que nunca existiram,
   * numa conta que ficava `open` para sempre.
   *
   * O fato passou a ser explícito (`paid_by`). Os três casos abaixo cobrem as
   * combinações que o rateio produz; o do meio era o quebrado.
   */
  test('cliente paga custo que é todo dele: nada muda de mão e nada fica a pagar', async () => {
    const tenantId = await getTestTenantId()
    const cliente = await createTestCustomer()

    const contasAPagarAntes = await saldoConta('contas_a_pagar')

    const { payableId } = await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} Cliente executou e bancou o que era dele`,
      expenseAccountCode: 'despesa_manutencao',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'customer',
      customerId: cliente.id,
      customerAmount: 300,
      reimbursementAmount: 0,
      reimbursement: 'none',
      paidBy: 'customer',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    const { data: conta } = await admin()
      .from('payables').select('status, paid_at').eq('id', payableId).single()

    const c = conta as { status: string; paid_at: string | null }
    expect(c.status, 'a empresa nunca deveu à oficina — a conta nasce quitada').toBe('paid')
    expect(c.paid_at).not.toBeNull()

    // Nenhum passivo novo: `contas_a_pagar` não pode ter se mexido.
    expect(
      await saldoConta('contas_a_pagar'),
      'passivo fantasma com uma oficina que já foi paga pelo cliente',
    ).toBe(contasAPagarAntes)

    const { data: pernas } = await admin()
      .from('financial_entries')
      .select('account_code, amount_signed')
      .eq('payable_id', payableId)

    const legs = (pernas ?? []) as { account_code: string; amount_signed: number }[]
    const porConta = Object.fromEntries(legs.map(l => [l.account_code, Number(l.amount_signed)]))

    // Custo bruto visível (Princípio 7) contra a parte que ele bancou: líquido
    // zero para a empresa, sem passar por contas a pagar.
    expect(porConta['despesa_manutencao'], 'custo bruto some do resultado do veículo').toBe(300)
    expect(porConta['repasse_manutencao'], 'a parte bancada pelo cliente precisa recuperar a despesa').toBe(-300)
    expect(porConta['contas_a_pagar']).toBeUndefined()
    expect(
      legs.reduce((s, l) => s + Number(l.amount_signed), 0),
      'as pernas precisam fechar em zero',
    ).toBe(0)

    // E nenhum crédito: não há o que devolver a quem pagou o que já era dele.
    const { data: creditos } = await admin()
      .from('customer_credits').select('id').eq('payable_id', payableId)
    expect(creditos ?? [], 'crédito concedido sem nada a reembolsar').toEqual([])

    await deleteTestCustomer(cliente.id).catch(() => {})
  })

  test('cliente paga custo que é da empresa: nasce crédito do valor inteiro', async () => {
    const tenantId = await getTestTenantId()
    const cliente = await createTestCustomer()

    const { payableId } = await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} Cliente adiantou custo da empresa`,
      expenseAccountCode: 'despesa_manutencao',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'company',
      customerId: cliente.id,
      customerAmount: 0,
      reimbursementAmount: 300,
      reimbursement: 'credit',
      paidBy: 'customer',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    const { data: pernas } = await admin()
      .from('financial_entries')
      .select('account_code, amount_signed')
      .eq('payable_id', payableId)

    const porConta = Object.fromEntries(
      ((pernas ?? []) as { account_code: string; amount_signed: number }[])
        .map(l => [l.account_code, Number(l.amount_signed)]),
    )

    expect(porConta['despesa_manutencao']).toBe(300)
    expect(porConta['creditos_de_clientes'], 'a empresa passa a dever ao cliente').toBe(-300)
    expect(porConta['contas_a_pagar']).toBeUndefined()

    const { data: creditos } = await admin()
      .from('customer_credits').select('amount').eq('payable_id', payableId)
    const cr = (creditos ?? []) as { amount: number }[]
    expect(cr.length, 'quem adiantou dinheiro da empresa precisa ser ressarcido').toBe(1)
    expect(Number(cr[0]!.amount)).toBe(300)

    await deleteTestCustomer(cliente.id).catch(() => {})
  })

  test('empresa paga: o passivo com a oficina existe e a parte do cliente vira cobrança', async () => {
    const tenantId = await getTestTenantId()
    const cliente = await createTestCustomer()

    const { payableId, chargeId } = await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} Empresa pagou a oficina`,
      expenseAccountCode: 'despesa_manutencao',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 300,
      responsibility: 'shared',
      customerId: cliente.id,
      customerAmount: 100,
      reimbursement: 'charge',
      paidBy: 'company',
      vehicleId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    const { data: conta } = await admin()
      .from('payables').select('status').eq('id', payableId).single()
    expect((conta as { status: string }).status, 'a empresa ainda deve à oficina').toBe('open')

    const { data: pernas } = await admin()
      .from('financial_entries')
      .select('account_code, amount_signed')
      .eq('payable_id', payableId)

    const porConta = Object.fromEntries(
      ((pernas ?? []) as { account_code: string; amount_signed: number }[])
        .map(l => [l.account_code, Number(l.amount_signed)]),
    )
    expect(porConta['despesa_manutencao']).toBe(300)
    expect(porConta['contas_a_pagar']).toBe(-300)

    expect(chargeId, 'a parte do cliente precisa virar cobrança').toBeTruthy()

    await deleteTestCustomer(cliente.id).catch(() => {})
  })
})
