/**
 * Estorno de pagamento — desfazer dinheiro que já entrou.
 *
 * `reversePaymentAction` existia exportada e sem nenhum chamador: não havia
 * botão, então o caminho nunca rodou. Sob essa ausência de uso moravam duas
 * falhas.
 *
 * A primeira era de ORDEM. O código marcava `payments.reversed_at`, depois
 * estornava o razão, depois reabria a cobrança — três escritas soltas. Falha no
 * meio deixava o pagamento constando estornado enquanto o razão seguia
 * mostrando o dinheiro recebido: a tela dizia uma coisa e a contabilidade
 * dizia outra.
 *
 * A segunda era ALCANÇÁVEL a partir da primeira. Abatimento por crédito do
 * cliente também cria linha em `payments`, mas lança `credit_applied`, não
 * `payment_received`; a busca filtrava pelo segundo e não achava nada, lançando
 * exceção *depois* de marcar o estorno. Estornar um abatimento por crédito
 * produzia exatamente o estado inconsistente acima.
 *
 * O que se testa aqui é a garantia inteira: o razão volta ao que era, o saldo
 * da cobrança volta a ser devido, o crédito volta para o cliente, o pagamento
 * não é apagado, e estornar duas vezes não passa.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { receivePayment, reversePayment, realizeAccruedBefore } from '../src/lib/financial/payments'
import { createPayable } from '../src/lib/financial/payables'
import { postTransaction, dimensionsOf } from '../src/lib/financial/ledger'

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''

/** Saldo derivado — nunca coluna. */
async function saldo(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances')
    .select('status, total_amount, paid_amount, open_amount')
    .eq('charge_id', chargeId)
    .single()
  return data as { status: string; total_amount: number; paid_amount: number; open_amount: number }
}

/** Soma líquida de uma conta para este cliente — o que o razão enxerga. */
async function saldoConta(code: string, cliente = customerId): Promise<number> {
  const { data } = await admin()
    .from('financial_entries')
    .select('amount_signed')
    .eq('account_code', code)
    .eq('customer_id', cliente)
  return Number(
    (data ?? [])
      .reduce((s, e) => s + Number((e as { amount_signed: number }).amount_signed), 0)
      .toFixed(2),
  )
}

async function novaCobranca(valor: number, diasAtras = 0, cliente = customerId) {
  const tenantId = await getTestTenantId()
  const vencimento = new Date(Date.now() - diasAtras * 864e5).toISOString().slice(0, 10)
  const { chargeId } = await createCharge(admin(), tenantId, {
    customerId: cliente,
    rentalId,
    dueDate: vencimento,
    sourceModule: 'manual',
    sourceId: crypto.randomUUID(),
    items: [{
      description: `${TEST_TAG} Aluguel ${RUN}`,
      credit_account_code: 'receita_locacao',
      quantity: 1, unit_amount: valor, amount: valor,
    }],
  })
  return chargeId
}

