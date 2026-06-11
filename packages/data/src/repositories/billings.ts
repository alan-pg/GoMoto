import type { SupabaseClient } from '@supabase/supabase-js'
import type { Billing } from '@gomoto/core'

export async function listBillings(client: SupabaseClient): Promise<Billing[]> {
  const { data, error } = await client
    .from('billings')
    .select('*, customers(name, phone), contracts(id)')
    .order('due_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as Billing[]
}

export async function createBilling(
  client: SupabaseClient,
  payload: Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts'>,
): Promise<Billing> {
  const { data, error } = await client.from('billings').insert(payload).select().single()
  if (error) throw error
  return data as Billing
}

export async function updateBilling(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Billing, 'id' | 'created_at' | 'updated_at' | 'customers' | 'contracts'>>,
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
