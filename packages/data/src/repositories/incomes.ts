import type { SupabaseClient } from '@supabase/supabase-js'
import type { Income } from '@gomoto/core'

export async function listIncomes(client: SupabaseClient): Promise<Income[]> {
  const { data, error } = await client
    .from('incomes')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error
  return (data ?? []) as Income[]
}

export async function createIncome(
  client: SupabaseClient,
  payload: Omit<Income, 'id' | 'created_at'>,
): Promise<Income> {
  const { data, error } = await client.from('incomes').insert(payload).select().single()
  if (error) throw error
  return data as Income
}

export async function updateIncome(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<Income, 'id' | 'created_at'>>,
): Promise<Income> {
  const { data, error } = await client
    .from('incomes')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Income
}

export async function deleteIncome(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('incomes').delete().eq('id', id)
  if (error) throw error
}
