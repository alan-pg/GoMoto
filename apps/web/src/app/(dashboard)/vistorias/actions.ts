/**
 * @file src/app/(dashboard)/vistorias/actions.ts
 * @description Server Actions de execução e análise de vistoria (Spec 0009 §5.1).
 * `submitAdminInspection` é consumida tanto pela lista de pendências quanto
 * pela tela da locação (RF-018) — mesma action nos dois pontos de entrada.
 */

'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { SubmitInspectionSchema, ReviewInspectionSchema, validateRequiredPhotos } from '@gomoto/core'
import type { ActionResult, InspectionAnswerRecord, InspectionPhotoRecord } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** Executa check-in ou check-out pendente (RF-012 a RF-015). */
export async function submitAdminInspection(inspectionId: string, rawData: unknown): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = SubmitInspectionSchema.safeParse(rawData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') },
    }
  }

  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!inspection) return { ok: false, error: { code: 'NOT_FOUND', message: 'Vistoria não encontrada' } }

  // RN-011 — periódica só pode ser executada pelo cliente
  if (inspection.kind === 'periodic') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Vistoria periódica só pode ser enviada pelo cliente' } }
  }
  if (inspection.status !== 'pending') {
    return { ok: false, error: { code: 'CONFLICT', message: 'Esta vistoria já foi executada' } }
  }

  const [checklistResult, photoResult] = await Promise.all([
    supabase.from('inspection_profile_checklist_items').select('*').eq('profile_id', inspection.inspection_profile_id),
    supabase.from('inspection_profile_photo_items').select('*').eq('profile_id', inspection.inspection_profile_id),
  ])
  const checklistItems = checklistResult.data ?? []
  const photoItems = photoResult.data ?? []

  // RF-014 / RN-007 — reafirma no backend a checagem de fotos obrigatórias
  const photoCheck = validateRequiredPhotos(
    photoItems.map((p) => ({ id: p.id, label: p.label, is_required: p.is_required })),
    parsed.data.photos,
  )
  if (!photoCheck.ok) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Foto obrigatória ausente: ${photoCheck.missingLabel}`, field: 'photos' },
    }
  }

  const checklistById = new Map(checklistItems.map((c) => [c.id as string, c]))
  const photoById = new Map(photoItems.map((p) => [p.id as string, p]))

  const answers: InspectionAnswerRecord[] = parsed.data.answers.map((a) => ({
    item_id: a.item_id,
    name: checklistById.get(a.item_id)?.name ?? '—',
    status: a.status,
    note: a.note,
  }))
  const photos: InspectionPhotoRecord[] = parsed.data.photos.map((p) => ({
    item_id: p.item_id,
    label: photoById.get(p.item_id)?.label ?? '—',
    is_required: photoById.get(p.item_id)?.is_required ?? false,
    storage_path: p.storage_path,
  }))

  const { error } = await supabase
    .from('inspections')
    .update({
      status: 'completed',
      answers,
      photos,
      executed_by_user_id: user.id,
      executed_at: new Date().toISOString(),
    })
    .eq('id', inspectionId)
  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar vistoria' } }

  await logAction({ action: 'update', table: 'inspections', recordId: inspectionId, newData: { status: 'completed', kind: inspection.kind } })
  revalidatePath('/vistorias')
  revalidatePath(`/locacoes/${inspection.rental_id}`)
  revalidatePath(`/vistorias/execute/${inspectionId}`)
  return { ok: true, data: undefined }
}

/** Aprova vistoria periódica submetida (RF-019). */
export async function approveInspection(inspectionId: string): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!inspection) return { ok: false, error: { code: 'NOT_FOUND', message: 'Vistoria não encontrada' } }
  if (inspection.kind !== 'periodic' || inspection.status !== 'submitted') {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Só é possível aprovar uma vistoria periódica submetida' } }
  }

  const { error } = await supabase
    .from('inspections')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', inspectionId)
  if (error) {
    // RN-013 — índice único parcial impede segunda aprovação para o mesmo schedule_id
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, error: { code: 'CONFLICT', message: 'Já existe uma vistoria aprovada para este agendamento' } }
    }
    return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao aprovar vistoria' } }
  }

  await logAction({ action: 'update', table: 'inspections', recordId: inspectionId, newData: { status: 'approved' } })
  revalidatePath('/vistorias')
  revalidatePath(`/locacoes/${inspection.rental_id}`)
  return { ok: true, data: undefined }
}

/** Rejeita vistoria periódica submetida, motivo obrigatório (RF-020). */
export async function rejectInspection(inspectionId: string, rawData: unknown): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const base = typeof rawData === 'object' && rawData !== null ? rawData : {}
  const parsed = ReviewInspectionSchema.safeParse({ ...base, decision: 'rejected' })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Motivo é obrigatório ao rejeitar', field: 'review_notes' },
    }
  }

  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!inspection) return { ok: false, error: { code: 'NOT_FOUND', message: 'Vistoria não encontrada' } }
  if (inspection.kind !== 'periodic' || inspection.status !== 'submitted') {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Só é possível rejeitar uma vistoria periódica submetida' } }
  }

  const { error } = await supabase
    .from('inspections')
    .update({
      status: 'rejected',
      review_notes: parsed.data.review_notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', inspectionId)
  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao rejeitar vistoria' } }

  await logAction({ action: 'update', table: 'inspections', recordId: inspectionId, newData: { status: 'rejected' } })
  revalidatePath('/vistorias')
  revalidatePath(`/locacoes/${inspection.rental_id}`)
  return { ok: true, data: undefined }
}
