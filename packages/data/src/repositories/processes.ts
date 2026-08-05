import type { SupabaseClient } from '@supabase/supabase-js'
import type { Process } from '@gomoto/core'

export async function listProcesses(client: SupabaseClient): Promise<Process[]> {
  const { data, error } = await client
    .from('processes')
    .select('*')
    .order('order', { ascending: true })
  if (error) throw error
  return (data ?? []) as Process[]
}

export async function createProcess(
  client: SupabaseClient,
  payload: Omit<Process, 'id' | 'created_at' | 'updated_at'>,
): Promise<Process> {
  const { data, error } = await client.from('processes').insert(payload).select().single()
  if (error) throw error
  return data as Process
}

export async function updateProcess(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Process, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Process> {
  const { data, error } = await client
    .from('processes')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Process
}

export async function deleteProcess(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('processes').delete().eq('id', id)
  if (error) throw error
}
