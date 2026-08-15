'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { z } from 'zod'
import type { ActionResult } from '@gomoto/core'
import { registerCost } from '@/lib/financial/maintenance-cost'

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

// Zod 4 `z.string().uuid()` valida o variant byte (4º grupo deve começar com
// 8|9|a|b). IDs sintéticos do seed local (`11111111-1111-1111-1111-111111111111`)
// não respeitam isso e falhariam, mesmo sendo aceitos pelo Postgres como UUID
// válido. Usamos um regex de formato livre — a FK do banco garante existência.
const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MaintenanceSchema = z.object({
  vehicle_id: z.string().regex(UUID_LOOSE),
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
  // PRD 0003 D4 — snapshot de responsabilidade preenchido pelo operador
  // no modal de conclusão. Persistido em maintenances.effective_*.
  effective_executor: z.enum(['company', 'customer']).optional().nullable(),
  odometer_photo_url: z.string().url().optional().nullable(),
  invoice_photo_url: z.string().url().optional().nullable(),
})

export async function createMaintenance(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = MaintenanceSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('maintenances')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()

  if (error) {
    console.error('[createMaintenance] insert failed', error)
    return { error: `Erro ao registrar manutenção: ${error.message}` }
  }

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

  if (error) {
    console.error('[updateMaintenance] update failed', error)
    return { error: `Erro ao atualizar manutenção: ${error.message}` }
  }

  await logAction({ action: 'update', table: 'maintenances', recordId: id, oldData: before, newData: data })
  revalidatePath('/manutencao')
  return { data }
}

export async function deleteMaintenance(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('maintenances').select().eq('id', id).single()
  const { error } = await supabase.from('maintenances').delete().eq('id', id)

  if (error) {
    console.error('[deleteMaintenance] delete failed', error)
    return { error: `Erro ao excluir manutenção: ${error.message}` }
  }

  await logAction({ action: 'delete', table: 'maintenances', recordId: id, oldData: before })
  revalidatePath('/manutencao')
  return { success: true }
}

export async function updateVehicleKm(vehicleId: string, kmCurrent: number) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  if (!Number.isInteger(kmCurrent) || kmCurrent < 0) return { error: 'Quilometragem inválida' }

  const { data: before } = await supabase.from('vehicles').select('km_current').eq('id', vehicleId).single()

  const { data, error } = await supabase
    .from('vehicles')
    .update({ km_current: kmCurrent })
    .eq('id', vehicleId)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar quilometragem' }

  await logAction({ action: 'update', table: 'vehicles', recordId: vehicleId, oldData: before, newData: { km_current: kmCurrent } })
  revalidatePath('/manutencao')
  return { data }
}

// ---------------------------------------------------------------------------
// registerMaintenanceCost — custo da manutenção e rateio, em VALORES
// ---------------------------------------------------------------------------

/**
 * Casca fina: resolve auth e tenant, delega ao serviço.
 *
 * A regra vive em `@/lib/financial/maintenance-cost` porque Server Action
 * depende de `cookies()` e não roda fora de uma requisição do Next — o que a
 * torna inalcançável por teste. O serviço recebe o cliente Supabase por
 * parâmetro e é exercitável direto, como o resto de `lib/financial`.
 */
export async function registerMaintenanceCost(
  input: unknown,
): Promise<ActionResult<{ payable_id: string; charge_id?: string }>> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const result = await registerCost(supabase, tenantId, user.id, input)

  if (result.ok) {
    revalidatePath('/manutencao')
    revalidatePath('/despesas')
    revalidatePath('/cobrancas')
  }
  return result
}
