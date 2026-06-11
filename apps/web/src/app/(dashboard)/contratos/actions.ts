'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { z } from 'zod'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

const ContractSchema = z.object({
  customer_id: z.string().uuid(),
  motorcycle_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthly_amount: z.number().positive().max(9999999),
  status: z.enum(['active', 'closed', 'cancelled', 'broken']).optional(),
  observations: z.string().max(2000).optional().nullable(),
})

export async function createContract(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ContractSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('contracts')
    .insert({ ...parsed.data, status: parsed.data.status ?? 'active' })
    .select()
    .single()

  if (error) return { error: 'Erro ao criar contrato' }

  await logAction({ action: 'create', table: 'contracts', recordId: data.id, newData: data })
  revalidatePath('/contratos')
  return { data }
}

export async function updateContract(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ContractSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('contracts').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('contracts')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar contrato' }

  await logAction({ action: 'update', table: 'contracts', recordId: id, oldData: before, newData: data })
  revalidatePath('/contratos')
  return { data }
}

export async function deleteContract(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('contracts').select().eq('id', id).single()
  const { error } = await supabase.from('contracts').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir contrato' }

  await logAction({ action: 'delete', table: 'contracts', recordId: id, oldData: before })
  revalidatePath('/contratos')
  return { success: true }
}
