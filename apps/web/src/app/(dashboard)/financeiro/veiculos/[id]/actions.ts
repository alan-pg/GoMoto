'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { ActionResult } from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')

async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'UNAUTHORIZED' as const }
  return { supabase, user, tenantId }
}

// ============================================================
// registerVehicleSale — registra alienação do veículo (RF-043)
// ============================================================

const RegisterVehicleSaleSchema = z.object({
  vehicle_id: uuid(),
  sale_value: z.number().positive(),
  sold_at:    dateString,
})

export async function registerVehicleSale(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = RegisterVehicleSaleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, tenantId } = ctx

  const { data: vehicle } = await supabase
    .from('vehicles').select('id, sale_value').eq('id', parsed.data.vehicle_id).eq('tenant_id', tenantId).single()

  if (!vehicle) return { ok: false, error: { code: 'NOT_FOUND', message: 'Veículo não encontrado' } }
  if (vehicle.sale_value) return { ok: false, error: { code: 'CONFLICT', message: 'Veículo já alienado' } }

  const { error } = await supabase
    .from('vehicles')
    .update({ sale_value: parsed.data.sale_value, sold_at: parsed.data.sold_at })
    .eq('id', parsed.data.vehicle_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'update', table: 'vehicles', recordId: parsed.data.vehicle_id, newData: { sale_value: parsed.data.sale_value, sold_at: parsed.data.sold_at } })
  revalidatePath(`/financeiro/veiculos/${parsed.data.vehicle_id}`)
  revalidatePath('/veiculos')
  return { ok: true, data: undefined }
}

// ============================================================
// updateAcquisitionValue — cadastra valor de aquisição (RF-041)
// ============================================================

const UpdateAcquisitionSchema = z.object({
  vehicle_id:        uuid(),
  acquisition_amount: z.number().positive(),
})

export async function updateAcquisitionValue(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = UpdateAcquisitionSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, tenantId } = ctx

  const { error } = await supabase
    .from('vehicles')
    .update({ acquisition_amount: parsed.data.acquisition_amount })
    .eq('id', parsed.data.vehicle_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'update', table: 'vehicles', recordId: parsed.data.vehicle_id, newData: { acquisition_amount: parsed.data.acquisition_amount } })
  revalidatePath(`/financeiro/veiculos/${parsed.data.vehicle_id}`)
  return { ok: true, data: undefined }
}
