/**
 * Alienação e valor de aquisição — os dois botões da tela de ROI do veículo.
 *
 * Nenhum dos dois tinha teste, e nenhum havia sido clicado. Dois defeitos
 * moravam aí:
 *
 * **A moto vendida continuava à venda.** `registerVehicleSale` gravava
 * `sale_value` e `sold_at` e deixava o status como estava. O enum tem `sold` e
 * nada o usava; `listAvailableVehicles` filtra por `status='available'`, então
 * a moto seguia no seletor de nova locação. Verificado na tela antes da
 * correção: uma moto vendida no mesmo minuto continuava sendo oferecida para
 * alugar. E como o status nunca mudava, nada impedia alienar uma moto que
 * estava com o cliente — `canChangeStatus` já respondia isso (RN-001) e a ação
 * simplesmente não perguntava.
 *
 * **Salvar sem salvar.** `updateAcquisitionValue` fazia `.update()` sem
 * `.select()`. No PostgREST, update que não encontra linha não é erro: devolve
 * sucesso com zero linhas afetadas. Um id de outro tenant respondia "salvo" e
 * não salvava nada.
 *
 * Valor de compra e de venda são dados de RELATÓRIO por decisão de produto —
 * não geram lançamento no razão. O que se testa aqui é que eles alimentam
 * `vehicle_asset_position` corretamente e que a frota reflete a venda.
 */

import { test, expect } from '@playwright/test'
import { getSupabaseAdmin, createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer } from './helpers'
import { registerSale, setAcquisitionValue } from '../src/lib/vehicles/asset'
import { getTestTenantId } from './helpers'

const admin = () => getSupabaseAdmin()
const hoje = () => new Date().toISOString().slice(0, 10)

let tenantId = ''
test.beforeAll(async () => { tenantId = await getTestTenantId() })

async function veiculo(id: string) {
  const { data } = await admin()
    .from('vehicles').select('status, acquisition_amount, sale_value, sold_at').eq('id', id).single()
  return data as {
    status: string; acquisition_amount: number | null
    sale_value: number | null; sold_at: string | null
  }
}

async function posicaoDoAtivo(id: string) {
  const { data } = await admin()
    .from('vehicle_asset_position')
    .select('acquisition_amount, sale_value, asset_result')
    .eq('vehicle_id', id)
    .maybeSingle()
  return data as { acquisition_amount: number | null; sale_value: number | null; asset_result: number | null } | null
}

test.describe('Alienação de veículo', () => {
  test('a moto vendida sai da frota disponível', async () => {
    const v = await createTestVehicle()
    await setAcquisitionValue(admin(), tenantId, { vehicleId: v.id, amount: 14500 })

    const antes = await veiculo(v.id)
    expect(antes.status).toBe('available')

    const r = await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 11000, soldAt: hoje() })
    expect(r.ok, r.ok ? '' : r.message).toBe(true)

    const depois = await veiculo(v.id)
    expect(depois.sale_value).toBe(11000)
    expect(depois.sold_at).toBe(hoje())
    // O ponto: sem isto ela continua sendo oferecida em /locacoes/nova.
    expect(depois.status, 'moto vendida continua na frota disponível').toBe('sold')

    // E some da lista que o formulário de locação consome.
    const { data: disponiveis } = await admin()
      .from('vehicles').select('id').eq('status', 'available').eq('id', v.id)
    expect(disponiveis ?? []).toHaveLength(0)

    await deleteTestVehicle(v.id)
  })

  test('o resultado do ativo sai da compra menos a venda', async () => {
    const v = await createTestVehicle()
    await setAcquisitionValue(admin(), tenantId, { vehicleId: v.id, amount: 14500 })
    await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 11000, soldAt: hoje() })

    const pos = await posicaoDoAtivo(v.id)
    expect(pos).not.toBeNull()
    expect(pos!.acquisition_amount).toBe(14500)
    expect(pos!.sale_value).toBe(11000)
    expect(pos!.asset_result, 'prejuízo de 3.500 na revenda').toBe(-3500)

    await deleteTestVehicle(v.id)
  })

  test('moto locada não pode ser alienada', async () => {
    const v = await createTestVehicle()
    const c = await createTestContract(v.id)

    // `createTestContract` insere em `rentals` direto; quem marca a moto como
    // `rented` é o RPC `fn_create_rental`, que o helper não usa. O estado que
    // importa aqui é o da moto, então ele é posto explicitamente.
    await admin().from('vehicles').update({ status: 'rented' }).eq('id', v.id)

    const alugada = await veiculo(v.id)
    expect(alugada.status).toBe('rented')

    const r = await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 9000, soldAt: hoje() })
    expect(r.ok, 'alienou uma moto que está com o cliente').toBe(false)
    expect(r.ok === false && r.message).toMatch(/locada/i)

    const depois = await veiculo(v.id)
    expect(depois.sale_value, 'gravou a venda mesmo recusando').toBeNull()
    expect(depois.status).toBe('rented')

    await deleteTestCustomer(c.customerId)
    await deleteTestVehicle(v.id)
  })

  test('alienar duas vezes é recusado', async () => {
    const v = await createTestVehicle()
    await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 8000, soldAt: hoje() })

    const r = await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 9999, soldAt: hoje() })
    expect(r.ok).toBe(false)

    const depois = await veiculo(v.id)
    expect(depois.sale_value, 'a segunda alienação sobrescreveu o valor').toBe(8000)

    await deleteTestVehicle(v.id)
  })

  test('valor de aquisição em veículo inexistente não responde "salvo"', async () => {
    const r = await setAcquisitionValue(admin(), tenantId, {
      vehicleId: '00000000-0000-4000-8000-000000000999',
      amount: 5000,
    })
    expect(r.ok, 'update sem linha afetada respondeu sucesso').toBe(false)
    expect(r.ok === false && r.code).toBe('NOT_FOUND')
  })

  test('corrigir o valor de aquisição atualiza o resultado do ativo', async () => {
    // Caminho de correção: o operador digitou errado e conserta depois. O
    // relatório precisa passar a ler o valor novo, não o primeiro.
    const v = await createTestVehicle()
    await setAcquisitionValue(admin(), tenantId, { vehicleId: v.id, amount: 20000 })
    await registerSale(admin(), tenantId, { vehicleId: v.id, saleValue: 11000, soldAt: hoje() })
    expect((await posicaoDoAtivo(v.id))!.asset_result).toBe(-9000)

    await setAcquisitionValue(admin(), tenantId, { vehicleId: v.id, amount: 14500 })
    expect((await posicaoDoAtivo(v.id))!.asset_result, 'o relatório ficou no valor antigo').toBe(-3500)

    await deleteTestVehicle(v.id)
  })
})
