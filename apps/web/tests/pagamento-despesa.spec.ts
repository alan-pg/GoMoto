/**
 * Baixa de despesa — dinheiro saindo do caixa.
 *
 * `payPayable` não tinha um único teste, e `payable_paid` não tinha uma única
 * linha no banco: o caminho existia e nunca havia rodado. Sob isso mora o
 * padrão que já apareceu várias vezes neste módulo — ler, decidir, escrever,
 * em passos soltos:
 *
 *     if (p.status === 'paid') throw ...      ← lê e decide
 *     await supabase.from('payables').update(...)  ← escreve o status
 *     await postTransaction(...)              ← escreve o razão
 *
 * Duas execuções simultâneas leem `open` antes de qualquer uma escrever, e as
 * duas seguem: o dinheiro sai do caixa duas vezes pela mesma conta. Dois
 * cliques no botão, duas abas, ou a mesma requisição reenviada bastam. E se a
 * segunda escrita falhar, a despesa consta paga sem o razão ter visto o caixa
 * sair.
 *
 * O que se prova aqui: a baixa lança as duas pernas certas com as dimensões
 * preservadas, o caixa sai UMA vez por mais que se tente, e conta cancelada ou
 * já quitada não é pagável.
 */

import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createPayable, payPayable, cancelPayable } from '../src/lib/financial/payables'

const admin = () => getSupabaseAdmin()
const RUN = Date.now().toString(36)

let vehicleId = ''
let customerId = ''
let rentalId = ''
let tenantId = ''

const hoje = () => new Date().toISOString().slice(0, 10)

/**
 * Tudo que o razão registrou sobre esta conta a pagar.
 *
 * A pergunta é pela DIMENSÃO `payable_id`, não pelo `source_id` da transação:
 * `payable_created` é arquivado sob o módulo de ORIGEM (`maintenance`, `fine`,
 * `vehicle_obligation`…) com o id da origem, enquanto `payable_paid` e
 * `payable_cancelled` usam `('payable', payable_id)`. Filtrar por source
 * enxergaria só metade da história — foi o que `cancelPayable` já resolvia
 * olhando a dimensão.
 */
async function porConta(payableId: string) {
  const { data } = await admin()
    .from('financial_entries')
    .select('account_code, amount_signed, vehicle_id, payable_id, financial_transactions!inner(event_type)')
    .eq('payable_id', payableId)

  const linhas = (data ?? []) as {
    account_code: string; amount_signed: number; vehicle_id: string | null
    financial_transactions: { event_type: string }
  }[]

  const soma = (code: string) => linhas
    .filter((l) => l.account_code === code)
    .reduce((s, l) => s + Number(l.amount_signed), 0)

  return {
    caixa: soma('caixa_e_bancos'),
    passivo: soma('contas_a_pagar'),
    pagamentos: linhas.filter((l) => l.financial_transactions.event_type === 'payable_paid').length,
    linhas,
  }
}

async function despesaAberta(valor: number, sufixo: string) {
  const r = await createPayable(admin(), tenantId, {
    description: `${TEST_TAG} Despesa ${sufixo} ${RUN}`,
    amount: valor,
    competenceDate: hoje(),
    dueDate: hoje(),
    expenseAccountCode: 'despesa_manutencao',
    sourceModule: 'expense',
    responsibility: 'company',
    vehicleId,
  })
  return r.payableId as string
}

test.beforeAll(async () => {
  tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const c = await createTestContract(vehicleId)
  customerId = c.customerId
  rentalId = c.contractId
  void rentalId
})

test.afterAll(async () => {
  await deleteTestCustomer(customerId)
  await deleteTestVehicle(vehicleId)
})

test.describe('Baixa de despesa', () => {
  test('lança caixa e passivo com a dimensão do veículo preservada', async () => {
    const payableId = await despesaAberta(400, 'simples')

    const antes = await porConta(payableId)
    expect(antes.caixa, 'criar a despesa não pode mexer no caixa').toBe(0)
    expect(antes.passivo, 'a criação sobe o passivo').toBe(-400)

    await payPayable(admin(), tenantId, payableId, hoje())

    const depois = await porConta(payableId)
    expect(depois.caixa, 'o caixa não saiu').toBe(-400)
    expect(depois.passivo, 'o passivo não foi baixado').toBe(0)

    // Sem a dimensão, o custo some do resultado do veículo enquanto a despesa
    // continua lá — o razão fica certo no total e errado por veículo.
    const pagamento = depois.linhas.filter((l) => l.financial_transactions.event_type === 'payable_paid')
    expect(pagamento).toHaveLength(2)
    for (const l of pagamento) {
      expect(l.vehicle_id, 'perna de pagamento sem veículo').toBe(vehicleId)
    }

    const { data } = await admin()
      .from('payables').select('status, paid_at').eq('id', payableId).single()
    expect((data as { status: string }).status).toBe('paid')
  })

  test('pagar duas vezes em sequência é recusado', async () => {
    const payableId = await despesaAberta(250, 'sequencial')
    await payPayable(admin(), tenantId, payableId, hoje())

    await expect(payPayable(admin(), tenantId, payableId, hoje())).rejects.toThrow(/já paga/i)

    const depois = await porConta(payableId)
    expect(depois.caixa).toBe(-250)
    expect(depois.pagamentos).toBe(2) // duas pernas de UM pagamento
  })

  test('dois cliques SIMULTÂNEOS não tiram o dinheiro duas vezes', async () => {
    const payableId = await despesaAberta(300, 'concorrente')

    // As duas chamadas leem o status antes de qualquer uma escrever. Sem trava,
    // as duas passam pelo guarda e as duas lançam.
    const resultados = await Promise.allSettled([
      payPayable(admin(), tenantId, payableId, hoje()),
      payPayable(admin(), tenantId, payableId, hoje()),
    ])

    const okCount = resultados.filter((r) => r.status === 'fulfilled').length
    const depois = await porConta(payableId)

    expect(depois.caixa, `o caixa saiu ${-depois.caixa} para uma despesa de 300`).toBe(-300)
    expect(depois.passivo, 'o passivo foi baixado mais de uma vez').toBe(0)
    expect(okCount, 'as duas chamadas concorrentes foram aceitas').toBe(1)
  })

  test('conta cancelada não pode ser paga', async () => {
    const payableId = await despesaAberta(150, 'cancelada')
    await cancelPayable(admin(), tenantId, payableId, 'teste de cancelamento')

    await expect(payPayable(admin(), tenantId, payableId, hoje())).rejects.toThrow(/cancelada/i)

    const depois = await porConta(payableId)
    expect(depois.caixa, 'conta cancelada moveu o caixa').toBe(0)
  })
})
