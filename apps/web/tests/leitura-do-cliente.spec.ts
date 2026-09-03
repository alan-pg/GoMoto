/**
 * O cliente vê o PRÓPRIO dado corretamente.
 *
 * `tenant-isolation-financeiro.spec.ts` prova o oposto disto: que um tenant não
 * enxerga o outro. Faltava o complemento — e foi por essa fresta que passou o
 * defeito de 2026-08-31: uma cobrança de R$ 102,69 com R$ 100,00 abatidos
 * aparecia CHEIA no app do cliente, e o encargo era calculado sobre o valor
 * cheio (R$ 105,45 no app contra R$ 2,76 no cockpit).
 *
 * A causa não foi conta errada. `calculateAmountDue` é fonte única e estava
 * certa; o que chegou errado foi o INSUMO. As views de saldo são
 * `security_invoker`, e `charge_balances` deriva `paid_amount` somando
 * `payment_allocations` — tabela que não tinha policy de cliente. Para a sessão
 * dele o LATERAL voltava vazio, `allocated` virava 0, e a view respondia
 * `open_amount = total_amount`. Número plausível, silenciosamente falso.
 *
 * Por que nenhum portão pegou:
 *
 * - `typecheck` e `lint` não enxergam RLS;
 * - os testes financeiros leem com **service role**, que bypassa exatamente a
 *   camada onde o defeito mora — passariam com ou sem a policy;
 * - a rota que gera o Pix também usa service role e calculava certo, então o
 *   valor cobrado nunca ficou errado. Só o exibido.
 *
 * Daí a regra desta suíte: **ler sempre com o token do cliente**, nunca com
 * service role. É a única leitura que reproduz o que o app enxerga.
 */

import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cpfShellEmail } from '@gomoto/core'
import {
  TEST_TAG, getSupabaseAdmin, getTestTenantId,
  createTestVehicle, deleteTestVehicle,
  deleteTestCustomer, deleteTestAuthUser,
} from './helpers'
import { createCharge } from '../src/lib/financial/charges'

const admin = () => getSupabaseAdmin()
const SENHA = 'senha-de-teste-1234'
const RUN   = Date.now().toString(36)

let tenantId = ''
let vehicleId = ''
let customerId = ''
let userId = ''
let rentalId = ''
/** Cliente Supabase autenticado COMO o cliente — o ponto inteiro da suíte. */
let comoCliente: SupabaseClient

function cpfUnico(): string {
  const base = String(Date.now()).slice(-9).padStart(9, '0')
  return base + '00'
}

test.beforeAll(async () => {
  tenantId = await getTestTenantId()

  const v = await createTestVehicle()
  vehicleId = v.id

  const cpf = cpfUnico()
  const email = cpfShellEmail(cpf)

  const { data: created, error: authErr } = await admin().auth.admin.createUser({
    email, password: SENHA, email_confirm: true,
  })
  if (authErr || !created.user) throw new Error(`auth: ${authErr?.message}`)
  userId = created.user.id

  const { data: customer, error: custErr } = await admin()
    .from('customers')
    .insert({
      tenant_id: tenantId, name: `${TEST_TAG} Leitura ${RUN}`,
      cpf, phone: '21988887777', state: 'RJ', active: true, in_queue: false,
      user_id: userId,
    })
    .select('id')
    .single()
  if (custErr) throw new Error(`cliente: ${custErr.message}`)
  customerId = (customer as { id: string }).id

  const hoje = new Date().toISOString().slice(0, 10)
  const { data: novoRental, error: rentalErr } = await admin().rpc('create_rental_with_schedule', {
    p_tenant_id: tenantId,
    p_rental: {
      customer_id: customerId, vehicle_id: vehicleId,
      start_date: hoje, end_date: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
      cycle: 'monthly', cycle_amount: 300, due_day: 10, use_pro_rata: false, contract_type: 'rental',
    },
    p_schedule: [],
  })
  if (rentalErr) throw new Error(`locação: ${rentalErr.message}`)
  rentalId = novoRental as string

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password: SENHA })
  if (signErr || !session.session) throw new Error(`login: ${signErr?.message}`)

  comoCliente = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } },
  )
})

test.afterAll(async () => {
  await admin().from('rental_billing_schedules').delete().eq('rental_id', rentalId)
  await admin().from('rentals').delete().eq('id', rentalId)
  await deleteTestCustomer(customerId).catch(() => {})
  await deleteTestAuthUser(userId).catch(() => {})
  await deleteTestVehicle(vehicleId).catch(() => {})
})

// ---------------------------------------------------------------------------
// Portão duro: as views que o app CONSUMA precisam bater com o admin
// ---------------------------------------------------------------------------

