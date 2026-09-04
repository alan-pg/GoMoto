/**
 * Documentação do veículo e dados do ativo — as duas superfícies de relatório.
 *
 * Decisão do Alan (2026-08-17): compra e venda NÃO entram no razão — são dados
 * de relatório, e o que se exige deles é estarem estruturados. IPVA,
 * licenciamento e demais custos anuais precisam ser rastreáveis para responder
 * "quais veículos estão com a documentação em dia" e alimentar relatório.
 *
 * O que quebrava a primeira parte: havia DUAS colunas para o valor de aquisição.
 * O cadastro do veículo gravava `acquisition_amount`; as telas financeiras liam
 * `acquisition_value`, que ninguém preenchia. O operador informava o valor pago
 * e o relatório respondia "Aquisição —".
 *
 * A segunda parte não tinha como ser perguntada: para saber se o IPVA estava
 * pago era preciso juntar obrigação com conta a pagar na mão, em cada tela.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle,
} from './helpers'
import { createPayable } from '../src/lib/financial/payables'

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''

test.describe('Documentação e dados do ativo', () => {
  test.beforeAll(async () => {
    const v = await createTestVehicle()
    vehicleId = v.id
  })

  test.afterAll(async () => {
    await admin().from('vehicle_obligations').delete().eq('vehicle_id', vehicleId)
    await deleteTestVehicle(vehicleId).catch(() => {})
  })

  test('valor pago no cadastro é o mesmo que o relatório lê', async () => {
    // A duplicação era invisível a typecheck e a lint: dois nomes plausíveis,
    // um escrito e outro lido, cada um em uma tela.
    await admin()
      .from('vehicles')
      .update({ acquisition_amount: 14500, purchase_date: '2026-01-15' })
      .eq('id', vehicleId)

    const { data, error } = await admin()
      .from('vehicle_asset_position')
      .select('acquisition_amount, purchase_date, sale_value, is_sold, asset_result, net_result')
      .eq('vehicle_id', vehicleId)
      .single()

    expect(error, 'a superfície de relatório do ativo precisa existir').toBeNull()

    const p = data as {
      acquisition_amount: number; purchase_date: string; sale_value: number | null
      is_sold: boolean; asset_result: number; net_result: number
    }

    expect(Number(p.acquisition_amount), 'valor pago não chegou ao relatório').toBe(14500)
    expect(p.purchase_date).toBe('2026-01-15')
    expect(p.is_sold, 'veículo não vendido não pode constar como vendido').toBe(false)

    // Sem operação e sem venda, o ativo está no negativo pelo que custou.
    expect(Number(p.asset_result)).toBe(-14500)
  })

  test('veículo sem lançamento continua no relatório do ativo', async () => {
    // `vehicle_financial_position` só enxerga veículo COM lançamento. A moto
    // parada — comprada e ainda não locada — some dela, e é justamente a que
    // dói no caixa.
    const parada = await createTestVehicle()
    await admin().from('vehicles').update({ acquisition_amount: 9000 }).eq('id', parada.id)

    const { data: naPosicao } = await admin()
      .from('vehicle_financial_position')
      .select('vehicle_id')
      .eq('vehicle_id', parada.id)
      .maybeSingle()

    expect(naPosicao, 'premissa: sem lançamento, não aparece na posição operacional').toBeNull()

    const { data: noAtivo } = await admin()
      .from('vehicle_asset_position')
      .select('acquisition_amount, operating_revenue, asset_result')
      .eq('vehicle_id', parada.id)
      .maybeSingle()

    const a = noAtivo as { acquisition_amount: number; operating_revenue: number; asset_result: number } | null
    expect(a, 'moto parada sumiu do relatório de frota').not.toBeNull()
    expect(Number(a!.operating_revenue)).toBe(0)
    expect(Number(a!.asset_result)).toBe(-9000)

    await deleteTestVehicle(parada.id).catch(() => {})
  })

  test('sem valor de aquisição o resultado do ativo é indefinido, não zero', async () => {
    const semValor = await createTestVehicle()

    const { data } = await admin()
      .from('vehicle_asset_position')
      .select('acquisition_amount, asset_result')
      .eq('vehicle_id', semValor.id)
      .single()

    const p = data as { acquisition_amount: number | null; asset_result: number | null }
    expect(p.acquisition_amount).toBeNull()
    // Zero diria que a moto foi de graça e entraria nas somas do relatório.
    expect(p.asset_result, 'resultado sem custo conhecido precisa ser nulo').toBeNull()

    await deleteTestVehicle(semValor.id).catch(() => {})
  })

  test('IPVA vencido e DPVAT sem custo lançado reprovam a documentação', async () => {
    const tenantId = await getTestTenantId()
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10)

    // IPVA com custo lançado e vencido ontem.
    const { payableId } = await createPayable(admin(), tenantId, {
      description: `${TEST_TAG} IPVA 2026 ${RUN}`,
      expenseAccountCode: 'despesa_documentacao',
      competenceDate: ontem,
      dueDate: ontem,
      amount: 1200,
      responsibility: 'company',
      vehicleId,
      sourceModule: 'vehicle_obligation',
      sourceId: crypto.randomUUID(),
    })

    await admin().from('vehicle_obligations').insert([
      {
        tenant_id: tenantId, vehicle_id: vehicleId, type: 'ipva',
        reference_year: 2026, due_date: ontem, payable_id: payableId,
      },
      // DPVAT cadastrado e NUNCA lançado no contas a pagar: o silencioso. Some
      // de qualquer relatório que parta de despesa, porque despesa não existe.
      {
        tenant_id: tenantId, vehicle_id: vehicleId, type: 'dpvat',
        reference_year: 2026, due_date: ontem, payable_id: null,
      },
    ])

    const { data: obrigacoes } = await admin()
      .from('vehicle_obligation_status')
      .select('type, status, days_overdue')
      .eq('vehicle_id', vehicleId)
      .order('type')

    const o = (obrigacoes ?? []) as { type: string; status: string; days_overdue: number }[]
    expect(o.length).toBe(2)

    const dpvat = o.find(x => x.type === 'dpvat')!
    const ipva  = o.find(x => x.type === 'ipva')!

    expect(ipva.status, 'IPVA lançado, não pago e vencido').toBe('overdue')
    expect(Number(ipva.days_overdue)).toBe(1)
    expect(dpvat.status, 'obrigação sem custo lançado não é a mesma coisa que vencida').toBe('unbilled')

    const { data: rollup } = await admin()
      .from('vehicle_document_status')
      .select('overdue_count, unbilled_count, is_compliant, worst_days_overdue')
      .eq('vehicle_id', vehicleId)
      .single()

    const r = rollup as {
      overdue_count: number; unbilled_count: number
      is_compliant: boolean; worst_days_overdue: number
    }
    expect(Number(r.overdue_count)).toBe(1)
    expect(Number(r.unbilled_count)).toBe(1)
    expect(r.is_compliant, 'veículo com IPVA vencido não pode constar em dia').toBe(false)
  })

  test('pagar o IPVA muda a situação sem que nada seja gravado na obrigação', async () => {
    // A situação é derivada do payable e do relógio (Princípios 2 e 4). Se
    // fosse coluna, o veículo seguiria "vencido" até alguém rodar um job.
    const { data: antes } = await admin()
      .from('vehicle_obligation_status')
      .select('payable_id, status')
      .eq('vehicle_id', vehicleId)
      .eq('type', 'ipva')
      .single()

    const a = antes as { payable_id: string; status: string }
    expect(a.status).toBe('overdue')

    await admin()
      .from('payables')
      .update({ status: 'paid', paid_at: new Date().toISOString().slice(0, 10) })
      .eq('id', a.payable_id)

    const { data: depois } = await admin()
      .from('vehicle_obligation_status')
      .select('status, days_overdue')
      .eq('vehicle_id', vehicleId)
      .eq('type', 'ipva')
      .single()

    const d = depois as { status: string; days_overdue: number }
    expect(d.status, 'pagar a conta precisa refletir na documentação').toBe('paid')
    expect(Number(d.days_overdue), 'conta paga não acumula atraso').toBe(0)

    // Continua reprovado: o DPVAT segue sem custo lançado.
    const { data: rollup } = await admin()
      .from('vehicle_document_status')
      .select('is_compliant, overdue_count, unbilled_count')
      .eq('vehicle_id', vehicleId)
      .single()

    const r = rollup as { is_compliant: boolean; overdue_count: number; unbilled_count: number }
    expect(Number(r.overdue_count)).toBe(0)
    expect(Number(r.unbilled_count), 'o DPVAT esquecido não pode sumir').toBe(1)
    expect(r.is_compliant).toBe(false)
  })
})
