'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { MotorcycleSchema, MaintenanceBootstrapSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createMotorcycle(rawData: unknown, initialMaintenances?: unknown[]) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MotorcycleSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('motorcycles')
    .insert(parsed.data)
    .select()
    .single()

  if (error) return { error: 'Erro ao cadastrar moto' }

  await logAction({ action: 'create', table: 'motorcycles', recordId: data.id, newData: data })

  // Bootstrap initial maintenance records if provided
  if (initialMaintenances && initialMaintenances.length > 0) {
    const parsed2 = MaintenanceBootstrapSchema.safeParse(initialMaintenances)
    if (parsed2.success) {
      const records = parsed2.data.map((m) => ({
        ...m,
        motorcycle_id: data.id,
      }))
      await supabase.from('maintenances').insert(records)
    }
  }

  revalidatePath('/motos')
  return { data }
}

export async function updateMotorcycle(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MotorcycleSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('motorcycles').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('motorcycles')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar moto' }

  await logAction({ action: 'update', table: 'motorcycles', recordId: id, oldData: before, newData: data })
  revalidatePath('/motos')
  return { data }
}

export async function deleteMotorcycle(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('motorcycles').select().eq('id', id).single()
  const { error } = await supabase.from('motorcycles').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir moto' }

  await logAction({ action: 'delete', table: 'motorcycles', recordId: id, oldData: before })
  revalidatePath('/motos')
  return { success: true }
}