test.describe('O saldo que o app exibe é o saldo real', () => {
  test('cobrança com abatimento: o cliente vê o mesmo que o cockpit', async () => {
    const { chargeId } = await createCharge(admin(), tenantId, {
      customerId, rentalId,
      dueDate: new Date().toISOString().slice(0, 10),
      sourceModule: 'manual', sourceId: crypto.randomUUID(),
      items: [{
        description: `${TEST_TAG} Locação ${RUN}`,
        credit_account_code: 'receita_locacao',
        quantity: 1, unit_amount: 300, amount: 300, vehicle_id: vehicleId,
      }],
    })

    // Crédito concedido e abatido — o caminho que produziu o defeito.
    const { error: concessao } = await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'credit_granted', description: `${TEST_TAG} Crédito ${RUN}`,
        source_module: 'maintenance', source_id: crypto.randomUUID(),
      },
      p_entries: [
        { account_code: 'despesa_manutencao',   direction: 'debit',  amount: 120, customer_id: customerId },
        { account_code: 'creditos_de_clientes', direction: 'credit', amount: 120, customer_id: customerId },
      ],
    })
    expect(concessao, 'setup: concessão de crédito falhou').toBeNull()

    const { error: abatimento } = await admin().rpc('fn_apply_customer_credit', {
      p_tenant_id: tenantId, p_customer_id: customerId,
      p_charge_id: chargeId, p_amount: 120, p_created_by: null,
    })
    expect(abatimento, 'setup: abatimento falhou').toBeNull()

    const colunas = 'total_amount, paid_amount, open_amount'

    const { data: doAdmin } = await admin()
      .from('charge_balances').select(colunas).eq('charge_id', chargeId).maybeSingle()

    const { data: doCliente } = await comoCliente
      .from('charge_balances').select(colunas).eq('charge_id', chargeId).maybeSingle()

    expect(doCliente, 'o cliente não enxerga a própria cobrança').not.toBeNull()

    // A comparação é contra o ADMIN, não contra um número escrito à mão: o que
    // se quer garantir é que as duas leituras contam a mesma história.
    expect(doCliente, 'o app mostra saldo diferente do cockpit para a mesma cobrança')
      .toEqual(doAdmin)

    // E o número certo, para o teste não passar com as duas leituras erradas.
    const c = doCliente as { total_amount: number; paid_amount: number; open_amount: number }
    expect(Number(c.paid_amount)).toBe(120)
    expect(Number(c.open_amount)).toBe(180)
  })

  test('a alocação alheia continua invisível', async () => {
    // A policy que corrigiu o saldo não pode ter virado porta para o resto.
    const { data: todas } = await comoCliente.from('payment_allocations').select('charge_id')
    const alocacoes = (todas ?? []) as { charge_id: string }[]

    const { data: minhas } = await admin()
      .from('charges').select('id').eq('customer_id', customerId)
    const meusIds = new Set(((minhas ?? []) as { id: string }[]).map((c) => c.id))

    for (const a of alocacoes) {
      expect(meusIds.has(a.charge_id), `alocação de cobrança alheia visível: ${a.charge_id}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Inventário: o que AINDA não bate está registrado, e mudar exige revisão
// ---------------------------------------------------------------------------

test.describe('Inventário das views derivadas do razão', () => {
  /**
   * `customer_credit_balances`, `deposit_balances` e `customer_financial_position`
   * somam `financial_entries`, que tem apenas policy de tenant. Para o cliente
   * elas respondem ZERO — e hoje isso é inofensivo só porque o app não as lê.
   *
   * Dar ao cliente leitura do razão expõe conta contábil, custo e estrutura do
   * plano; a alternativa é uma view dedicada. A decisão está no ADR 0027 e não
   * foi tomada — então este teste NÃO exige que passem a bater. Ele congela o
   * estado conhecido: se alguma sair (ou entrar) nesta lista, alguém mexeu na
   * RLS do razão e precisa reabrir a decisão antes que a tela do cliente comece
   * a mostrar zero com cara de número certo.
   */
  test('as views que ainda não enxergam o razão são exatamente as esperadas', async () => {
    const divergemHoje = [
      'customer_credit_balances',
      'deposit_balances',
      'customer_financial_position',
    ].sort()

    // Saldo real, para a comparação não passar por ambos serem zero.
    const { error: credito } = await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'credit_granted', description: `${TEST_TAG} Inventário ${RUN}`,
        source_module: 'maintenance', source_id: crypto.randomUUID(),
      },
      p_entries: [
        { account_code: 'despesa_manutencao',   direction: 'debit',  amount: 90, customer_id: customerId },
        { account_code: 'creditos_de_clientes', direction: 'credit', amount: 90, customer_id: customerId },
      ],
    })
    expect(credito, 'setup: crédito do inventário falhou').toBeNull()

    const { error: caucao } = await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'deposit_received', description: `${TEST_TAG} Caução ${RUN}`,
        source_module: 'deposit', source_id: crypto.randomUUID(),
      },
      p_entries: [
        { account_code: 'caixa_e_bancos',     direction: 'debit',  amount: 400, customer_id: customerId, rental_id: rentalId },
        { account_code: 'caucoes_a_devolver', direction: 'credit', amount: 400, customer_id: customerId, rental_id: rentalId },
      ],
    })
    expect(caucao, 'setup: caução do inventário falhou').toBeNull()

    async function divergiu(view: string, filtro: (q: never) => unknown): Promise<boolean> {
      const doAdmin  = await filtro(admin().from(view).select('*') as never)
      const doClient = await filtro(comoCliente.from(view).select('*') as never)
      const a = ((doAdmin  as { data: unknown[] | null }).data ?? []).length
      const c = ((doClient as { data: unknown[] | null }).data ?? []).length
      return a !== c
    }

    const encontrados: string[] = []

    if (await divergiu('customer_credit_balances', (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq('customer_id', customerId))) {
      encontrados.push('customer_credit_balances')
    }
    if (await divergiu('deposit_balances', (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq('rental_id', rentalId))) {
      encontrados.push('deposit_balances')
    }
    if (await divergiu('customer_financial_position', (q) => (q as never as { eq: (a: string, b: string) => unknown }).eq('customer_id', customerId))) {
      encontrados.push('customer_financial_position')
    }

    expect(
      encontrados.sort(),
      'a lista de views que o cliente não enxerga mudou — reabra o ADR 0027 antes de seguir',
    ).toEqual(divergemHoje)
  })
})
