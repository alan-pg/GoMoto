import type { SupabaseClient } from '@supabase/supabase-js'
import type { Motorcycle } from '@gomoto/core'

export async function listMotorcycles(client: SupabaseClient): Promise<Motorcycle[]> {
  const { data, error } = await client
    .from('motorcycles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Motorcycle[]
}

export async function getMotorcycle(client: SupabaseClient, id: string): Promise<Motorcycle> {
  const { data, error } = await client.from('motorcycles').select('*').eq('id', id).single()
  if (error) throw error
  return data as Motorcycle
}

export async function createMotorcycle(
  client: SupabaseClient,
  payload: Omit<Motorcycle, 'id' | 'created_at' | 'updated_at'>,
): Promise<Motorcycle> {
  const { data, error } = await client.from('motorcycles').insert(payload).select().single()
  if (error) throw error
  return data as Motorcycle
}

export async function updateMotorcycle(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Motorcycle, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Motorcycle> {
  const { data, error } = await client
    .from('motorcycles')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Motorcycle
}

export async function deleteMotorcycle(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('motorcycles').delete().eq('id', id)
  if (error) throw error
}
