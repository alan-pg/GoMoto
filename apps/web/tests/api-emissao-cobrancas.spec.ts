/**
 * `GET /api/cron/issue-charges` — disparo manual da emissão.
 *
 * A rota nunca tinha sido exercitada. Ela é a porta pela qual o operador emite
 * a carteira inteira fora de hora, protegida só por um segredo em cabeçalho, e
 * roda com `service_role` — sem RLS, para todos os tenants de uma vez.
 *
 * O handler não usa `cookies()`, então dá para invocá-lo diretamente com uma
 * `NextRequest` construída à mão. É mais honesto que bater no dev server: o
 * teste exercita o MESMO código que a Vercel chama, e controla o ambiente
 * (`CRON_SECRET` presente ou ausente) sem reiniciar nada.
 *
 * O que precisa estar certo:
 *
 * 1. **Sem segredo configurado a rota não pode ficar aberta.** Emissão para
 *    todos os tenants não é algo que se deixe alcançável por engano.
 * 2. **Token errado é 401**, e nada é emitido.
 * 3. **Rodar duas vezes não emite a mesma parcela duas vezes.** É a garantia
 *    mais cara desta rota: cobrança duplicada é dívida que o cliente não deve,
 *    e ela nasce visível e pagável. A idempotência mora em
 *    `issue_due_charges`, que só enxerga agenda `scheduled` e a marca `issued`
 *    sob `FOR UPDATE`.
 * 4. **Documento e razão nascem juntos.** Foi o modo de falha mais sério do
 *    redesenho — cobrança existindo sem nunca ter entrado em contas a receber.
 */

import { test, expect } from '@playwright/test'
import { NextRequest } from 'next/server'
import { GET } from '../src/app/api/cron/issue-charges/route'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'

const admin = () => getSupabaseAdmin()
const SEGREDO = 'segredo-de-teste-do-cron'

let vehicleId = ''
let customerId = ''
let rentalId = ''
let tenantId = ''

function requisicao(authorization?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/issue-charges', {
    headers: authorization ? { Authorization: authorization } : {},
  })
}

