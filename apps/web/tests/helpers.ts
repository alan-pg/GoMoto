/**
 * @file tests/helpers.ts
 * @description Funções auxiliares compartilhadas entre todos os specs de teste.
 *
 * ABORDAGEM:
 * - Setup/teardown de dados (create/delete) usa o @supabase/supabase-js diretamente
 *   em Node.js, sem depender de browser — elimina o problema de 401 do beforeAll.
 * - Helpers de UI (getModal, waitForPageLoad) recebem `page` normalmente.
 */

import { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Configuração do cliente Supabase para Node.js (sem browser)
// ---------------------------------------------------------------------------

export const TEST_TAG = '[E2E]'

let _supabase: ReturnType<typeof createClient> | null = null
let _authenticated = false

/**
 * Retorna uma instância autenticada do cliente Supabase em Node.js.
 * Autentica com email/senha na primeira chamada e reutiliza nas demais.
 */
async function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY não definidos')
    _supabase = createClient(url, key)
  }

  if (!_authenticated) {
    const email = process.env.TEST_USER_EMAIL
    const password = process.env.TEST_USER_PASSWORD
    if (!email || !password) throw new Error('TEST_USER_EMAIL ou TEST_USER_PASSWORD não definidos em .env.test')

    const { error } = await _supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`Falha ao autenticar no Supabase: ${error.message}`)
    _authenticated = true
  }

  return _supabase
}

// ---------------------------------------------------------------------------
// Helpers de dados — sem dependência de browser
// ---------------------------------------------------------------------------

/**
 * Cria um cliente de teste diretamente no banco (in_queue=false → aparece em /clientes).
 * Retorna o ID gerado.
 */
