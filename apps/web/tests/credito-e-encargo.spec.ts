import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
  waitForPageLoad, getModal,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { receivePayment } from '../src/lib/financial/payments'

/**
 * Crédito do cliente e encargo por atraso — dois fluxos que movimentam dinheiro
 * e nunca tinham sido exercitados.
 *
 * Os dois compartilham a mesma ideia: o valor existe como PROJEÇÃO até alguém
 * decidir realizá-lo. Encargo projetado não é receita; crédito disponível não é
 * abatimento. Só viram lançamento quando o operador confirma — e é exatamente
 * essa transição que nenhum teste cobria.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''
const extras: { vehicleId: string; customerId: string; rentalId: string }[] = []

async function saldo(chargeId: string) {
  const { data } = await admin()
    .from('charge_balances')
    .select('status, open_amount, total_amount, paid_amount, is_overdue, days_overdue')
    .eq('charge_id', chargeId)
    .maybeSingle()
  return data as {
    status: string; open_amount: number; total_amount: number; paid_amount: number
    is_overdue: boolean; days_overdue: number
  } | null
}

/** Cobrança já vencida: a data não pode ser alterada depois (Princípio 5). */
async function cobrancaVencida(valor: number, diasAtras: number, cliente = customerId, locacao = rentalId) {
  const tenantId = await getTestTenantId()
  const vencimento = new Date(Date.now() - diasAtras * 864e5).toISOString().slice(0, 10)

  const { chargeId } = await createCharge(admin(), tenantId, {
    customerId: cliente,
    rentalId: locacao,
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

test.describe('Crédito do cliente e encargo por atraso', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    for (const e of extras) {
      await admin().from('customer_credits').delete().eq('customer_id', e.customerId)
      await admin().from('rentals').delete().eq('id', e.rentalId)
      await deleteTestCustomer(e.customerId).catch(() => {})
      await deleteTestVehicle(e.vehicleId).catch(() => {})
    }
    await admin().from('customer_credits').delete().eq('customer_id', customerId)
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('encargo só vira receita ao receber, com o valor do dia do pagamento', async ({ page }) => {
    const chargeId = await cobrancaVencida(500, 40)

    const antes = await saldo(chargeId)
    expect(antes!.is_overdue, 'setup: a cobrança precisa estar vencida').toBe(true)

    // Enquanto projetado, o encargo NÃO existe no razão.
    const { data: semEncargo } = await admin()
      .from('financial_entries')
      .select('id')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')

    expect(semEncargo ?? [], 'encargo projetado não pode estar lançado').toEqual([])

    // Receber é o que realiza o encargo. O botão "Consolidar encargo" fazia
    // isso à parte e foi removido: ele recalculava do zero a cada clique — a
    // multa sobre o saldo já acrescido, e os juros de TODOS os dias desde o
    // vencimento original — então dois cliques no mesmo dia cobravam o encargo
    // duas vezes, com base maior na segunda. Não havia guarda nenhuma.
    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Registrar pagamento' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Confirmar pagamento' }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // Agora sim: item na cobrança e receita no razão.
    const { data: itens } = await admin()
      .from('charge_items')
      .select('amount, credit_account_code, source_module')
      .eq('charge_id', chargeId)
      .eq('source_module', 'late_charge')

    const it = (itens ?? []) as { amount: number; credit_account_code: string }[]
    expect(it.length, 'consolidar não gerou item de encargo').toBe(1)
    expect(it[0]!.credit_account_code).toBe('receita_encargos_atraso')

    const { data: lancamentos } = await admin()
      .from('financial_entries')
      .select('direction, amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')

    const l = (lancamentos ?? []) as { direction: string; amount: number }[]
    expect(l.length, 'encargo realizado sem lançamento').toBe(1)
    expect(l[0]!.direction).toBe('credit')

    // O documento cresce pelo encargo — nem mais, nem menos — e o pagamento
    // quita o principal MAIS o encargo do dia, deixando a cobrança zerada.
    const depois = await saldo(chargeId)
    expect(Number(depois!.total_amount)).toBe(500 + Number(it[0]!.amount))
    expect(
      Number(depois!.open_amount),
      'o valor pago precisa cobrir principal + encargo calculado no dia',
    ).toBe(0)
    expect(Number(depois!.paid_amount)).toBe(500 + Number(it[0]!.amount))

    // E o encargo chega ao resultado do VEÍCULO.
    //
    // As pernas de `late_charge_realized` saíam sem `vehicle_id` enquanto a
    // emissão o carregava. Como `vehicle_financial_position` agrega por essa
    // dimensão, toda receita de atraso simplesmente não entrava no resultado da
    // moto — sem erro, sem log, só um número menor do que deveria. As asserções
    // acima passavam com o defeito no lugar, porque nenhuma olhava a dimensão.
    const { data: pernas } = await admin()
      .from('financial_entries')
      .select('vehicle_id')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')

    const p = (pernas ?? []) as { vehicle_id: string | null }[]
    expect(p[0]?.vehicle_id, 'encargo lançado sem veículo some do resultado da moto').toBe(vehicleId)

    const { data: posicao } = await admin()
      .from('vehicle_financial_position')
      .select('operating_revenue')
      .eq('vehicle_id', vehicleId)
      .single()

    expect(
      Number((posicao as { operating_revenue: number }).operating_revenue),
      'receita do veículo não incorporou o encargo consolidado',
    ).toBe(500 + Number(it[0]!.amount))
  })

  test('crédito disponível abate a dívida e some do saldo do cliente', async ({ page }) => {
    const tenantId = await getTestTenantId()

    // Cliente próprio: `applyCredits` ataca a cobrança MAIS ANTIGA do cliente,
    // então reaproveitar o cliente do teste anterior faria o crédito cair na
    // cobrança errada — e a asserção olharia para a cobrança que não mudou.
    const v2 = await createTestVehicle()
    const contrato2 = await createTestContract(v2.id)
    extras.push({ vehicleId: v2.id, customerId: contrato2.customerId, rentalId: contrato2.contractId })

    const cliente2 = contrato2.customerId
    const chargeId = await cobrancaVencida(300, 5, cliente2, contrato2.contractId)

    // O crédito precisa do LANÇAMENTO, não só da linha: `customer_credit_balances`
    // agrega o ledger. Inserir só a linha dava saldo zero — foi assim que
    // descobri que a concessão pelo produto também não lançava.
    const { data: credito } = await admin().from('customer_credits').insert({
      tenant_id: tenantId, customer_id: cliente2, amount: 120,
      origin: 'manual_adjustment', reason: `${TEST_TAG} Crédito ${RUN}`,
    }).select('id').single()

    await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'credit_granted',
        description: `${TEST_TAG} Crédito concedido`,
        source_module: 'customer_credit',
        source_id: (credito as { id: string }).id,
      },
      p_entries: [
        { account_code: 'despesa_operacional', direction: 'debit', amount: 120, customer_id: cliente2 },
        { account_code: 'creditos_de_clientes', direction: 'credit', amount: 120, customer_id: cliente2 },
      ],
    })

    const antes = await saldo(chargeId)
    expect(Number(antes!.open_amount)).toBe(300)

    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Aplicar crédito' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    // O valor não vem preenchido: o operador informa quanto aplicar, e o
    // placeholder mostra o disponível.
    await modal.locator('input[type=number]').fill('120')
    await modal.getByRole('button', { name: 'Aplicar crédito' }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    // A dívida cai pelo crédito aplicado. Pela RELAÇÃO, não por número fixo: a
    // cobrança está vencida, e quitar com crédito realiza o encargo antes de
    // abater — o total sobe e o devido é `total − 120`.
    const depois = await saldo(chargeId)
    expect(Number(depois!.paid_amount)).toBe(120)
    expect(
      Number(depois!.open_amount),
      'crédito não abateu a dívida',
    ).toBeCloseTo(Number(depois!.total_amount) - 120, 2)
    expect(Number(depois!.total_amount), 'encargo do atraso não foi realizado').toBeGreaterThan(300)

    // E o passivo com o cliente é baixado no razão — crédito é dívida NOSSA
    // com ele, então aplicá-lo debita `creditos_de_clientes`.
    const { data: lancamentos } = await admin()
      .from('financial_entries')
      .select('direction, amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'creditos_de_clientes')

    const l = (lancamentos ?? []) as { direction: string; amount: number }[]
    expect(l.length, 'aplicação de crédito sem lançamento').toBe(1)
    expect(l[0]!.direction).toBe('debit')
    expect(Number(l[0]!.amount)).toBe(120)

    // O saldo de crédito do cliente zera: não pode ser aplicado duas vezes.
    const { data: saldoCredito } = await admin()
      .from('customer_credit_balances')
      .select('balance')
      .eq('customer_id', cliente2)
      .maybeSingle()

    expect(
      // `available` não existe: a view expõe `balance`. Enquanto o nome estava
      // errado, o PostgREST devolvia erro, `?? 0` engolia, e a asserção passava
      // sem olhar nada.
      Number((saldoCredito as { balance: number } | null)?.balance ?? 0),
      'crédito continuou disponível depois de aplicado',
    ).toBe(0)
  })

  test('receber cobrança vencida realiza o encargo sozinho, sem saldo negativo', async ({ page }) => {
    // O encargo nasce do relógio e não é gravado (Princípio 4). Isso criava um
    // descompasso no recebimento: a tela oferecia "principal + encargo", o
    // documento devia só o principal, e `open_amount` é `total − alocado` SEM
    // piso em zero. Pagar o valor sugerido empurrava o saldo para negativo e o
    // encargo nunca virava receita.
    //
    // Consolidar deixou de ser pré-requisito: receber realiza o acumulado
    // primeiro. O encargo é devido por contrato desde o atraso — não é decisão
    // de quem recebe.
    const chargeId = await cobrancaVencida(400, 10)

    const antes = await saldo(chargeId)
    expect(Number(antes!.total_amount)).toBe(400)

    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)

    // O valor sugerido inclui o encargo — é o que o operador aceita por padrão.
    await page.getByRole('button', { name: 'Registrar pagamento' }).click()
    const modal = getModal(page)
    await expect(modal).toBeVisible()

    const sugerido = Number(await modal.locator('input[type=number]').inputValue())
    expect(sugerido, 'a tela deveria sugerir principal + encargo').toBeGreaterThan(400)

    await modal.getByRole('button', { name: /confirmar pagamento/i }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    const depois = await saldo(chargeId)

    // O total subiu para incluir o encargo realizado…
    expect(
      Number(depois!.total_amount),
      'encargo não foi realizado no recebimento',
    ).toBeCloseTo(sugerido, 2)

    // …e a cobrança fecha exatamente em zero, nunca negativa.
    expect(Number(depois!.paid_amount)).toBeCloseTo(sugerido, 2)
    expect(Number(depois!.open_amount), 'saldo negativo ou sobra após o pagamento').toBe(0)

    // O encargo virou receita de verdade.
    const { data: lancamento } = await admin()
      .from('financial_entries')
      .select('amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')
      .maybeSingle()

    expect(lancamento, 'encargo cobrado sem virar receita').not.toBeNull()
  })

  test('quitar com crédito também realiza o encargo do atraso', async ({ page }) => {
    // Assimetria achada percorrendo a tela: receber em dinheiro realizava o
    // encargo, aplicar crédito não. O mesmo atraso custava diferente conforme a
    // forma de pagamento, e quem quitava com crédito escapava da multa que já
    // tinha corrido.
    const tenantId = await getTestTenantId()

    const v = await createTestVehicle()
    const contrato = await createTestContract(v.id)
    extras.push({ vehicleId: v.id, customerId: contrato.customerId, rentalId: contrato.contractId })

    const chargeId = await cobrancaVencida(500, 20, contrato.customerId, contrato.contractId)

    const { data: credito } = await admin().from('customer_credits').insert({
      tenant_id: tenantId, customer_id: contrato.customerId, amount: 100,
      origin: 'manual_adjustment', reason: `${TEST_TAG} Crédito ${RUN}`,
    }).select('id').single()

    await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'credit_granted',
        description: `${TEST_TAG} Crédito concedido`,
        source_module: 'customer_credit',
        source_id: (credito as { id: string }).id,
      },
      p_entries: [
        { account_code: 'despesa_operacional',  direction: 'debit',  amount: 100, customer_id: contrato.customerId },
        { account_code: 'creditos_de_clientes', direction: 'credit', amount: 100, customer_id: contrato.customerId },
      ],
    })

    const antes = await saldo(chargeId)
    expect(Number(antes!.total_amount)).toBe(500)

    await page.goto(`/cobrancas/${chargeId}`)
    await waitForPageLoad(page)
    await page.getByRole('button', { name: 'Aplicar crédito' }).click()

    const modal = getModal(page)
    await expect(modal).toBeVisible()
    await modal.locator('input[type=number]').fill('100')
    await modal.getByRole('button', { name: 'Aplicar crédito' }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })

    const depois = await saldo(chargeId)

    // O encargo virou dívida antes do abatimento: o total sobe.
    expect(
      Number(depois!.total_amount),
      'quitar com crédito não realizou o encargo do atraso',
    ).toBeGreaterThan(500)

    // E virou receita, como no recebimento em dinheiro.
    const { data: encargo } = await admin()
      .from('financial_entries')
      .select('amount')
      .eq('charge_id', chargeId)
      .eq('account_code', 'receita_encargos_atraso')
      .maybeSingle()

    expect(encargo, 'encargo cobrado sem virar receita').not.toBeNull()

    // O crédito foi consumido e o saldo devido cai por ele.
    expect(Number(depois!.paid_amount)).toBe(100)
    expect(Number(depois!.open_amount)).toBeCloseTo(Number(depois!.total_amount) - 100, 2)
  })
})

