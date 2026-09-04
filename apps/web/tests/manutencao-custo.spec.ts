import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { registerCost, checkMaintenanceDeletable } from '../src/lib/financial/maintenance-cost'
import { cancelPayable } from '../src/lib/financial/payables'
import { createCharge } from '../src/lib/financial/charges'
import { receivePayment } from '../src/lib/financial/payments'

/** A Server Action é casca fina sobre isto; o serviço é o que tem a regra. */
const registerMaintenanceCost = async (input: unknown) =>
  registerCost(getSupabaseAdmin(), await getTestTenantId(), null, input)

/**
 * Custo de manutenção — o buraco que a ADR 0024 deixou aberto.
 *
 * `maintenances.cost` e `effective_customer_payer_pct` saíram na migration
 * `operational_cleanup`: custo e rateio passaram a viver no payable, em valores,
 * porque percentual inteiro não representa 1/3 e deixa centavo sem dono (F-17).
 *
 * Só que nada tomou o lugar. A tela de manutenção continuou pedindo o custo e
 * jogando fora, e `despesa_manutencao` só recebia lançamento vindo de
 * /despesas — nunca da manutenção. Custo de manutenção era invisível no
 * resultado do veículo.
 */

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''
const manutencoes: string[] = []

async function criarManutencao(descricao: string): Promise<string> {
  const tenantId = await getTestTenantId()
  const { data, error } = await admin()
    .from('maintenances')
    .insert({
      tenant_id: tenantId, vehicle_id: vehicleId, type: 'corrective',
      description: descricao, scheduled_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (error) throw new Error(`Setup falhou: ${error.message}`)
  const id = (data as { id: string }).id
  manutencoes.push(id)
  return id
}

async function payableDaManutencao(maintenanceId: string) {
  const { data } = await admin()
    .from('payables')
    .select('id, amount, customer_amount, responsibility, expense_account_code, vehicle_id')
    .eq('source_module', 'maintenance')
    .eq('source_id', maintenanceId)
    .maybeSingle()
  return data as {
    id: string; amount: number; customer_amount: number
    responsibility: string; expense_account_code: string; vehicle_id: string | null
  } | null
}

test.describe('Manutenção — custo e rateio em valores', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    for (const id of manutencoes) await admin().from('maintenances').delete().eq('id', id)
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('custo da empresa entra no ledger e no resultado do veículo', async () => {
    const id = await criarManutencao(`${TEST_TAG} Troca de óleo ${RUN}`)

    const antes = await admin()
      .from('vehicle_financial_position')
      .select('gross_costs')
      .eq('vehicle_id', vehicleId)
      .maybeSingle()
    const custoAntes = Number((antes.data as { gross_costs: number } | null)?.gross_costs ?? 0)

    const res = await registerMaintenanceCost({
      maintenance_id: id, amount: 450, customer_amount: 0,
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(res.ok, res.ok ? '' : res.error.message).toBe(true)

    const p = await payableDaManutencao(id)
    expect(p, 'manutenção não gerou conta a pagar').not.toBeNull()
    expect(Number(p!.amount)).toBe(450)
    expect(p!.responsibility).toBe('company')
    expect(p!.expense_account_code).toBe('despesa_manutencao')
    expect(p!.vehicle_id).toBe(vehicleId)

    const { data: entries } = await admin()
      .from('financial_entries')
      .select('account_code, direction, amount, vehicle_id')
      .eq('payable_id', p!.id)

    const rows = (entries ?? []) as { account_code: string; direction: string; amount: number; vehicle_id: string | null }[]
    const despesa = rows.find((e) => e.account_code === 'despesa_manutencao')
    expect(despesa, 'custo não chegou ao ledger').toBeDefined()
    expect(despesa!.direction).toBe('debit')
    expect(despesa!.vehicle_id).toBe(vehicleId)

    const depois = await admin()
      .from('vehicle_financial_position')
      .select('gross_costs')
      .eq('vehicle_id', vehicleId)
      .maybeSingle()
    const custoDepois = Number((depois.data as { gross_costs: number } | null)?.gross_costs ?? 0)
    expect(custoDepois - custoAntes).toBe(450)
  })

  test('rateio de 1/3 fecha em valores, sem centavo perdido', async () => {
    // O caso que percentual inteiro não representa: 100/3 = 33,33%, e
    // 33% de 100 são 33,00 — sobra um centavo sem dono.
    const id = await criarManutencao(`${TEST_TAG} Pastilha de freio ${RUN}`)

    const res = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 33.34,
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(res.ok, res.ok ? '' : res.error.message).toBe(true)

    const p = await payableDaManutencao(id)
    expect(Number(p!.amount)).toBe(100)
    expect(Number(p!.customer_amount)).toBe(33.34)
    expect(p!.responsibility).toBe('shared')

    // Custo bruto e repasse ficam SEPARADOS: o custo da empresa não é abatido
    // pelo que o cliente devolve — os dois aparecem no resultado.
    const { data: charge } = await admin()
      .from('charges')
      .select('id')
      .eq('source_module', 'maintenance')
      .eq('source_id', id)
      .maybeSingle()

    expect(charge, 'rateio não gerou cobrança do cliente').not.toBeNull()

    const { data: itens } = await admin()
      .from('charge_items')
      .select('amount, credit_account_code')
      .eq('charge_id', (charge as { id: string }).id)

    const it = (itens ?? []) as { amount: number; credit_account_code: string }[]
    expect(Number(it[0]!.amount)).toBe(33.34)
    expect(it[0]!.credit_account_code).toBe('repasse_manutencao')
  })

  test('não repassa mais do que o custo, nem registra duas vezes', async () => {
    const id = await criarManutencao(`${TEST_TAG} Corrente ${RUN}`)

    const demais = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 150,
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(demais.ok).toBe(false)

    const ok = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 0,
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(ok.ok).toBe(true)

    // Segunda tentativa é recusada: custo já registrado não se duplica.
    const repetido = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 0,
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(repetido.ok, 'custo foi registrado duas vezes').toBe(false)
  })

  test('cliente executa custo da EMPRESA: crédito do valor que ele desembolsou', async () => {
    // A única forma legítima de o cliente ganhar crédito. Ele levou a moto à
    // oficina e pagou do bolso um custo que era da empresa — cobrar dele seria
    // exigir de volta um dinheiro que já saiu.
    //
    // O caso quebrava em silêncio: a regra olhava `customer_amount` (a parte
    // DELE), que aqui é zero, e concluía "nada a reembolsar". O reembolso é a
    // parte da EMPRESA, porque quem executou desembolsou o total.
    const tenantId = await getTestTenantId()
    const manutencao = await criarManutencao('Embreagem executada pelo cliente')

    const r = await registerCost(admin(), tenantId, null, {
      maintenance_id: manutencao,
      amount: 300,
      customer_amount: 0,      // custo 100% da empresa
      executor: 'customer',    // mas quem pagou a oficina foi o cliente
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
    if (!r.ok) return

    // Nenhuma cobrança contra quem já pagou.
    const { count: cobrancas } = await admin()
      .from('charges').select('id', { count: 'exact', head: true })
      .eq('source_module', 'maintenance').eq('source_id', manutencao)
    expect(cobrancas, 'cobrou de quem executou e pagou').toBe(0)

    const { data: credito } = await admin()
      .from('customer_credits')
      .select('id, amount, customer_id')
      .eq('payable_id', r.data.payable_id)
      .maybeSingle()

    expect(credito, 'cliente executou, pagou, e não recebeu crédito').not.toBeNull()
    expect(Number((credito as { amount: number }).amount), 'creditou valor diferente do desembolso').toBe(300)

    // E o crédito é utilizável: o saldo vem do razão.
    const { data: saldo } = await admin()
      .from('customer_credit_balances')
      .select('balance')
      .eq('customer_id', (credito as { customer_id: string }).customer_id)
      .maybeSingle()

    expect(
      Number((saldo as { balance: number } | null)?.balance ?? 0),
      'crédito concedido sem saldo utilizável',
    ).toBeGreaterThanOrEqual(300)

    // A empresa nunca deveu à oficina: quem pagou foi o cliente. O documento
    // nasce quitado e o razão não passa por contas a pagar.
    const { data: pay } = await admin()
      .from('payables').select('status, paid_at').eq('id', r.data.payable_id).single()
    expect((pay as { status: string }).status, 'conta a pagar de serviço que o cliente já pagou').toBe('paid')

    const { data: aPagar } = await admin()
      .from('financial_entries').select('amount')
      .eq('payable_id', r.data.payable_id).eq('account_code', 'contas_a_pagar')
    expect(aPagar, 'passivo com fornecedor que nunca existiu').toEqual([])
  })

  test('cliente executa rateado: crédito só da parte da empresa', async () => {
    // Custo 300, cabendo 100 ao cliente. Ele pagou os 300 → a empresa lhe deve
    // 200, não 100 e não 300.
    const tenantId = await getTestTenantId()
    const manutencao = await criarManutencao('Rateada executada pelo cliente')

    const r = await registerCost(admin(), tenantId, null, {
      maintenance_id: manutencao,
      amount: 300,
      customer_amount: 100,
      executor: 'customer',
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
    if (!r.ok) return

    const { data: credito } = await admin()
      .from('customer_credits').select('amount')
      .eq('payable_id', r.data.payable_id).maybeSingle()

    expect(
      Number((credito as { amount: number } | null)?.amount ?? 0),
      'creditou a parte errada do rateio',
    ).toBe(200)

    // Três pernas e nenhuma em contas a pagar: custo bruto 300, a parte do
    // cliente (100) reconhecida como recuperação porque ele a bancou, e 200 de
    // dívida com ele. Custo líquido da empresa = 200.
    const { data: pernas } = await admin()
      .from('financial_entries').select('account_code, direction, amount')
      .eq('payable_id', r.data.payable_id)

    const l = (pernas ?? []) as { account_code: string; direction: string; amount: number }[]
    const por = (c: string) => l.filter((e) => e.account_code === c)
      .reduce((s, e) => s + Number(e.amount), 0)

    expect(por('despesa_manutencao')).toBe(300)
    expect(por('repasse_manutencao'), 'parte bancada pelo cliente não virou recuperação').toBe(100)
    expect(por('creditos_de_clientes')).toBe(200)
    expect(por('contas_a_pagar'), 'passivo fantasma com a oficina').toBe(0)

    // A responsabilidade gravada continua sendo a parte do CLIENTE — é ela que
    // o DRE e o rateio usam. Só o valor reembolsado é que difere.
    const { data: payable } = await admin()
      .from('payables').select('customer_amount, responsibility')
      .eq('id', r.data.payable_id).single()

    const p = payable as { customer_amount: number; responsibility: string }
    expect(Number(p.customer_amount)).toBe(100)
    expect(p.responsibility).toBe('shared')
  })

  test('cliente executa custo que era DELE: nada a reembolsar', async () => {
    // Ele pagou o que devia. Creditar aqui seria devolver dinheiro do nada —
    // e era o que o meu próprio teste anterior afirmava.
    const tenantId = await getTestTenantId()
    const manutencao = await criarManutencao('Integral do cliente, executada por ele')

    const r = await registerCost(admin(), tenantId, null, {
      maintenance_id: manutencao,
      amount: 300,
      customer_amount: 300,
      executor: 'customer',
      due_date: new Date().toISOString().slice(0, 10),
    })
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
    if (!r.ok) return

    const { count: creditos } = await admin()
      .from('customer_credits').select('id', { count: 'exact', head: true })
      .eq('payable_id', r.data.payable_id)
    expect(creditos, 'creditou quem pagou apenas o que devia').toBe(0)

    const { count: cobrancas } = await admin()
      .from('charges').select('id', { count: 'exact', head: true })
      .eq('source_module', 'maintenance').eq('source_id', manutencao)
    expect(cobrancas, 'cobrou de quem já pagou').toBe(0)
  })
})


/**
 * Excluir a manutenção não pode deixar o dinheiro para trás.
 *
 * `deleteMaintenance` era um `delete` seco. Verificado na tela antes da
 * correção: apaguei uma manutenção paga pelo cliente e sobreviveram a conta a
 * pagar, o crédito de R$ 100 a favor dela e o lançamento no razão — a locadora
 * seguia devendo por um serviço que já não existia, e a despesa continuava no
 * DRE.
 *
 * A correção não inventa uma cascata de estorno: recusa e aponta o caminho que
 * já existe (`cancelPayable`), no mesmo espírito de "cobrança com pagamento não
 * se cancela, estorne o pagamento primeiro".
 */
test.describe('Exclusão de manutenção', () => {
  // Fixtures próprias. Este bloco vinha usando as do describe anterior, cujo
  // `afterAll` já apagou a locação — o que funcionava só porque veículo e
  // cliente sobrevivem à limpeza (têm manutenção apontando para eles) e nenhum
  // teste daqui precisava da locação. Passou a precisar.
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
    const contrato = await createTestContract(vehicleId)
    customerId = contrato.customerId
    rentalId = contrato.contractId
  })

  test.afterAll(async () => {
    for (const id of manutencoes) {
      await admin().from('payables').delete().eq('source_module', 'maintenance').eq('source_id', id)
      await admin().from('maintenances').delete().eq('id', id)
    }
    await admin().from('rentals').delete().eq('id', rentalId)
    await deleteTestCustomer(customerId).catch(() => {})
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('manutenção SEM custo pode ser excluída, e não há o que desfazer', async () => {
    const tenantId = await getTestTenantId()
    const id = await criarManutencao(`${TEST_TAG} Sem custo`)

    const r = await checkMaintenanceDeletable(admin(), tenantId, id)
    expect(r.ok).toBe(true)
    expect(r.ok === true && r.undoes, 'sem dinheiro envolvido não há aviso a dar').toBeNull()
  })

  test('com custo da EMPRESA: a exclusão avisa o que vai desfazer', async () => {
    const tenantId = await getTestTenantId()
    const id = await criarManutencao(`${TEST_TAG} Custo empresa`)

    await registerMaintenanceCost({
      maintenance_id: id, amount: 200, customer_amount: 0,
      executor: 'company', due_date: new Date().toISOString().slice(0, 10),
    })

    const r = await checkMaintenanceDeletable(admin(), tenantId, id)
    expect(r.ok, 'a exclusão deixou de ser recusada — ela cascateia').toBe(true)
    expect(r.ok === true && r.undoes?.amount).toBe(200)
  })

  test('cancelar desfaz custo, cobrança de repasse e crédito, e nada fica nas contas', async () => {
    // O ponto da ADR 0029: "valor pago pela empresa ou pelo cliente é cancelado
    // e não aparece em conta nenhuma". Aqui se prova conta a conta.
    const tenantId = await getTestTenantId()
    const id = await criarManutencao(`${TEST_TAG} Cascata ${RUN}`)

    const custo = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 50,
      executor: 'customer', due_date: new Date().toISOString().slice(0, 10),
    })
    expect(custo.ok, 'setup: o custo precisa ser lançado').toBe(true)
    const payableId = (custo as { data: { payable_id: string } }).data.payable_id

    const saldos = async () => {
      const { data } = await admin()
        .from('financial_entries')
        .select('account_code, amount_signed')
        .eq('payable_id', payableId)
      const por: Record<string, number> = {}
      for (const e of (data ?? []) as { account_code: string; amount_signed: number }[]) {
        por[e.account_code] = Math.round(((por[e.account_code] ?? 0) + Number(e.amount_signed)) * 100) / 100
      }
      return por
    }

    const antes = await saldos()
    expect(Object.keys(antes).length, 'setup: o razão precisa ter sido movido').toBeGreaterThan(0)

    await cancelPayable(admin(), tenantId, payableId, 'engano no lançamento')

    // Toda conta tocada volta a zero — não sobra custo no DRE nem crédito vivo.
    for (const [conta, saldo] of Object.entries(await saldos())) {
      expect(saldo, `${conta} não voltou a zero`).toBe(0)
    }

    const { data: pay } = await admin()
      .from('payables').select('status, paid_at').eq('id', payableId).single()
    expect((pay as { status: string }).status).toBe('cancelled')
    // O CHECK `payables_paid_has_date` exige status='paid' ⟺ paid_at não nulo.
    expect((pay as { paid_at: string | null }).paid_at, 'cancelada não pode seguir com data de pagamento').toBeNull()

    const { data: cred } = await admin()
      .from('customer_credits').select('cancelled_at').eq('payable_id', payableId).maybeSingle()
    expect((cred as { cancelled_at: string | null } | null)?.cancelled_at,
      'a concessão precisa aparecer como desfeita na ficha do cliente').not.toBeNull()

    const livre = await checkMaintenanceDeletable(admin(), tenantId, id)
    expect(livre.ok, 'com tudo desfeito a manutenção pode sair').toBe(true)
  })

  test('crédito já usado impede a exclusão', async () => {
    const tenantId = await getTestTenantId()
    const id = await criarManutencao(`${TEST_TAG} Credito gasto ${RUN}`)

    const custo = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 50,
      executor: 'customer', due_date: new Date().toISOString().slice(0, 10),
    })
    expect(custo.ok).toBe(true)

    // Gasta o crédito numa cobrança qualquer do mesmo cliente.
    const { chargeId } = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: new Date().toISOString().slice(0, 10),
      sourceModule: 'manual', sourceId: crypto.randomUUID(),
      items: [{
        description: `${TEST_TAG} Alvo do credito ${RUN}`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 80, amount: 80,
      }],
    })

    // O saldo de crédito é um POOL por cliente (não há seletor de crédito). O
    // que caracteriza "consumido" é o saldo não cobrir mais o valor concedido —
    // então gasta-se o saldo INTEIRO, não só os 50 desta manutenção.
    const { data: saldoRow } = await admin()
      .from('customer_credit_balances').select('balance').eq('customer_id', customerId).single()
    const saldo = Number((saldoRow as { balance: number }).balance)
    expect(saldo, 'setup: o crédito precisa existir').toBeGreaterThanOrEqual(50)

    const { error: abatimento } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: chargeId, p_amount: Math.min(saldo, 80), p_created_by: null,
    })
    expect(abatimento, 'setup: o abatimento precisa passar').toBeNull()

    const r = await checkMaintenanceDeletable(admin(), tenantId, id)
    expect(r.ok, 'o cliente já se beneficiou — não se apaga isso').toBe(false)
    expect(r.ok === false && r.message).toMatch(/já foi usado|devolvido/i)

    // E a guarda de verdade está no banco, não na checagem da tela.
    const payableId = (custo as { data: { payable_id: string } }).data.payable_id
    await expect(cancelPayable(admin(), tenantId, payableId, 'tentativa indevida'))
      .rejects.toThrow(/já foi usado|devolvido/i)
  })

  test('cobrança de repasse já paga exige o estorno primeiro', async () => {
    const tenantId = await getTestTenantId()
    const id = await criarManutencao(`${TEST_TAG} Repasse pago ${RUN}`)

    const custo = await registerMaintenanceCost({
      maintenance_id: id, amount: 100, customer_amount: 40,
      executor: 'company', due_date: new Date().toISOString().slice(0, 10),
    })
    expect(custo.ok).toBe(true)
    const payableId = (custo as { data: { payable_id: string } }).data.payable_id

    const { data: cobranca } = await admin()
      .from('charges').select('id')
      .eq('source_module', 'maintenance').eq('source_id', id).single()
    const chargeId = (cobranca as { id: string }).id

    await receivePayment(admin(), tenantId, {
      customerId, amount: 40, method: 'pix', paidAt: new Date(),
      allocations: [{ chargeId, amount: 40 }],
    })

    const r = await checkMaintenanceDeletable(admin(), tenantId, id)
    expect(r.ok, 'o cliente pagou — estornar é decisão dele, não efeito colateral').toBe(false)
    expect(r.ok === false && r.message).toMatch(/estorne o pagamento/i)

    await expect(cancelPayable(admin(), tenantId, payableId, 'tentativa indevida'))
      .rejects.toThrow(/estorne o pagamento/i)
  })
})
