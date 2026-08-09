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
let _tenantId: string | null = null

// Date.now() sozinho colide quando dois helpers rodam no mesmo milissegundo
// (ex.: duas chamadas a createTestVehicle() em sequência num beforeAll) —
// um contador monotônico garante unicidade mesmo nesse caso.
let _uniqueSeq = 0
function uniqueSuffix(digits: number): string {
  _uniqueSeq += 1
  return `${Date.now()}${_uniqueSeq}`.slice(-digits)
}

/**
 * Retorna uma instância autenticada do cliente Supabase em Node.js.
 * Autentica com email/senha na primeira chamada e reutiliza nas demais.
 */
export async function getSupabase() {
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

/**
 * Resolve e cacheia o tenant_id do usuário de teste via get_user_tenants()
 * (mesma RPC usada por getCurrentTenantId no app) — os inserts diretos deste
 * arquivo passam por RLS (get_user_tenants()) e precisam do valor explícito,
 * já que não há trigger/default que preencha tenant_id automaticamente.
 */
export async function getTestTenantId(): Promise<string> {
  if (_tenantId) return _tenantId
  const sb = await getSupabase()
  const { data, error } = await sb.rpc('get_user_tenants')
  if (error) throw new Error(`Erro ao resolver tenant de teste: ${error.message}`)
  const tenantId = (data as string[] | null)?.[0]
  if (!tenantId) throw new Error('Usuário de teste não pertence a nenhum tenant (get_user_tenants() vazio)')
  _tenantId = tenantId
  return tenantId
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
  const tenantId = await getTestTenantId()
  const ts = uniqueSuffix(9)
  const cpf = `${ts}00`
  const name = `${TEST_TAG} Cliente ${ts}`
  const { data, error } = await sb
    .from('customers')
    .insert({
      tenant_id: tenantId,
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
 * Cria um veículo de teste diretamente no banco.
 * Retorna o ID e a placa gerados.
 */
export async function createTestVehicle(): Promise<{ id: string; license_plate: string }> {
  const sb = await getSupabase()
  const tenantId = await getTestTenantId()
  const suffix = uniqueSuffix(5)
  const plate = `T${suffix}`.slice(0, 7).toUpperCase()

  const { data, error } = await sb
    .from('vehicles')
    .insert({
      tenant_id: tenantId,
      license_plate: plate,
      model: 'Model E2E',
      make: 'TEST',
      year_manufacture: '2024',
      year_model: '2024',
      // Default de acquisition_type na coluna ('purchase') não satisfaz o
      // próprio CHECK da tabela (não está na lista permitida) — bug de
      // schema pré-existente, fora do escopo deste helper; setamos aqui
      // para não depender do default quebrado.
      acquisition_type: 'used',
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

  if (error) throw new Error(`Erro ao criar veículo de teste: ${error.message}`)
  return { id: data.id as string, license_plate: data.license_plate as string }
}

/**
 * Remove um veículo de teste pelo ID, limpando dados dependentes antes.
 */
export async function deleteTestVehicle(id: string): Promise<void> {
  if (!id) return
  const sb = await getSupabase()
  await sb.from('maintenances').delete().eq('vehicle_id', id)
  await sb.from('fines').delete().eq('vehicle_id', id)
  // deposits.rental_id não tem ON DELETE CASCADE (ao contrário de
  // billings.lease_id) — sem isso, o delete de rentals falha em silêncio
  // (supabase-js não lança) e deixa vehicle/customer órfãos pra trás.
  const { data: rentals } = await sb.from('rentals').select('id').eq('vehicle_id', id)
  const rentalIds = (rentals ?? []).map(r => r.id as string)
  if (rentalIds.length > 0) {
    await sb.from('deposits').delete().in('rental_id', rentalIds)
  }
  await sb.from('rentals').delete().eq('vehicle_id', id)
  await sb.from('vehicles').delete().eq('id', id)
}

/**
 * Cria um cliente e um contrato ativo para uma moto — necessário para que
 * o campo `lessee` da tela de Entradas seja preenchido automaticamente via lookupLessee.
 * Retorna IDs do cliente e do contrato criados.
 */
export async function createTestContract(vehicleId: string): Promise<{ customerId: string; contractId: string }> {
  const sb = await getSupabase()
  const tenantId = await getTestTenantId()
  const today = new Date().toISOString().split('T')[0]

  const { data: customer, error: customerError } = await sb
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: `${TEST_TAG} Cliente Contrato E2E`,
      cpf: `${uniqueSuffix(9)}99`,
      phone: '21988880099',
      state: 'RJ',
      active: true,
      in_queue: false,
    })
    .select('id')
    .single()

  if (customerError) throw new Error(`Erro ao criar cliente para contrato: ${customerError.message}`)

  const { data: contract, error: contractError } = await sb
    .from('rentals')
    .insert({
      tenant_id: tenantId,
      customer_id:  customer.id,
      vehicle_id: vehicleId,
      start_date:   today,
      end_date:     null,
      cycle_amount: 300,
      cycle:        'monthly',
      due_day:      10,
      status:       'active',
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
  if (contractId) await sb.from('rentals').delete().eq('id', contractId)
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

// ---------------------------------------------------------------------------
// Helpers — Spec 0011 (Módulo de Usuários e Controle de Acesso)
// Usam service_role (Admin API) direto — as RPCs/Server Actions da feature
// já são o alvo dos testes; setup/cleanup não deve passar por elas.
// ---------------------------------------------------------------------------

let _supabaseAdmin: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos')
    _supabaseAdmin = createClient(url, key, { auth: { persistSession: false } })
  }
  return _supabaseAdmin
}

/**
 * Cria um auth.user + vínculo em tenant_members direto via service_role
 * (bypassa a UI/RPC de convite — isso é setup, não o alvo do teste).
 * Retorna id/email/memberId para os specs usarem em asserts e no afterAll.
 */
export async function createTestTenantMember(
  role: 'owner' | 'admin' | 'operator' | 'viewer',
  status: 'active' | 'revoked' = 'active',
): Promise<{ userId: string; memberId: string; email: string }> {
  const admin = getSupabaseAdmin()
  const tenantId = await getTestTenantId()
  const email = `e2e-${role}-${uniqueSuffix(9)}@teste.com`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: '12345678',
    email_confirm: true,
    user_metadata: { name: `${TEST_TAG} ${role}` },
  })
  if (createErr || !created.user) throw new Error(`Erro ao criar usuário de teste: ${createErr?.message}`)

  const { data: member, error: memberErr } = await admin
    .from('tenant_members')
    .insert({ tenant_id: tenantId, user_id: created.user.id, role, status })
    .select('id')
    .single()
  if (memberErr) throw new Error(`Erro ao vincular tenant_member de teste: ${memberErr.message}`)

  return { userId: created.user.id, memberId: member.id as string, email }
}

/** Remove um usuário de teste criado por createTestTenantMember (e o vínculo, via CASCADE). */
export async function deleteTestAuthUser(userId: string): Promise<void> {
  if (!userId) return
  await getSupabaseAdmin().auth.admin.deleteUser(userId).catch(() => {})
}

/** Remove um platform_admin de teste (vínculo + auth.user). */
export async function deleteTestPlatformAdmin(userId: string): Promise<void> {
  if (!userId) return
  const admin = getSupabaseAdmin()
  await admin.from('platform_admins').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId).catch(() => {})
}

/** Cria um auth.user + vínculo em platform_admins direto via service_role. */
export async function createTestPlatformAdmin(
  role: 'owner' | 'operator',
): Promise<{ userId: string; email: string }> {
  const admin = getSupabaseAdmin()
  const email = `e2e-platform-${role}-${uniqueSuffix(9)}@teste.com`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: '12345678',
    email_confirm: true,
    user_metadata: { name: `${TEST_TAG} platform ${role}` },
  })
  if (createErr || !created.user) throw new Error(`Erro ao criar platform_admin de teste: ${createErr?.message}`)

  const { error: linkErr } = await admin.from('platform_admins').insert({ user_id: created.user.id, role })
  if (linkErr) throw new Error(`Erro ao vincular platform_admin de teste: ${linkErr.message}`)

  return { userId: created.user.id, email }
}
