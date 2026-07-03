import type { SupabaseClient } from '@supabase/supabase-js'
import type { Billing } from '@gomoto/core'

type BillingFilter = {
  lease_id?:    string
  status?:      'pending' | 'paid' | 'overdue' | 'cancelled' | 'prejudice'
  billing_type?: 'cycle' | 'one_time' | 'complementary'
  overdue?:     boolean  // due_date < today AND status = 'pending'
}

export async function listBillings(
  client: SupabaseClient,
  filter?: BillingFilter,
): Promise<Billing[]> {
  let q = client
    .from('billings')
    .select('*, customers(name, phone), rentals(id), billing_pix(status, expires_at, mp_payment_id)')
    .order('due_date', { ascending: false })

  if (filter?.lease_id) q = q.eq('lease_id', filter.lease_id)
  if (filter?.status)   q = q.eq('status', filter.status)
  if (filter?.billing_type) q = q.eq('billing_type', filter.billing_type)
  if (filter?.overdue) {
    const today = new Date().toISOString().split('T')[0]
    q = q.eq('status', 'pending').lt('due_date', today)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Billing[]
}

export async function createBilling(
  client: SupabaseClient,
  payload: Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts' | 'rentals'>,
): Promise<Billing> {
  const { data, error } = await client.from('billings').insert(payload).select().single()
  if (error) throw error
  return data as Billing
}

export async function updateBilling(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts' | 'rentals'>>,
): Promise<Billing> {
  const { data, error } = await client
    .from('billings')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Billing
}

export async function deleteBilling(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('billings').delete().eq('id', id)
  if (error) throw error
}

export async function listBillingsForCustomer(
  client: SupabaseClient,
  filter?: { status?: string },
): Promise<Billing[]> {
  // Usa a policy RLS 'customer_read_own_billings' — só retorna cobranças do cliente autenticado
  let q = client
    .from('billings')
    .select('*, rentals(id, vehicles(license_plate, model, make))')
    .order('due_date', { ascending: false })

  if (filter?.status && filter.status !== 'all') {
    q = q.eq('status', filter.status)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Billing[]
}
