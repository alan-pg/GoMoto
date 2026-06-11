'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { z } from 'zod'

export async function uploadMaintenancePhoto(formData: FormData, prefix: string): Promise<string | null> {
  const file = formData.get('file') as File | null
  if (!file) return null

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const ext = file.name.split('.').pop()
  const path = `maintenance/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabaseAdmin.storage.from('maintenance-files').upload(path, file)
  if (error) return null

  const { data } = supabaseAdmin.storage.from('maintenance-files').getPublicUrl(path)
  return data.publicUrl
}

async function getAuthenticatedUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

const MaintenanceSchema = z.object({
  motorcycle_id: z.string().uuid(),
  type: z.enum(['preventive', 'corrective', 'inspection']),
  description: z.string().max(300).optional().nullable(),
  predicted_km: z.number().int().min(0).optional().nullable(),
  actual_km: z.number().int().min(0).optional().nullable(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  completed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  completed: z.boolean().optional(),
  workshop: z.string().max(200).optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
})

export async function createMaintenance(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MaintenanceSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('maintenances')
    .insert(parsed.data)
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar manutenção' }

  await logAction({ action: 'create', table: 'maintenances', recordId: data.id, newData: data })
  revalidatePath('/manutencao')
  return { data }
}

export async function updateMaintenance(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MaintenanceSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('maintenances').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('maintenances')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar manutenção' }

  await logAction({ action: 'update', table: 'maintenances', recordId: id, oldData: before, newData: data })
  revalidatePath('/manutencao')
  return { data }
}

export async function deleteMaintenance(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('maintenances').select().eq('id', id).single()
  const { error } = await supabase.from('maintenances').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir manutenção' }

  await logAction({ action: 'delete', table: 'maintenances', recordId: id, oldData: before })
  revalidatePath('/manutencao')
  return { success: true }
}

export async function updateMotorcycleKm(motorcycleId: string, kmCurrent: number) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  if (!Number.isInteger(kmCurrent) || kmCurrent < 0) return { error: 'Quilometragem inválida' }

  const { data: before } = await supabase.from('motorcycles').select('km_current').eq('id', motorcycleId).single()

  const { data, error } = await supabase
    .from('motorcycles')
    .update({ km_current: kmCurrent })
    .eq('id', motorcycleId)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar quilometragem' }

  await logAction({ action: 'update', table: 'motorcycles', recordId: motorcycleId, oldData: before, newData: { km_current: kmCurrent } })
  revalidatePath('/manutencao')
  return { data }
}
