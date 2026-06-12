'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { IncomeSchema } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createIncome(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = IncomeSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const payload = {
    ...parsed.data,
    vehicle: parsed.data.vehicle.toUpperCase(),
    tenant_id: tenantId,
  }

  const { data, error } = await supabase
    .from('incomes')
    .insert(payload)
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar entrada' }

  await logAction({ action: 'create', table: 'incomes', recordId: data.id, newData: data })
  revalidatePath('/entradas')
  return { data }
}

export async function updateIncome(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = IncomeSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const payload = parsed.data.vehicle
    ? { ...parsed.data, vehicle: parsed.data.vehicle.toUpperCase() }
    : parsed.data

  const { data: before } = await supabase.from('incomes').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('incomes')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar entrada' }

  await logAction({ action: 'update', table: 'incomes', recordId: id, oldData: before, newData: data })
  revalidatePath('/entradas')
  return { data }
}

export async function deleteIncome(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('incomes').select().eq('id', id).single()
  const { error } = await supabase.from('incomes').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir entrada' }

  await logAction({ action: 'delete', table: 'incomes', recordId: id, oldData: before })
  revalidatePath('/entradas')
  return { success: true }
}
