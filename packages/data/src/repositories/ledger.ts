/**
 * Leituras do domínio financeiro (Spec 0014).
 *
 * Tudo aqui consulta VIEW, nunca tabela: saldo, atraso e inadimplência são
 * derivados (Princípios 2 e 4). Nenhuma função deste arquivo replica cálculo
 * financeiro — a aritmética vive em @gomoto/core.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Tipos das views
// ============================================================

export type ChargeBalanceRow = {
  charge_id: string
  tenant_id: string
  customer_id: string
  rental_id: string | null
  charge_number: number
  status: 'open' | 'paid' | 'cancelled' | 'written_off'
  issue_date: string
  due_date: string
  currency: string
  total_amount: number
  paid_amount: number
  open_amount: number
  is_overdue: boolean
  days_overdue: number
}

export type ChargeItemRow = {
  id: string
  charge_id: string
  description: string
  credit_account_code: string
  quantity: number
  unit_amount: number
  amount: number
  source_module: string
  source_id: string | null
  vehicle_id: string | null
}

export type CustomerDelinquencyRow = {
  tenant_id: string
  customer_id: string
  overdue_count: number
  max_days_overdue: number
  overdue_amount: number
  oldest_due_date: string
}

export type VehiclePositionRow = {
  tenant_id: string
  vehicle_id: string
  operating_revenue: number | null
  gross_costs: number | null
  reimbursed: number | null
  net_result: number | null
  maintenance_cost: number | null
  documentation_cost: number | null
  insurance_cost: number | null
  fines_cost: number | null
  acquisition_cost: number | null
  accumulated_depreciation: number | null
}

export type IncomeStatementRow = {
  tenant_id: string
  branch_id: string | null
  period: string
  report_line_code: string
  in_tax_base: boolean
  amount: number
}

export type RentalResultRow = {
  tenant_id: string
  rental_id: string
  revenue: number | null
  costs: number | null
  reimbursed: number | null
  net_result: number | null
}

export type ScheduleRow = {
  id: string
  rental_id: string
  sequence_number: number
  period_start: string
  period_end: string
  due_date: string
  amount: number
  status: 'scheduled' | 'issued' | 'cancelled' | 'superseded'
  charge_id: string | null
}

// ============================================================
// Cobranças
// ============================================================

/** Cobranças em aberto de um cliente, da mais antiga para a mais nova. */
export async function listOpenCharges(
  client: SupabaseClient,
  customerId: string,
): Promise<ChargeBalanceRow[]> {
  const { data, error } = await client
    .from('charge_balances')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .gt('open_amount', 0)
    .order('due_date', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChargeBalanceRow[]
}

export async function getChargeBalance(
  client: SupabaseClient,
  chargeId: string,
): Promise<ChargeBalanceRow | null> {
  const { data, error } = await client
    .from('charge_balances')
    .select('*')
    .eq('charge_id', chargeId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ChargeBalanceRow | null
}

export async function listChargeItems(
  client: SupabaseClient,
  chargeId: string,
): Promise<ChargeItemRow[]> {
  const { data, error } = await client
    .from('charge_items')
    .select('*')
    .eq('charge_id', chargeId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChargeItemRow[]
}

/**
 * Contas a receber: emitido e não pago.
 *
 * NÃO inclui o cronograma futuro — isso é carteira contratada, outra métrica
 * (F-10). No modelo antigo, um rent-to-own de 2 anos entrava inteiro aqui no
 * dia da assinatura.
 */
export async function listReceivables(
  client: SupabaseClient,
): Promise<ChargeBalanceRow[]> {
  const { data, error } = await client
    .from('charge_balances')
    .select('*')
    .eq('status', 'open')
    .gt('open_amount', 0)
    .order('due_date', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChargeBalanceRow[]
}

export type ChargeListRow = ChargeBalanceRow & {
  customer_name: string
  customer_phone: string | null
  vehicle_plate: string | null
  item_count: number
  primary_description: string
}

/**
 * Listagem para o cockpit: saldo da view enriquecido com cliente, veículo e
 * descrição do item principal.
 *
 * Duas consultas em vez de join na view: `charge_balances` já agrega por
 * cobrança, e juntar `charge_items` ali dentro reintroduziria o fan-out que o
 * redesenho eliminou (F-01).
 */
export async function listChargesForCockpit(
  client: SupabaseClient,
): Promise<ChargeListRow[]> {
  const { data: balances, error } = await client
    .from('charge_balances')
    .select('*')
    .order('due_date', { ascending: true })

  if (error) throw error
  const rows = (balances ?? []) as ChargeBalanceRow[]
  if (rows.length === 0) return []

  const chargeIds = rows.map((r) => r.charge_id)
  const customerIds = [...new Set(rows.map((r) => r.customer_id))]
  const rentalIds = [...new Set(rows.map((r) => r.rental_id).filter(Boolean))] as string[]

  const [itemsRes, customersRes, rentalsRes] = await Promise.all([
    client.from('charge_items').select('charge_id, description, amount').in('charge_id', chargeIds),
    client.from('customers').select('id, name, phone').in('id', customerIds),
    rentalIds.length
      ? client.from('rentals').select('id, vehicles(license_plate)').in('id', rentalIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const itemsByCharge = new Map<string, { description: string; amount: number }[]>()
  for (const i of (itemsRes.data ?? []) as { charge_id: string; description: string; amount: number }[]) {
    const list = itemsByCharge.get(i.charge_id) ?? []
    list.push({ description: i.description, amount: i.amount })
    itemsByCharge.set(i.charge_id, list)
  }

  const customerById = new Map(
    ((customersRes.data ?? []) as { id: string; name: string; phone: string | null }[])
      .map((c) => [c.id, c]),
  )

  // `rentals.vehicle_id → vehicles.id` é muitos-para-um, então o PostgREST
  // devolve objeto; a inferência do supabase-js supõe array. Tratamos as duas
  // formas para não depender dessa suposição.
  type RentalVehicle = { id: string; vehicles: { license_plate: string } | { license_plate: string }[] | null }

  const plateByRental = new Map(
    ((rentalsRes.data ?? []) as unknown as RentalVehicle[]).map((r) => {
      const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles
      return [r.id, v?.license_plate ?? null] as const
    }),
  )

  return rows.map((r) => {
    const items = itemsByCharge.get(r.charge_id) ?? []
    // Item de maior valor representa a cobrança na listagem.
    const principal = [...items].sort((a, b) => b.amount - a.amount)[0]
    const customer = customerById.get(r.customer_id)

    return {
      ...r,
      customer_name: customer?.name ?? '—',
      customer_phone: customer?.phone ?? null,
      vehicle_plate: r.rental_id ? plateByRental.get(r.rental_id) ?? null : null,
      item_count: items.length,
      primary_description: principal?.description ?? 'Cobrança',
    }
  })
}

/** Cobranças em aberto e vencidas — base do aging. */
export async function listOverdueCharges(
  client: SupabaseClient,
): Promise<ChargeBalanceRow[]> {
  const { data, error } = await client
    .from('charge_balances')
    .select('*')
    .eq('is_overdue', true)
    .order('days_overdue', { ascending: false })

  if (error) throw error
  return (data ?? []) as ChargeBalanceRow[]
}

// ============================================================
// Inadimplência
// ============================================================

/** Ausência de linha significa cliente em dia — não é erro. */
export async function getCustomerDelinquency(
  client: SupabaseClient,
  customerId: string,
): Promise<CustomerDelinquencyRow | null> {
  const { data, error } = await client
    .from('customer_delinquency')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as CustomerDelinquencyRow | null
}

export async function listDelinquentCustomers(
  client: SupabaseClient,
): Promise<CustomerDelinquencyRow[]> {
  const { data, error } = await client
    .from('customer_delinquency')
    .select('*')
    .order('max_days_overdue', { ascending: false })

  if (error) throw error
  return (data ?? []) as CustomerDelinquencyRow[]
}

// ============================================================
// Saldos
// ============================================================

export async function getDepositBalance(
  client: SupabaseClient,
  rentalId: string,
): Promise<number> {
  const { data, error } = await client
    .from('deposit_balances')
    .select('balance')
    .eq('rental_id', rentalId)
    .maybeSingle()

  if (error) throw error
  return (data as { balance: number } | null)?.balance ?? 0
}

export async function getCustomerCreditBalance(
  client: SupabaseClient,
  customerId: string,
): Promise<number> {
  const { data, error } = await client
    .from('customer_credit_balances')
    .select('balance')
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) throw error
  return (data as { balance: number } | null)?.balance ?? 0
}

// ============================================================
// Posição do veículo e resultado da locação
// ============================================================

export async function getVehiclePosition(
  client: SupabaseClient,
  vehicleId: string,
): Promise<VehiclePositionRow | null> {
  const { data, error } = await client
    .from('vehicle_financial_position')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as VehiclePositionRow | null
}

export async function listVehiclePositions(
  client: SupabaseClient,
): Promise<VehiclePositionRow[]> {
  const { data, error } = await client.from('vehicle_financial_position').select('*')
  if (error) throw error
  return (data ?? []) as VehiclePositionRow[]
}

export async function getRentalResult(
  client: SupabaseClient,
  rentalId: string,
): Promise<RentalResultRow | null> {
  const { data, error } = await client
    .from('rental_financial_result')
    .select('*')
    .eq('rental_id', rentalId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as RentalResultRow | null
}

// ============================================================
// DRE
// ============================================================

/**
 * Linhas do demonstrativo no período, já resolvidas pela política do tenant
 * vigente na data de cada fato (ADR 0024, Princípio 6).
 */
export async function listIncomeStatement(
  client: SupabaseClient,
  fromPeriod: string,
  toPeriod: string,
): Promise<IncomeStatementRow[]> {
  const { data, error } = await client
    .from('income_statement')
    .select('*')
    .gte('period', fromPeriod)
    .lte('period', toPeriod)
    .order('period', { ascending: true })

  if (error) throw error
  return (data ?? []) as IncomeStatementRow[]
}

// ============================================================
// Cronograma
// ============================================================

export async function listRentalSchedule(
  client: SupabaseClient,
  rentalId: string,
): Promise<ScheduleRow[]> {
  const { data, error } = await client
    .from('rental_billing_schedules')
    .select('*')
    .eq('rental_id', rentalId)
    .order('sequence_number', { ascending: true })

  if (error) throw error
  return (data ?? []) as ScheduleRow[]
}

// ============================================================
// Política
// ============================================================

export type LateChargePolicyRow = {
  id: string
  version: number
  effective_from: string
  fee_type: 'fixed' | 'percentage'
  fee_value: number
  daily_interest_rate: number
  grace_period_days: number
  min_amount: number
}

/** Política vigente na data informada. */
export async function getActiveLateChargePolicy(
  client: SupabaseClient,
  onDate: string,
): Promise<LateChargePolicyRow | null> {
  const { data, error } = await client
    .from('late_charge_policies')
    .select('*')
    .lte('effective_from', onDate)
    .order('effective_from', { ascending: false })
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as LateChargePolicyRow | null
}

export type DelinquencyPolicyRow = {
  id: string
  version: number
  effective_from: string
  late_days: number
  delinquent_count: number
  delinquent_days: number
  blocked_count: number
  blocked_days: number
  auto_block: boolean
}

export async function getActiveDelinquencyPolicy(
  client: SupabaseClient,
  onDate: string,
): Promise<DelinquencyPolicyRow | null> {
  const { data, error } = await client
    .from('delinquency_policies')
    .select('*')
    .lte('effective_from', onDate)
    .order('effective_from', { ascending: false })
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as DelinquencyPolicyRow | null
}

// ============================================================
// Contas a pagar
// ============================================================

export type PayableRow = {
  id: string
  tenant_id: string
  description: string
  expense_account_code: string
  competence_date: string
  due_date: string
  amount: number
  status: 'open' | 'paid' | 'cancelled'
  paid_at: string | null
  responsibility: 'company' | 'customer' | 'shared'
  customer_id: string | null
  customer_amount: number
  reimbursement: 'none' | 'charge' | 'credit'
  vehicle_id: string | null
  rental_id: string | null
  vendor_name: string | null
  source_module: string
  attachment_url: string | null
  created_at: string
}

export async function listPayables(client: SupabaseClient): Promise<PayableRow[]> {
  const { data, error } = await client
    .from('payables')
    .select('*')
    .order('competence_date', { ascending: false })

  if (error) throw error
  return (data ?? []) as PayableRow[]
}

// ============================================================
// Gateway de pagamento
// ============================================================

export type ProviderAccountRow = {
  id: string
  provider: string
  external_account_id: string
  is_default: boolean
  active: boolean
}

/**
 * Contas de provedor do tenant.
 *
 * `credentials` fica FORA do select: a coluna não tem GRANT para
 * `authenticated`, só service_role a lê.
 */
export async function listProviderAccounts(
  client: SupabaseClient,
): Promise<ProviderAccountRow[]> {
  const { data, error } = await client
    .from('payment_provider_accounts')
    .select('id, provider, external_account_id, is_default, active')
    .eq('active', true)

  if (error) throw error
  return (data ?? []) as ProviderAccountRow[]
}

/**
 * Cobranças em aberto de uma LOCAÇÃO.
 *
 * Distinta de `listOpenCharges`, que é por cliente: a apuração de encerramento
 * precisa do que pertence àquela locação, sem depender de o componente ter o
 * `customer_id` em mãos.
 */
export async function listOpenChargesByRental(
  client: SupabaseClient,
  rentalId: string,
): Promise<ChargeBalanceRow[]> {
  const { data, error } = await client
    .from('charge_balances')
    .select('*')
    .eq('rental_id', rentalId)
    .eq('status', 'open')
    .gt('open_amount', 0)
    .order('due_date', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChargeBalanceRow[]
}
