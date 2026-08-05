import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueueEntry } from '@gomoto/core'

export async function listQueueEntries(client: SupabaseClient): Promise<QueueEntry[]> {
  const { data, error } = await client
    .from('queue_entries')
    .select('*, customers(name, phone, drivers_license, drivers_license_validity)')
    .eq('status', 'waiting')
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as QueueEntry[]
}

export async function createQueueEntry(
  client: SupabaseClient,
  payload: Omit<QueueEntry, 'id' | 'created_at' | 'updated_at' | 'customers'>,
): Promise<QueueEntry> {
  const { data, error } = await client.from('queue_entries').insert(payload).select().single()
  if (error) throw error
  return data as QueueEntry
}

export async function updateQueueEntry(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<QueueEntry, 'id' | 'created_at' | 'updated_at' | 'customers'>>,
): Promise<QueueEntry> {
  const { data, error } = await client
    .from('queue_entries')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as QueueEntry
}

export async function deleteQueueEntry(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('queue_entries').delete().eq('id', id)
  if (error) throw error
}