export async function createTestCustomer(): Promise<{ id: string; name: string }> {
  const sb = await getSupabase()
  const ts = Date.now().toString().slice(-9)
  const cpf = `${ts.slice(0,3)}.${ts.slice(3,6)}.${ts.slice(6,9)}-00`
  const name = `${TEST_TAG} Cliente ${ts}`
  const { data, error } = await sb
    .from('customers')
    .insert({
      name,
      cpf,
      phone: '21999990000',
      state: 'RJ',
      active: true,
      in_queue: false,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Erro ao criar cliente de teste: ${error.message}`)
  return { id: data.id as string, name }
}

/**
 * Remove um cliente de teste pelo ID, limpando cobranças vinculadas antes.
 */
export async function deleteTestCustomer(id: string): Promise<void> {
  if (!id) return
  const sb = await getSupabase()
  await sb.from('billings').delete().eq('customer_id', id)
  await sb.from('customers').delete().eq('id', id)
}

/**
 * Cria uma moto de teste diretamente no banco.
 * Retorna o ID e a placa gerados.
 */
export async function createTestMotorcycle(): Promise<{ id: string; license_plate: string }> {
  const sb = await getSupabase()
  const suffix = Date.now().toString().slice(-5)
  const plate = `T${suffix}`.slice(0, 7).toUpperCase()

  const { data, error } = await sb
    .from('motorcycles')
    .insert({
      license_plate: plate,
      model: 'Model E2E',
      make: 'TEST',
      year: '2024/2024',
      color: 'PRETO',
      renavam: `0000000${suffix}`.slice(0, 11),
      chassis: `TEST${suffix}E2E000`.slice(0, 17).toUpperCase(),
      fuel: 'GASOLINA',
      status: 'available',
      km_current: 0,
      observations: TEST_TAG,
    })
    .select('id, license_plate')
    .single()

  if (error) throw new Error(`Erro ao criar moto de teste: ${error.message}`)
  return { id: data.id as string, license_plate: data.license_plate as string }
}

/**
 * Remove uma moto de teste pelo ID, limpando dados dependentes antes.
 */
export async function deleteTestMotorcycle(id: string): Promise<void> {
  if (!id) return
  const sb = await getSupabase()
  await sb.from('maintenances').delete().eq('motorcycle_id', id)
  await sb.from('fines').delete().eq('motorcycle_id', id)
  await sb.from('contracts').delete().eq('motorcycle_id', id)
  await sb.from('motorcycles').delete().eq('id', id)
}

/**
 * Cria um cliente e um contrato ativo para uma moto — necessário para que
 * o campo `lessee` da tela de Entradas seja preenchido automaticamente via lookupLessee.
 * Retorna IDs do cliente e do contrato criados.
 */
export async function createTestContract(motorcycleId: string): Promise<{ customerId: string; contractId: string }> {
  const sb = await getSupabase()
  const today = new Date().toISOString().split('T')[0]

  const { data: customer, error: customerError } = await sb
    .from('customers')
    .insert({
      name: `${TEST_TAG} Cliente Contrato E2E`,
      cpf: (() => { const t = Date.now().toString().slice(-9); return `${t.slice(0,3)}.${t.slice(3,6)}.${t.slice(6,9)}-99` })(),
      phone: '21988880099',
      state: 'RJ',
      active: true,
      in_queue: false,
    })
    .select('id')
    .single()

  if (customerError) throw new Error(`Erro ao criar cliente para contrato: ${customerError.message}`)

  const { data: contract, error: contractError } = await sb
    .from('contracts')
    .insert({
      customer_id: customer.id,
      motorcycle_id: motorcycleId,
      start_date: today,
      end_date: null,
      monthly_amount: 300,
      status: 'active',
    })
    .select('id')
    .single()

  if (contractError) throw new Error(`Erro ao criar contrato de teste: ${contractError.message}`)

  return { customerId: customer.id as string, contractId: contract.id as string }
}

/**
 * Remove todos os customers cujo nome bate com o padrão (SQL ILIKE).
 * Usado para limpar candidatos da fila que ficam com in_queue=false após remoção.
 */
export async function cleanupTestCustomersByName(namePattern: string): Promise<void> {
  const sb = await getSupabase()
  const { data: customers } = await sb.from('customers').select('id').ilike('name', namePattern)
  if (!customers || customers.length === 0) return
  for (const c of customers) {
    await sb.from('queue_entries').delete().eq('customer_id', c.id)
    await sb.from('billings').delete().eq('customer_id', c.id)
    await sb.from('customers').delete().eq('id', c.id)
  }
}

/**
 * Remove entradas (incomes) cujo lessee bate com o padrão (SQL ILIKE).
 * Usado para limpar entradas órfãs quando o teste falha antes do step DELETE.
 */
export async function cleanupTestIncomesByLessee(lesseePattern: string): Promise<void> {
  const sb = await getSupabase()
  await sb.from('incomes').delete().ilike('lessee', lesseePattern)
}

/**
 * Remove um contrato de teste e o cliente associado.
 */
export async function deleteTestContract(contractId: string, customerId: string): Promise<void> {
  const sb = await getSupabase()
  if (contractId) await sb.from('contracts').delete().eq('id', contractId)
  if (customerId) {
    await sb.from('billings').delete().eq('customer_id', customerId)
    await sb.from('customers').delete().eq('id', customerId)
  }
}

// ---------------------------------------------------------------------------
// Helpers de UI — recebem `page`
// ---------------------------------------------------------------------------

/**
 * Retorna o locator do modal atualmente aberto na página.
 * O componente Modal renderiza um `div.fixed.inset-0` SOMENTE quando está aberto
 * (retorna null quando fechado), então este seletor é exclusivo ao modal aberto.
 */
export function getModal(page: Page) {
  return page.locator('div.fixed.inset-0').first()
}

/**
 * Aguarda que a página carregue e o spinner de loading desapareça.
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  const spinner = page.locator('.animate-spin').first()
  if (await spinner.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await spinner.waitFor({ state: 'hidden', timeout: 15_000 })
  }
}
