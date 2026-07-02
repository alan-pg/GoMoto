'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  MotorcycleSchema,
  VehicleStatusTransitionSchema,
  type VehicleStatus,
  type VehiclePhotoSlot,
  type ActionResult,
} from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { recordStatusTransition } from '@/lib/vehicle-status-history'
import { canChangeStatus } from '@gomoto/core'

async function getAuthenticatedContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tenantId = user ? await getCurrentTenantId(supabase) : null
  return { supabase, user, tenantId }
}

export async function createVehicle(
  input: unknown,
  photos?: Partial<Record<VehiclePhotoSlot, string>>,
): Promise<ActionResult<{ id: string; failedSlots?: VehiclePhotoSlot[] }>> {
  const { supabase, user, tenantId } = await getAuthenticatedContext()

  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }
  if (!tenantId) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Tenant não resolvido' } }
  }

  const parsed = MotorcycleSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Dados inválidos',
        field: firstIssue?.path.join('.'),
      },
    }
  }

  const { data: moto, error: insertError } = await supabase
    .from('motorcycles')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()

  if (insertError) {
    if (insertError.code === '23505' && insertError.message.includes('license_plate')) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Esta placa já está cadastrada.', field: 'license_plate' },
      }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao cadastrar veículo' } }
  }

  try {
    await recordStatusTransition(supabase, {
      motorcycleId:   moto.id,
      tenantId,
      previousStatus: null,
      newStatus:      moto.status as VehicleStatus,
      userId:         user.id,
    })
  } catch {
    // Falha no histórico não deve bloquear o cadastro já criado — logar e continuar
    console.error('[createVehicle] recordStatusTransition failed for', moto.id)
  }

  const failedSlots: VehiclePhotoSlot[] = []
  if (photos) {
    await Promise.allSettled(
      (Object.entries(photos) as [VehiclePhotoSlot, string][])
        .filter(([, url]) => !!url)
        .map(async ([slot, url]) => {
          const { error } = await supabase.from('vehicle_photos').upsert({
            motorcycle_id: moto.id,
            tenant_id:     tenantId,
            slot,
            url,
          }, { onConflict: 'motorcycle_id,slot' })
          if (error) {
            console.error('[createVehicle] photo upsert failed', { motorcycleId: moto.id, slot })
            failedSlots.push(slot)
          }
        }),
    )
  }

  await logAction({ action: 'create', table: 'motorcycles', recordId: moto.id, newData: moto })
  revalidatePath('/motos')
  revalidatePath(`/motos/${moto.id}`)

  return {
    ok: true,
    data: { id: moto.id, ...(failedSlots.length > 0 ? { failedSlots } : {}) },
  }
}

