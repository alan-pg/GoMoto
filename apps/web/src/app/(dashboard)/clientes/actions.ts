'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CustomerSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function updateCustomer(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = CustomerSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('customers').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('customers')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar cliente' }

  await logAction({ action: 'update', table: 'customers', recordId: id, oldData: before, newData: data })
  revalidatePath('/clientes')
  return { data }
}

export async function deleteCustomer(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('customers').select().eq('id', id).single()
  const { error } = await supabase.from('customers').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir cliente' }

  await logAction({ action: 'delete', table: 'customers', recordId: id, oldData: before })
  revalidatePath('/clientes')
  return { success: true }
}