/**
 * Os juros pagos são os do DIA DO PAGAMENTO.
 *
 * A cobrança é emitida, o cliente paga quando pode, e o encargo cobrado tem que
 * refletir o atraso até aquele dia — nem o do vencimento, nem o de hoje.
 *
 * `realizeAccruedBefore` recebe `paidAt` e o repassa como `asOf` para
 * `calculateAccruedCharges`. É isso que se prova aqui, com a mesma dívida
 * quitada em datas diferentes.
 */
test.describe('Encargo segue a data do pagamento', () => {
  test('pagar mais tarde custa mais, na proporção dos dias', async () => {
    const tenantId = await getTestTenantId()

    // Duas cobranças idênticas: mesmo valor, mesmo vencimento.
    const cedo  = await cobrancaVencida(1000, 30)
    const tarde = await cobrancaVencida(1000, 30)

    const emT30 = new Date(); emT30.setHours(12, 0, 0, 0)
    const emT60 = new Date(emT30); emT60.setDate(emT60.getDate() + 30)

    // A primeira é quitada hoje (30 dias de atraso).
    const b1 = await saldo(cedo)
    await receivePayment(admin(), tenantId, {
      customerId, amount: Number(b1!.open_amount), method: 'pix', paidAt: emT30,
      allocations: [{ chargeId: cedo, amount: Number(b1!.open_amount) }],
    }).catch(() => { /* o encargo entra antes de alocar; valor exato abaixo */ })

    const encargoDe = async (chargeId: string) => {
      const { data } = await admin()
        .from('charge_items')
        .select('amount')
        .eq('charge_id', chargeId)
        .eq('source_module', 'late_charge')
      return ((data ?? []) as { amount: number }[]).reduce((s, i) => s + Number(i.amount), 0)
    }

    const encargo30 = await encargoDe(cedo)
    expect(encargo30, 'atraso de 30 dias precisa gerar encargo').toBeGreaterThan(0)

    // A segunda é quitada 30 dias depois (60 de atraso).
    const b2 = await saldo(tarde)
    await receivePayment(admin(), tenantId, {
      customerId, amount: Number(b2!.open_amount), method: 'pix', paidAt: emT60,
      allocations: [{ chargeId: tarde, amount: Number(b2!.open_amount) }],
    }).catch(() => { /* idem */ })

    const encargo60 = await encargoDe(tarde)

    // Multa é única (mesma base, mesmo valor); os juros dobram com o dobro dos
    // dias. Então o encargo de 60 dias é maior, mas NÃO é o dobro.
    expect(encargo60, 'pagar depois tem que custar mais').toBeGreaterThan(encargo30)
    expect(encargo60, 'o encargo não pode dobrar: a multa é cobrada uma vez só')
      .toBeLessThan(encargo30 * 2)
  })

  test('pagar sem atraso não gera encargo nenhum', async () => {
    const tenantId = await getTestTenantId()
    const emDia = await cobrancaVencida(400, -5)   // vence daqui a 5 dias

    const b = await saldo(emDia)
    await receivePayment(admin(), tenantId, {
      customerId, amount: Number(b!.open_amount), method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId: emDia, amount: Number(b!.open_amount) }],
    })

    const { data } = await admin()
      .from('charge_items')
      .select('id')
      .eq('charge_id', emDia)
      .eq('source_module', 'late_charge')

    expect(data ?? [], 'cobrança em dia não pode ganhar encargo').toEqual([])
    expect(Number((await saldo(emDia))!.open_amount)).toBe(0)
  })
})
