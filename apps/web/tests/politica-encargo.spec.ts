import { test, expect } from '@playwright/test'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId, waitForPageLoad,
  createTestVehicle, createTestContract, deleteTestCustomer,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'
import { calculateAmountDue, toPolicyRow, type LateChargePolicy } from '@gomoto/core'

/**
 * Política de encargo por atraso — a tela que faltava e o que ela não pode quebrar.
 *
 * Até aqui multa e juros só mudavam por SQL: não havia UMA escrita em
 * `late_charge_policies` fora de migration. O que existia em Configurações era
 * `saveFinancialSettings`, gravando JSON numa chave que ninguém lia.
 *
 * O teste que importa não é "salvou": é que salvar NÃO mexe no que já foi
 * cobrado. Cobrança guarda `late_charge_policy_id` e a conta do devido sai
 * dele — se a nova versão vazasse para trás, todo cliente com dívida antiga
 * passaria a dever outro valor no dia em que a empresa reajustasse a política.
 */

const admin = () => getSupabaseAdmin()

/** Longe o bastante para não capturar cobranças que outros testes emitem hoje. */
function daquiA(dias: number): string {
  const d = new Date(Date.now() + dias * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hoje(): string {
  return daquiA(0)
}

let tenantId: string
let customerId: string
let rentalId: string
let vehicleId: string
const criadas: string[] = []

test.beforeAll(async () => {
  tenantId = await getTestTenantId()
  const v = await createTestVehicle()
  vehicleId = v.id
  const contrato = await createTestContract(vehicleId)
  customerId = contrato.customerId
  rentalId = contrato.contractId
})

test.afterAll(async () => {
  // As versões criadas aqui precisam sumir: `fn_create_charge` escolhe a
  // política por `effective_from <= due_date`, então uma versão esquecida
  // mudaria o valor esperado por outras suítes.
  if (criadas.length > 0) {
    await admin().from('late_charge_policies').delete().in('id', criadas)
  }
  await admin().from('rentals').delete().eq('id', rentalId)
  await deleteTestCustomer(customerId).catch(() => {})
  await admin().from('vehicles').delete().eq('id', vehicleId)
})

async function criarVersao(over: Partial<{
  fee_value: number; monthly_interest_percent: number
  grace_period_days: number; min_amount: number; effective_from: string
}> = {}) {
  const row = toPolicyRow({
    fee_type: 'percentage',
    fee_value: 5,
    monthly_interest_percent: 3,
    grace_period_days: 0,
    min_amount: 0,
    effective_from: daquiA(90),
    ...over,
  })

  const { data, error } = await admin().rpc('fn_create_late_charge_policy', {
    p_tenant_id:           tenantId,
    p_fee_type:            row.fee_type,
    p_fee_value:           row.fee_value,
    p_daily_interest_rate: row.daily_interest_rate,
    p_grace_period_days:   row.grace_period_days,
    p_min_amount:          row.min_amount,
    p_effective_from:      row.effective_from,
  })

  if (!error && data) criadas.push(data as string)
  return { id: data as string | null, error }
}

test.describe('Política de encargo — versionamento', () => {
  test('nova versão não muda o que já foi cobrado', async () => {
    // Uma cobrança vencida há 30 dias, emitida com a política de hoje.
    const { chargeId } = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: daquiA(-30),
      sourceModule: 'manual',
      sourceId: crypto.randomUUID(),
      items: [{
        description: `${TEST_TAG} Congelamento ${Date.now().toString(36)}`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 1000, amount: 1000,
      }],
    })

    const politicaDe = async (id: string) => {
      const { data: c } = await admin()
        .from('charges').select('late_charge_policy_id').eq('id', id).single()
      const pid = (c as { late_charge_policy_id: string }).late_charge_policy_id
      const { data: p } = await admin()
        .from('late_charge_policies')
        .select('fee_type, fee_value, daily_interest_rate, grace_period_days, min_amount')
        .eq('id', pid).single()
      return { pid, policy: p as LateChargePolicy }
    }

    const saldo = async () => {
      const { data } = await admin()
        .from('charge_balances')
        .select('open_amount, due_date, status')
        .eq('charge_id', chargeId).single()
      return data as { open_amount: number; due_date: string; status: string }
    }

    const antes = await politicaDe(chargeId)
    const devidoAntes = calculateAmountDue(await saldo(), antes.policy).amount_due

    // Reajuste agressivo: 5% de multa e 3% ao mês, contra os 2% e ~1% vigentes.
    const { error } = await criarVersao()
    expect(error, 'a nova versão precisa entrar').toBeNull()

    const depois = await politicaDe(chargeId)
    expect(depois.pid, 'a cobrança não pode trocar de política').toBe(antes.pid)
    expect(depois.policy).toEqual(antes.policy)

    const devidoDepois = calculateAmountDue(await saldo(), depois.policy).amount_due
    expect(devidoDepois, 'o valor devido não pode mudar por reajuste de política')
      .toBeCloseTo(devidoAntes, 2)
  })

  test('a versão nasce com o número seguinte, sem furo nem repetição', async () => {
    const antes = await admin()
      .from('late_charge_policies').select('version')
      .eq('tenant_id', tenantId).order('version', { ascending: false }).limit(1).single()
    const ultimo = (antes.data as { version: number }).version

    const { id } = await criarVersao({ effective_from: daquiA(91) })
    const { data } = await admin()
      .from('late_charge_policies').select('version').eq('id', id!).single()

    expect((data as { version: number }).version).toBe(ultimo + 1)
  })

  test('duas gravações simultâneas não colidem na numeração', async () => {
    // `MAX(version) + 1` lido no app daria o mesmo número às duas: uma entra e
    // a outra estoura no UNIQUE. A função trava o tenant justamente por isso.
    const [a, b] = await Promise.all([
      criarVersao({ effective_from: daquiA(92) }),
      criarVersao({ effective_from: daquiA(93) }),
    ])

    expect(a.error, 'a primeira não pode falhar').toBeNull()
    expect(b.error, 'a segunda também não — a trava serializa, não recusa').toBeNull()

    const { data } = await admin()
      .from('late_charge_policies').select('version').in('id', [a.id!, b.id!])
    const versoes = (data as { version: number }[]).map((v) => v.version)
    expect(new Set(versoes).size, 'versões precisam ser distintas').toBe(2)
  })

  test('vigência no passado é recusada', async () => {
    // Retroagir mudaria a política das cobranças emitidas entre aquela data e
    // hoje — o retroativo que a versão existe para impedir.
    const { error } = await criarVersao({ effective_from: daquiA(-1) })
    expect(error?.message ?? '').toContain('EFFECTIVE_FROM_IN_PAST')
  })

  test('a fração chega ao banco como fração, não como o número digitado', async () => {
    // 5% grava 0.05. O CHECK `late_charge_percentage_is_fraction` recusa 5, e
    // era exatamente essa a convenção da `LateChargeConfig` removida.
    const { id } = await criarVersao({ effective_from: daquiA(94), fee_value: 5 })
    const { data } = await admin()
      .from('late_charge_policies').select('fee_value, daily_interest_rate').eq('id', id!).single()

    const p = data as { fee_value: number; daily_interest_rate: number }
    expect(Number(p.fee_value)).toBeCloseTo(0.05, 4)
    expect(Number(p.daily_interest_rate)).toBeCloseTo(0.001, 6) // 3% ao mês ÷ 30
  })
})