/** Agenda uma parcela vencendo hoje — o que a emissão deve pegar. */
let proximaParcela = 0
async function agendarParcela(valor: number) {
  // Data LOCAL, não `toISOString` (que é UTC). A emissão filtra por
  // `fn_business_today()` — o dia do operador —, então das 21h à meia-noite a
  // data em UTC já é a de amanhã e a parcela ficava fora da janela.
  const agora = new Date()
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`
    + `-${String(agora.getDate()).padStart(2, '0')}`
  const { data, error } = await admin()
    .from('rental_billing_schedules')
    .insert({
      tenant_id: tenantId, rental_id: rentalId,
      sequence_number: ++proximaParcela,
      period_start: hoje, period_end: hoje, due_date: hoje,
      amount: valor, status: 'scheduled',
    })
    .select('id')
    .single()
  if (error) throw new Error(`agenda: ${error.message}`)
  return (data as { id: string }).id
}

async function cobrancasDaAgenda(scheduleId: string) {
  const { data } = await admin()
    .from('charges')
    .select('id, charge_number')
    .eq('source_module', 'rental')
    .eq('source_id', scheduleId)
  return (data ?? []) as { id: string; charge_number: number }[]
}

test.beforeAll(async () => {
  tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const c = await createTestContract(vehicleId)
  customerId = c.customerId
  rentalId = c.contractId
})

test.afterAll(async () => {
  delete process.env.CRON_SECRET
  await deleteTestCustomer(customerId)
  await deleteTestVehicle(vehicleId)
})

test.describe('Disparo manual da emissão', () => {
  test('sem CRON_SECRET a rota não emite nada — ela se recusa a existir', async () => {
    delete process.env.CRON_SECRET

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))
    const body = await res.json()

    // O importante não é o código, é que emissão para TODOS os tenants não
    // fica alcançável quando o ambiente está incompleto.
    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
  })

  test('token errado, ausente ou vazio é recusado', async () => {
    process.env.CRON_SECRET = SEGREDO

    for (const header of [undefined, '', 'Bearer errado', SEGREDO, 'Basic ' + SEGREDO]) {
      const res = await GET(requisicao(header))
      expect(res.status, `aceitou Authorization=${JSON.stringify(header)}`).toBe(401)
    }
  })

  test('emite a parcela agendada e lança no razão na mesma transação', async () => {
    process.env.CRON_SECRET = SEGREDO
    const scheduleId = await agendarParcela(450)

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const cobrancas = await cobrancasDaAgenda(scheduleId)
    expect(cobrancas, 'a parcela agendada não virou cobrança').toHaveLength(1)

    // A agenda precisa sair de `scheduled`, senão a próxima execução reemite.
    const { data: agenda } = await admin()
      .from('rental_billing_schedules').select('status').eq('id', scheduleId).single()
    expect((agenda as { status: string }).status).toBe('issued')

    // Documento e razão são a mesma transação: cobrança sem contrapartida em
    // contas a receber é dívida invisível para a contabilidade.
    const { data: entradas } = await admin()
      .from('financial_entries')
      .select('amount_signed, account_code')
      .eq('charge_id', cobrancas[0].id)
      .eq('account_code', 'contas_a_receber')

    const receber = ((entradas ?? []) as { amount_signed: number }[])
      .reduce((s, e) => s + Number(e.amount_signed), 0)
    expect(receber, 'cobrança emitida sem entrar em contas a receber').toBe(450)
  })

  test('rodar DUAS vezes não emite a mesma parcela duas vezes', async () => {
    process.env.CRON_SECRET = SEGREDO
    const scheduleId = await agendarParcela(320)

    await GET(requisicao(`Bearer ${SEGREDO}`))
    await GET(requisicao(`Bearer ${SEGREDO}`))
    await GET(requisicao(`Bearer ${SEGREDO}`))

    const cobrancas = await cobrancasDaAgenda(scheduleId)
    expect(cobrancas, 'a mesma parcela virou cobrança mais de uma vez').toHaveLength(1)

    const { data: entradas } = await admin()
      .from('financial_entries')
      .select('amount_signed')
      .eq('charge_id', cobrancas[0].id)
      .eq('account_code', 'contas_a_receber')

    const receber = ((entradas ?? []) as { amount_signed: number }[])
      .reduce((s, e) => s + Number(e.amount_signed), 0)
    expect(receber, 'o razão recebeu a emissão em duplicidade').toBe(320)
  })

  test('duas execuções SIMULTÂNEAS também não duplicam', async () => {
    // `issue_due_charges` lê a agenda com `FOR UPDATE OF s`: a segunda execução
    // espera a primeira e reavalia a linha, que já não é `scheduled`.
    process.env.CRON_SECRET = SEGREDO
    const scheduleId = await agendarParcela(275)

    await Promise.all([
      GET(requisicao(`Bearer ${SEGREDO}`)),
      GET(requisicao(`Bearer ${SEGREDO}`)),
    ])

    const cobrancas = await cobrancasDaAgenda(scheduleId)
    expect(cobrancas, 'execuções concorrentes duplicaram a cobrança').toHaveLength(1)
  })

  test('a resposta relata quantas cobranças saíram', async () => {
    process.env.CRON_SECRET = SEGREDO
    await agendarParcela(199)

    const res = await GET(requisicao(`Bearer ${SEGREDO}`))
    const body = await res.json()

    expect(body.data.run_id, 'sem run_id não há como auditar a execução').toBeTruthy()
    expect(body.data.tenants).toBeGreaterThan(0)
    expect(body.data.issued, 'relatou zero emitidas tendo emitido').toBeGreaterThan(0)
    expect(body.data.failed).toBe(0)
    void TEST_TAG
  })
})
