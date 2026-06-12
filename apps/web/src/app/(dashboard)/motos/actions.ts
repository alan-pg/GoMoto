'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { MotorcycleSchema, MaintenanceBootstrapSchema, type Motorcycle } from '@gomoto/core'
import {
  createMotorcycle as repoCreateMotorcycle,
  updateMotorcycle as repoUpdateMotorcycle,
  deleteMotorcycle as repoDeleteMotorcycle,
  getMotorcycle as repoGetMotorcycle,
} from '@gomoto/data/repositories'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

async function getAuthenticatedContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const tenantId = user ? await getCurrentTenantId(supabase) : null
  return { supabase, user, tenantId }
}

export async function createMotorcycle(rawData: unknown, initialMaintenances?: unknown[]) {
  const { supabase, user, tenantId } = await getAuthenticatedContext()
  if (!user) return { error: 'Não autorizado' }
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = MotorcycleSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  try {
    const payload = { ...parsed.data, tenant_id: tenantId } as Omit<
      Motorcycle,
      'id' | 'created_at' | 'updated_at'
    >
    const data = await repoCreateMotorcycle(supabase, payload)
    await logAction({ action: 'create', table: 'motorcycles', recordId: data.id, newData: data })

    if (initialMaintenances && initialMaintenances.length > 0) {
      const parsed2 = MaintenanceBootstrapSchema.safeParse(initialMaintenances)
      if (parsed2.success) {
        const records = parsed2.data.map((m) => ({
          ...m,
          motorcycle_id: data.id,
          tenant_id: tenantId,
        }))
        await supabase.from('maintenances').insert(records)
      }
    }

    revalidatePath('/motos')
    return { data }
  } catch {
    return { error: 'Erro ao cadastrar moto' }
  }
}

export async function updateMotorcycle(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedContext()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MotorcycleSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  try {
    const before = await repoGetMotorcycle(supabase, id)
    const data = await repoUpdateMotorcycle(
      supabase,
      id,
      parsed.data as Partial<Omit<Motorcycle, 'id' | 'created_at' | 'updated_at'>>,
    )
    await logAction({
      action: 'update',
      table: 'motorcycles',
      recordId: id,
      oldData: before,
      newData: data,
    })
    revalidatePath('/motos')
    return { data }
  } catch {
    return { error: 'Erro ao atualizar moto' }
  }
}

export async function deleteMotorcycle(id: string) {
  const { supabase, user } = await getAuthenticatedContext()
  if (!user) return { error: 'Não autorizado' }

  try {
    const before = await repoGetMotorcycle(supabase, id)
    await repoDeleteMotorcycle(supabase, id)
    await logAction({ action: 'delete', table: 'motorcycles', recordId: id, oldData: before })
    revalidatePath('/motos')
    return { success: true }
  } catch {
    return { error: 'Erro ao excluir moto' }
  }
}