export async function updateVehicle(
  motorcycleId: string,
  input: unknown,
  photos?: Partial<Record<VehiclePhotoSlot, string | null>>,
): Promise<ActionResult<{ id: string; failedSlots?: VehiclePhotoSlot[] }>> {
  const { supabase, user, tenantId } = await getAuthenticatedContext()

  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }
  if (!tenantId) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Tenant não resolvido' } }
  }

  const { data: current, error: fetchError } = await supabase
    .from('motorcycles')
    .select('id, status, km_entry')
    .eq('id', motorcycleId)
    .single()

  if (fetchError || !current) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Veículo não encontrado', field: 'id' } }
  }

  const parsed = MotorcycleSchema.partial().safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: firstIssue?.message ?? 'Dados inválidos',
        field: firstIssue?.path.join('.'),
      },
    }
  }

  // km_entry é imutável (RF-015) — ignorar mesmo se enviado
  const { km_entry: _ignored, ...updateData } = parsed.data

  // Se moto está Locada, status não pode ser alterado (RN-002)
  if (current.status === 'rented' && updateData.status) {
    delete updateData.status
  }

  const previousStatus = current.status as VehicleStatus
  const newStatus = updateData.status as VehicleStatus | undefined

  const { data: updatedMoto, error: updateError } = await supabase
    .from('motorcycles')
    .update(updateData)
    .eq('id', motorcycleId)
    .select()
    .single()

  if (updateError) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao atualizar veículo' } }
  }

  if (newStatus && newStatus !== previousStatus) {
    await recordStatusTransition(supabase, {
      motorcycleId,
      tenantId,
      previousStatus,
      newStatus,
      userId: user.id,
    })
  }

  const failedSlots: VehiclePhotoSlot[] = []
  if (photos) {
    await Promise.allSettled(
      (Object.entries(photos) as [VehiclePhotoSlot, string | null][]).map(async ([slot, url]) => {
        if (url === null) {
          // Deletar foto do slot
          const { data: existing } = await supabase
            .from('vehicle_photos')
            .select('url')
            .eq('motorcycle_id', motorcycleId)
            .eq('slot', slot)
            .maybeSingle()

          if (existing?.url) {
            await supabase.storage.from('vehicle-photos').remove([existing.url])
          }
          await supabase
            .from('vehicle_photos')
            .delete()
            .eq('motorcycle_id', motorcycleId)
            .eq('slot', slot)
        } else if (url) {
          const { error } = await supabase.from('vehicle_photos').upsert({
            motorcycle_id: motorcycleId,
            tenant_id:     tenantId,
            slot,
            url,
          }, { onConflict: 'motorcycle_id,slot' })
          if (error) {
            console.error('[updateVehicle] photo upsert failed', { motorcycleId, slot })
            failedSlots.push(slot)
          }
        }
      }),
    )
  }

  await logAction({
    action: 'update',
    table: 'motorcycles',
    recordId: motorcycleId,
    oldData: current,
    newData: updatedMoto,
  })
  revalidatePath('/motos')
  revalidatePath(`/motos/${motorcycleId}`)

  return {
    ok: true,
    data: { id: motorcycleId, ...(failedSlots.length > 0 ? { failedSlots } : {}) },
  }
}

export async function changeVehicleStatus(
  motorcycleId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user, tenantId } = await getAuthenticatedContext()

  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }
  if (!tenantId) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Tenant não resolvido' } }
  }

  const parsed = VehicleStatusTransitionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  const { new_status: newStatus } = parsed.data

  // changeVehicleStatus só aceita sold, inactive, available
  if (!['sold', 'inactive', 'available'].includes(newStatus)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Transição não permitida por este endpoint' },
    }
  }

  const { data: moto, error: fetchError } = await supabase
    .from('motorcycles')
    .select('id, status')
    .eq('id', motorcycleId)
    .single()

  if (fetchError || !moto) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Veículo não encontrado', field: 'id' } }
  }

  const currentStatus = moto.status as VehicleStatus

  if (!canChangeStatus(currentStatus, newStatus)) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: `Não é possível alterar de "${currentStatus}" para "${newStatus}"`,
      },
    }
  }

  const { error: updateError } = await supabase
    .from('motorcycles')
    .update({ status: newStatus })
    .eq('id', motorcycleId)

  if (updateError) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao atualizar status' } }
  }

  await recordStatusTransition(supabase, {
    motorcycleId,
    tenantId,
    previousStatus: currentStatus,
    newStatus,
    userId: user.id,
  })

  await logAction({
    action: 'update',
    table: 'motorcycles',
    recordId: motorcycleId,
    oldData: { status: currentStatus },
    newData: { status: newStatus },
  })

  revalidatePath('/motos')
  revalidatePath(`/motos/${motorcycleId}`)

  return { ok: true, data: { id: motorcycleId } }
}

export async function deleteVehiclePhoto(
  motorcycleId: string,
  slot: VehiclePhotoSlot,
): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedContext()

  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }

  const { data: photo } = await supabase
    .from('vehicle_photos')
    .select('url')
    .eq('motorcycle_id', motorcycleId)
    .eq('slot', slot)
    .maybeSingle()

  if (photo?.url) {
    await supabase.storage.from('vehicle-photos').remove([photo.url])
  }

  const { error } = await supabase
    .from('vehicle_photos')
    .delete()
    .eq('motorcycle_id', motorcycleId)
    .eq('slot', slot)

  if (error) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao remover foto' } }
  }

  await logAction({ action: 'delete', table: 'vehicle_photos', recordId: motorcycleId })

  revalidatePath(`/motos/${motorcycleId}`)
  revalidatePath('/motos')

  return { ok: true, data: undefined }
}
