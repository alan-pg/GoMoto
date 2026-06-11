'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ExpenseSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createExpense(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ExpenseSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('expenses')
    .insert(parsed.data)
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar despesa' }

  await logAction({ action: 'create', table: 'expenses', recordId: data.id, newData: data })
  revalidatePath('/despesas')
  return { data }
}

export async function updateExpense(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ExpenseSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('expenses').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('expenses')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar despesa' }

  await logAction({ action: 'update', table: 'expenses', recordId: id, oldData: before, newData: data })
  revalidatePath('/despesas')
  return { data }
}

export async function deleteExpense(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('expenses').select().eq('id', id).single()
  const { error } = await supabase.from('expenses').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir despesa' }

  await logAction({ action: 'delete', table: 'expenses', recordId: id, oldData: before })
  revalidatePath('/despesas')
  return { success: true }
}
