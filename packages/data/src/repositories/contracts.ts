import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contract } from '@gomoto/core'

export async function listContracts(client: SupabaseClient): Promise<Contract[]> {
  const { data, error } = await client
    .from('rentals')
    .select('*, customer:customers(*), motorcycle:motorcycles(*)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Contract[]
}

export async function listActiveContracts(client: SupabaseClient): Promise<Contract[]> {
  const { data, error } = await client
    .from('rentals')
    .select('*, customer:customers(*), motorcycle:motorcycles(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Contract[]
}

export async function getContract(client: SupabaseClient, id: string): Promise<Contract> {
  const { data, error } = await client
    .from('rentals')
    .select('*, customer:customers(*), motorcycle:motorcycles(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as Contract
}

export async function createContract(
  client: SupabaseClient,
  payload: Omit<Contract, 'id' | 'created_at' | 'updated_at' | 'customer' | 'motorcycle'>,
): Promise<Contract> {
  const { data, error } = await client.from('rentals').insert(payload).select().single()
  if (error) throw error
  return data as Contract
}

export async function updateContract(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Contract, 'id' | 'created_at' | 'updated_at' | 'customer' | 'motorcycle'>>,
): Promise<Contract> {
  const { data, error } = await client
    .from('rentals')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Contract
}