test.describe('Estorno de pagamento', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('desfaz o recebimento: caixa volta, dívida volta, pagamento fica registrado', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(500)

    const caixaAntes = await saldoConta('caixa_e_bancos')

    const { paymentId } = await receivePayment(admin(), tenantId, {
      customerId,
      amount: 500,
      method: 'pix',
      paidAt: new Date(),
      allocations: [{ chargeId, amount: 500 }],
    })

    const pago = await saldo(chargeId)
    expect(pago.paid_amount, 'setup: a cobrança precisa estar quitada').toBe(500)
    expect(pago.open_amount).toBe(0)
    expect(await saldoConta('caixa_e_bancos')).toBe(Number((caixaAntes + 500).toFixed(2)))

    await reversePayment(admin(), tenantId, paymentId, 'Chargeback do banco')

    // 1. O saldo volta a ser devido.
    const depois = await saldo(chargeId)
    expect(depois.open_amount, 'a dívida precisa voltar por inteiro').toBe(500)
    expect(depois.status, 'cobrança estornada volta a ficar em aberto').toBe('open')

    // 2. O caixa volta ao que era — sem sobra nem falta.
    expect(
      await saldoConta('caixa_e_bancos'),
      'dinheiro estornado continuou no caixa',
    ).toBe(caixaAntes)

    // 3. O pagamento NÃO é apagado (Princípio 3): fica com data e motivo.
    const { data: pagamento } = await admin()
      .from('payments')
      .select('id, reversed_at, reversal_reason')
      .eq('id', paymentId)
      .single()

    const p = pagamento as { reversed_at: string | null; reversal_reason: string | null }
    expect(p.reversed_at, 'estorno apagou o pagamento em vez de marcá-lo').not.toBeNull()
    expect(p.reversal_reason).toBe('Chargeback do banco')

    // 4. O estorno aponta para o que ele desfaz. Sem o vínculo, ninguém
    //    reconstrói a correção lendo o razão.
    const { data: estorno } = await admin()
      .from('financial_transactions')
      .select('id, reverses_transaction_id')
      .eq('source_id', paymentId)
      .eq('event_type', 'payment_reversed')

    const e = (estorno ?? []) as { reverses_transaction_id: string | null }[]
    expect(e.length, 'nenhuma transação de estorno foi gerada').toBe(1)
    expect(e[0]!.reverses_transaction_id, 'estorno sem vínculo com a original').not.toBeNull()
  })

  test('estornar duas vezes não passa — e a segunda tentativa não move nada', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(300)

    const { paymentId } = await receivePayment(admin(), tenantId, {
      customerId, amount: 300, method: 'cash', paidAt: new Date(),
      allocations: [{ chargeId, amount: 300 }],
    })

    await reversePayment(admin(), tenantId, paymentId, 'Primeiro estorno')

    const caixaApos1 = await saldoConta('caixa_e_bancos')
    const saldoApos1 = await saldo(chargeId)

    await expect(
      reversePayment(admin(), tenantId, paymentId, 'Segundo estorno'),
      'estorno repetido precisa ser recusado',
    ).rejects.toThrow(/já estornado/i)

    // O importante não é a exceção, é que ela não deixou rastro: um segundo
    // estorno aceito devolveria o dinheiro duas vezes.
    expect(await saldoConta('caixa_e_bancos'), 'segunda tentativa mexeu no caixa').toBe(caixaApos1)
    expect((await saldo(chargeId)).open_amount).toBe(saldoApos1.open_amount)
  })

  test('estorno de abatimento por crédito devolve o crédito ao cliente', async () => {
    const tenantId = await getTestTenantId()

    // Crédito concedido pelo caminho do produto: cliente pagou uma despesa que
    // era da empresa.
    const hoje = new Date().toISOString().slice(0, 10)

    await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} Cliente adiantou custo da empresa ${RUN}`,
      expenseAccountCode: 'despesa_manutencao',
      competenceDate: hoje,
      dueDate: hoje,
      amount: 200,
      responsibility: 'company',
      customerId,
      customerAmount: 0,
      reimbursementAmount: 200,
      reimbursement: 'credit',
      paidBy: 'customer',
      vehicleId,
      rentalId,
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
    })

    const creditoAntes = await saldoConta('creditos_de_clientes')
    expect(creditoAntes, 'setup: o crédito precisa existir').toBeLessThan(0)

    const chargeId = await novaCobranca(200)

    // Abatimento por crédito cria linha em `payments` com method 'credit' e
    // lança `credit_applied` — não `payment_received`. Era aqui que o estorno
    // quebrava.
    const { data: pagamento } = await admin()
      .from('payments')
      .insert({
        tenant_id: tenantId, customer_id: customerId, amount: 200,
        method: 'credit', paid_at: new Date().toISOString(),
        notes: 'Abatimento por crédito do cliente',
      })
      .select('id')
      .single()

    const paymentId = (pagamento as { id: string }).id

    await admin().from('payment_allocations').insert({
      tenant_id: tenantId, payment_id: paymentId, charge_id: chargeId, amount: 200,
    })

    await postTransaction(admin(), tenantId, {
      event: {
        type: 'credit_applied',
        amount: 200,
        dimensions: dimensionsOf({ customerId, chargeId }),
      },
      description: 'Crédito abatido — cobrança em aberto',
      sourceModule: 'payment',
      sourceId: paymentId,
    })

    expect((await saldo(chargeId)).open_amount, 'setup: o crédito precisa ter quitado').toBe(0)
    const creditoConsumido = await saldoConta('creditos_de_clientes')
    expect(creditoConsumido, 'o abatimento precisa ter consumido o crédito')
      .toBe(Number((creditoAntes + 200).toFixed(2)))

    // O estorno não pode lançar exceção aqui — era o defeito.
    await reversePayment(admin(), tenantId, paymentId, 'Abatimento aplicado na cobrança errada')

    expect(
      await saldoConta('creditos_de_clientes'),
      'o crédito precisa voltar para o saldo do cliente',
    ).toBe(creditoAntes)

    expect(
      (await saldo(chargeId)).open_amount,
      'a cobrança precisa voltar a dever',
    ).toBe(200)
  })

  test('pagamento que quita duas cobranças estorna as duas, cada uma contra a sua origem', async () => {
    const tenantId = await getTestTenantId()
    const c1 = await novaCobranca(150)
    const c2 = await novaCobranca(250)

    const { paymentId } = await receivePayment(admin(), tenantId, {
      customerId, amount: 400, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId: c1, amount: 150 }, { chargeId: c2, amount: 250 }],
    })

    expect((await saldo(c1)).open_amount).toBe(0)
    expect((await saldo(c2)).open_amount).toBe(0)

    await reversePayment(admin(), tenantId, paymentId, 'Pagamento em duplicidade')

    expect((await saldo(c1)).open_amount, 'a primeira cobrança não voltou a dever').toBe(150)
    expect((await saldo(c2)).open_amount, 'a segunda cobrança não voltou a dever').toBe(250)

    // Duas origens distintas, dois estornos, cada um amarrado ao seu.
    // `reverses_transaction_id` é ÚNICO: se os dois apontassem para a mesma
    // transação, o segundo lançamento seria recusado pelo banco e o estorno
    // ficaria pela metade.
    const { data: estornos } = await admin()
      .from('financial_transactions')
      .select('id, reverses_transaction_id')
      .eq('source_id', paymentId)
      .eq('event_type', 'payment_reversed')

    const es = (estornos ?? []) as { reverses_transaction_id: string | null }[]
    expect(es.length, 'cada cobrança quitada precisa do seu estorno').toBe(2)
    expect(new Set(es.map(x => x.reverses_transaction_id)).size, 'dois estornos para a mesma origem').toBe(2)
  })

  test('estorno parcial de cobrança com dois pagamentos preserva o outro', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(500)

    const { paymentId: p1 } = await receivePayment(admin(), tenantId, {
      customerId, amount: 200, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: 200 }],
    })
    await receivePayment(admin(), tenantId, {
      customerId, amount: 300, method: 'cash', paidAt: new Date(),
      allocations: [{ chargeId, amount: 300 }],
    })

    expect((await saldo(chargeId)).open_amount, 'setup: quitada em dois pagamentos').toBe(0)

    await reversePayment(admin(), tenantId, p1, 'Primeiro pagamento não compensou')

    // Volta a dever SÓ o que foi estornado. Estornar um pagamento não pode
    // arrastar o outro junto.
    const depois = await saldo(chargeId)
    expect(depois.open_amount, 'estorno de um pagamento derrubou o outro').toBe(200)
    expect(depois.paid_amount, 'o pagamento que ficou precisa continuar valendo').toBe(300)
  })

  test('a tela oferece o estorno e mostra o pagamento como estornado', async ({ page }) => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(320)

    await receivePayment(admin(), tenantId, {
      customerId, amount: 320, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: 320 }],
    })

    await page.goto(`/cobrancas/${chargeId}`)
    await page.waitForLoadState('networkidle')

    // O botão não existia: a action estava pronta e sem chamador.
    const botao = page.getByRole('button', { name: /^estornar$/i }).first()
    await expect(botao, 'a tela precisa oferecer o estorno').toBeVisible({ timeout: 15_000 })
    await botao.click()

    const modal = page.locator('div.fixed.inset-0').filter({ has: page.locator(':visible') }).last()
    await expect(modal).toBeVisible()
    await modal.locator('textarea').fill('Cliente contestou a cobrança')
    await modal.getByRole('button', { name: /^estornar$/i }).click()

    // Esperar o MODAL FECHAR, não o texto aparecer: `getByText` casa substring
    // sem diferenciar maiúsculas, e o próprio modal explica que o pagamento
    // "fica registrado como estornado". A asserção passava instantaneamente,
    // com o modal aberto, antes de a Server Action ter rodado — e só então o
    // saldo era lido, ainda zerado. Teste verde pelo motivo errado.
    await expect(modal, 'o modal só fecha quando o estorno conclui').toBeHidden({ timeout: 15_000 })

    // A linha do pagamento passa a exibir a situação, na célula de ações.
    await expect(
      page.locator('td', { hasText: /^Estornado$/ }).first(),
    ).toBeVisible({ timeout: 15_000 })

    expect(
      (await saldo(chargeId)).open_amount,
      'estorno pela tela não devolveu a dívida',
    ).toBe(320)
  })
})

/**
 * Dinheiro que não cabe na dívida não entra.
 *
 * `receivePayment` calculava `unallocated` — o que sobrava depois de alocar —
 * devolvia no retorno e nenhum chamador lia. A linha em `payments` gravava o
 * valor cheio e o razão recebia só as alocações: a diferença existia na tabela
 * de pagamentos e em lugar nenhum do razão.
 *
 * Verificado na tela: R$ 50.000.000,00 aceitos numa cobrança de R$ 500,00, sem
 * mensagem, deixando R$ 49.999.500,00 órfãos. O caixa deixava de ser a soma dos
 * lançamentos — a invariante central do módulo.
 */
test.describe('Pagamento acima do saldo', () => {
  // Fixtures próprias: o `afterAll` do bloco anterior apaga cliente e veículo,
  // e as variáveis de módulo passam a apontar para linhas que já não existem.
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('recusa e não grava nada', async () => {
    const tenantId = await getTestTenantId()
    const charge = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: new Date().toISOString().slice(0, 10),
      sourceModule: 'manual',
      items: [{
        description: `${TEST_TAG} Acima do saldo`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 500, amount: 500,
      }],
    })

    const caixaAntes = await saldoConta('caixa_e_bancos')
    const { count: pagamentosAntes } = await admin()
      .from('payments').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)

    await expect(receivePayment(admin(), tenantId, {
      customerId, amount: 50_000_000, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId: charge.chargeId, amount: 500 }],
    })).rejects.toThrow(/acima do saldo/i)

    // Nada gravado: nem pagamento, nem lançamento.
    const { count: pagamentosDepois } = await admin()
      .from('payments').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
    expect(pagamentosDepois, 'gravou o pagamento mesmo recusando').toBe(pagamentosAntes)
    expect(await saldoConta('caixa_e_bancos'), 'o caixa se moveu').toBe(caixaAntes)

    const s = await saldo(charge.chargeId)
    expect(s.open_amount, 'a cobrança foi tocada').toBe(500)
  })

  test('recusa também quando ninguém informa a alocação', async () => {
    // Sem alocação explícita o valor é espalhado pelas cobranças abertas. O que
    // sobrar depois disso também não pode entrar.
    const tenantId = await getTestTenantId()
    const charge = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: new Date().toISOString().slice(0, 10),
      sourceModule: 'manual',
      items: [{
        description: `${TEST_TAG} Sem alocacao`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 120, amount: 120,
      }],
    })

    const caixaAntes = await saldoConta('caixa_e_bancos')

    await expect(receivePayment(admin(), tenantId, {
      customerId, amount: 999_999, method: 'pix', paidAt: new Date(),
    })).rejects.toThrow(/saldo/i)

    expect(await saldoConta('caixa_e_bancos')).toBe(caixaAntes)
    expect((await saldo(charge.chargeId)).open_amount).toBe(120)
  })

  test('valor exato e valor menor continuam passando', async () => {
    const tenantId = await getTestTenantId()
    const charge = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: new Date().toISOString().slice(0, 10),
      sourceModule: 'manual',
      items: [{
        description: `${TEST_TAG} Parcial e exato`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 300, amount: 300,
      }],
    })

    // Parcial: a cobrança segue em aberto pelo restante.
    await receivePayment(admin(), tenantId, {
      customerId, amount: 100, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId: charge.chargeId, amount: 100 }],
    })
    expect((await saldo(charge.chargeId)).open_amount).toBe(200)

    // Exato sobre o que restou: quita.
    await receivePayment(admin(), tenantId, {
      customerId, amount: 200, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId: charge.chargeId, amount: 200 }],
    })
    const s = await saldo(charge.chargeId)
    expect(s.open_amount).toBe(0)
    expect(s.status).toBe('paid')
  })
})

// ---------------------------------------------------------------------------
// Portão da ADR 0028: encargo realizado não vira base de encargo novo
// ---------------------------------------------------------------------------

/**
 * O estorno reabre a cobrança — e o encargo já realizado FICA, como item.
 * `fn_reverse_payment` inverte as pernas da transação do PAGAMENTO; a
 * `late_charge_realized` é outra transação e continua de pé, corretamente: o
 * atraso aconteceu, e desfazer o recebimento não desfaz os dias.
 *
 * O defeito estava na apuração seguinte, que usava `open_amount` cru — agora
 * inflado pelo próprio encargo. Cobrava multa de novo (o grosso do erro) e
 * juros sobre juros. Uma cobrança de R$ 100 vencida há 22 dias saía de R$
 * 102,73 para R$ 105,53 sem que um dia passasse.
 *
 * O estorno é só a porta mais visível: pagamento parcial chega ao mesmo estado
 * sem estorno nenhum, e o segundo teste cobre isso.
 */
test.describe('Encargo já realizado (ADR 0028)', () => {
  test('estornar e receber de novo não cobra a multa duas vezes', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(100, 22)

    // 1. Realiza o encargo e quita. Alocação explícita para o teste não depender
    //    das outras cobranças abertas deste cliente.
    await realizeAccruedBefore(admin(), tenantId, [chargeId], new Date())

    const depoisDoPagamento = await saldo(chargeId)
    const encargoRealizado = Number((depoisDoPagamento.total_amount - 100).toFixed(2))
    expect(encargoRealizado, 'o encargo precisa ter sido realizado').toBeGreaterThan(0)

    const primeiro = await receivePayment(admin(), tenantId, {
      customerId, amount: depoisDoPagamento.open_amount, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: depoisDoPagamento.open_amount }],
    })
    expect((await saldo(chargeId)).status, 'o recebimento precisa quitar').toBe('paid')

    // 2. Estorno: a cobrança volta a dever, com o item de encargo dentro.
    await reversePayment(admin(), tenantId, primeiro.paymentId, 'teste ADR 0028')

    const reaberta = await saldo(chargeId)
    expect(reaberta.status, 'o estorno reabre a cobrança').toBe('open')
    expect(reaberta.total_amount, 'o item de encargo não some no estorno')
      .toBeCloseTo(depoisDoPagamento.total_amount, 2)

    // 3. Recebe de novo, NO MESMO DIA. Nenhum dia novo passou, então nada pode
    //    ser acrescentado: o total tem de ficar onde estava.
    await receivePayment(admin(), tenantId, {
      customerId, amount: reaberta.open_amount, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: reaberta.open_amount }],
    })

    const final = await saldo(chargeId)
    expect(
      final.total_amount,
      'o segundo recebimento cobrou encargo de novo — multa em duplicidade e juros sobre juros',
    ).toBeCloseTo(depoisDoPagamento.total_amount, 2)

    // E um só item de encargo, não dois.
    const { data: itens } = await admin()
      .from('charge_items').select('id')
      .eq('charge_id', chargeId).eq('source_module', 'late_charge')
    expect((itens ?? []).length, 'o encargo virou item duas vezes').toBe(1)
  })

  test('pagamento parcial chega ao mesmo estado, e também não remultiplica', async () => {
    const tenantId = await getTestTenantId()
    const chargeId = await novaCobranca(100, 22)

    // Paga metade: o encargo é realizado sobre os 100 e a cobrança fica aberta
    // com o item dentro — sem estorno nenhum.
    await receivePayment(admin(), tenantId, {
      customerId, amount: 50, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: 50 }],
    })

    const parcial = await saldo(chargeId)
    const encargo = Number((parcial.total_amount - 100).toFixed(2))
    expect(encargo, 'o encargo precisa ter sido realizado').toBeGreaterThan(0)
    expect(parcial.status).toBe('open')

    // Quita o resto no mesmo dia: o corrente sobre o principal que sobrou é
    // MENOR que o já lançado, então nada se acrescenta.
    await receivePayment(admin(), tenantId, {
      customerId, amount: parcial.open_amount, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: parcial.open_amount }],
    })

    const final = await saldo(chargeId)
    expect(final.total_amount, 'a segunda parcela trouxe uma segunda multa')
      .toBeCloseTo(parcial.total_amount, 2)
    expect(final.status).toBe('paid')

    const { data: itens } = await admin()
      .from('charge_items').select('id')
      .eq('charge_id', chargeId).eq('source_module', 'late_charge')
    expect((itens ?? []).length, 'o encargo virou item duas vezes').toBe(1)
  })
})
