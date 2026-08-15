import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { registerCost } from '../src/lib/financial/maintenance-cost'

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
})
