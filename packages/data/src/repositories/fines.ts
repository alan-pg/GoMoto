import type { SupabaseClient } from '@supabase/supabase-js'
import type { Fine } from '@gomoto/core'

export async function listFines(client: SupabaseClient): Promise<Fine[]> {
  const { data, error } = await client
    .from('fines')
    .select('*, customers(name, phone), vehicles(license_plate, model, make)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Fine[]
}

export async function createFine(
  client: SupabaseClient,
  payload: Omit<Fine, 'id' | 'created_at' | 'updated_at' | 'customers' | 'vehicles'>,
): Promise<Fine> {
  const { data, error } = await client.from('fines').insert(payload).select().single()
  if (error) throw error
  return data as Fine
}

export async function updateFine(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Fine, 'id' | 'created_at' | 'updated_at' | 'customers' | 'vehicles'>>,
): Promise<Fine> {
  const { data, error } = await client.from('fines').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data as Fine
}

export async function deleteFine(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('fines').delete().eq('id', id)
  if (error) throw error
}
