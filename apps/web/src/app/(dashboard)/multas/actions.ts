'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FineSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createFine(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = FineSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('fines')
    .insert({ ...parsed.data, status: 'pending' })
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar multa' }

  await logAction({ action: 'create', table: 'fines', recordId: data.id, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function updateFine(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = FineSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('fines')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar multa' }

  await logAction({ action: 'update', table: 'fines', recordId: id, oldData: before, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function markFineAsPaid(id: string, paymentDate: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('fines')
    .update({ status: 'paid', payment_date: paymentDate })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao marcar multa como paga' }

  await logAction({ action: 'update', table: 'fines', recordId: id, oldData: before, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function deleteFine(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()
  const { error } = await supabase.from('fines').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir multa' }

  await logAction({ action: 'delete', table: 'fines', recordId: id, oldData: before })
  revalidatePath('/multas')
  return { success: true }
}
