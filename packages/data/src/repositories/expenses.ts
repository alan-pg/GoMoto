import type { SupabaseClient } from '@supabase/supabase-js'
import type { Expense } from '@gomoto/core'

export async function listExpenses(client: SupabaseClient): Promise<Expense[]> {
  const { data, error } = await client
    .from('expenses')
    .select('*, vehicle:vehicles(id, license_plate, model, make)')
    .order('date', { ascending: false })
  if (error) throw error
  return (data ?? []) as Expense[]
}

export async function createExpense(
  client: SupabaseClient,
  payload: Omit<Expense, 'id' | 'created_at' | 'vehicle'>,
): Promise<Expense> {
  const { data, error } = await client.from('expenses').insert(payload).select().single()
  if (error) throw error
  return data as Expense
}

export async function updateExpense(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Expense, 'id' | 'created_at' | 'vehicle'>>,
): Promise<Expense> {
  const { data, error } = await client
    .from('expenses')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Expense
}

export async function deleteExpense(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('expenses').delete().eq('id', id)
  if (error) throw error
}