test.describe('Política de encargo — a tela', () => {
  test('mostra a política em vigor e salva uma versão nova', async ({ page }) => {
    await page.goto('/configuracoes')
    await waitForPageLoad(page)

    const secao = page.locator('section').filter({ hasText: 'Encargo por atraso' })
    await expect(secao, 'a seção precisa existir — antes só dava pra mudar por SQL')
      .toBeVisible({ timeout: 10_000 })

    await expect(secao.getByText(/Em vigor · versão \d+/)).toBeVisible()

    // A taxa diária derivada fica à vista: o operador digita ao mês porque é
    // assim que o contrato fala, e o banco guarda ao dia.
    await expect(secao.getByText(/Equivale a [\d,.]+% ao dia/)).toBeVisible()

    const carencia = secao.getByLabel('Carência (dias)')
    await carencia.fill('7')
    await secao.getByLabel('Em vigor a partir de').fill(daquiA(95))
    await secao.getByRole('button', { name: /salvar nova versão/i }).click()

    await expect(secao.getByText(/Nova versão salva/i)).toBeVisible({ timeout: 15_000 })

    const { data } = await admin()
      .from('late_charge_policies')
      .select('id, grace_period_days, effective_from')
      .eq('tenant_id', tenantId)
      .eq('effective_from', daquiA(95))
      .single()

    const nova = data as { id: string; grace_period_days: number }
    criadas.push(nova.id)
    expect(nova.grace_period_days).toBe(7)
  })

  test('a tela recusa vigência anterior a hoje', async ({ page }) => {
    await page.goto('/configuracoes')
    await waitForPageLoad(page)

    const secao = page.locator('section').filter({ hasText: 'Encargo por atraso' })
    const campo = secao.getByLabel('Em vigor a partir de')

    // O input tem `min` = hoje; o teclado ainda deixa digitar antes disso, e é
    // por isso que o banco também recusa. A tela precisa dizer o motivo.
    await expect(campo).toHaveAttribute('min', hoje())

    await campo.fill(daquiA(-10))
    await secao.getByRole('button', { name: /salvar nova versão/i }).click()
    await expect(secao.getByText(/não pode começar antes de hoje/i)).toBeVisible({ timeout: 15_000 })
  })
})
