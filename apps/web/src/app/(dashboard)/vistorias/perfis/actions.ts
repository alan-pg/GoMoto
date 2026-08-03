/**
 * @file src/app/(dashboard)/vistorias/perfis/actions.ts
 * @description Server Actions de mutação do Perfil de Vistoria (Spec 0009 §5.1).
 *
 * Padrão da casa (ADR 0002): actions co-localizadas com a tela, validação Zod
 * no servidor, `logAction()` em toda mutação, `revalidatePath` no fim.
 *
 * `checklist_items`/`photo_items` são salvos como "substitui tudo" — o
 * formulário edita o perfil como um todo (RF-004), não item a item. Seguro
 * porque `inspections.answers`/`.photos` gravam um snapshot no momento da
 * execução (ADR 0015 §Neutras) — não há FK viva do histórico para os itens
 * do perfil, então recriar IDs ao editar não invalida vistorias já feitas.
 */

'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CreateInspectionProfileSchema, UpdateInspectionProfileSchema } from '@gomoto/core'
import type { ActionResult } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createInspectionProfile(rawData: unknown): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = CreateInspectionProfileSchema.safeParse(rawData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Dados inválidos',
        field: first?.path?.map(String).join('.'),
      },
    }
  }

  const { data: profile, error: profileErr } = await supabase
    .from('inspection_profiles')
    .insert({ tenant_id: tenantId, name: parsed.data.name, description: parsed.data.description ?? null })
    .select()
    .single()
  if (profileErr) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao criar perfil' } }

  const checklistRows = parsed.data.checklist_items.map((item, idx) => ({
    tenant_id: tenantId, profile_id: profile.id, name: item.name, sort_order: item.sort_order ?? idx,
  }))
  const photoRows = parsed.data.photo_items.map((item, idx) => ({
    tenant_id: tenantId, profile_id: profile.id, label: item.label,
    is_required: item.is_required ?? true, sort_order: item.sort_order ?? idx,
  }))

  const [checklistResult, photoResult] = await Promise.all([
    supabase.from('inspection_profile_checklist_items').insert(checklistRows),
    supabase.from('inspection_profile_photo_items').insert(photoRows),
  ])
  if (checklistResult.error || photoResult.error) {
    await supabase.from('inspection_profiles').delete().eq('id', profile.id)
    return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao criar itens do perfil' } }
  }

  await logAction({ action: 'create', table: 'inspection_profiles', recordId: profile.id, newData: profile })
  revalidatePath('/vistorias/perfis')
  return { ok: true, data: { id: profile.id } }
}

export async function updateInspectionProfile(id: string, rawData: unknown): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = UpdateInspectionProfileSchema.safeParse(rawData)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Dados inválidos',
        field: first?.path?.map(String).join('.'),
      },
    }
  }

  const { data: before } = await supabase.from('inspection_profiles').select().eq('id', id).single()
  if (!before) return { ok: false, error: { code: 'NOT_FOUND', message: 'Perfil não encontrado' } }

  const payload: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) payload.name = parsed.data.name
  if (parsed.data.description !== undefined) payload.description = parsed.data.description ?? null

  if (Object.keys(payload).length > 0) {
    const { error } = await supabase.from('inspection_profiles').update(payload).eq('id', id)
    if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao atualizar perfil' } }
  }

  if (parsed.data.checklist_items) {
    const { error: delErr } = await supabase.from('inspection_profile_checklist_items').delete().eq('profile_id', id)
    if (delErr) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao substituir itens de checklist' } }
    const rows = parsed.data.checklist_items.map((item, idx) => ({
      tenant_id: tenantId, profile_id: id, name: item.name, sort_order: item.sort_order ?? idx,
    }))
    const { error } = await supabase.from('inspection_profile_checklist_items').insert(rows)
    if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar itens de checklist' } }
  }

  if (parsed.data.photo_items) {
    const { error: delErr } = await supabase.from('inspection_profile_photo_items').delete().eq('profile_id', id)
    if (delErr) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao substituir itens de foto' } }
    const rows = parsed.data.photo_items.map((item, idx) => ({
      tenant_id: tenantId, profile_id: id, label: item.label,
      is_required: item.is_required ?? true, sort_order: item.sort_order ?? idx,
    }))
    const { error } = await supabase.from('inspection_profile_photo_items').insert(rows)
    if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar itens de foto' } }
  }

  await logAction({ action: 'update', table: 'inspection_profiles', recordId: id, oldData: before, newData: payload })
  revalidatePath('/vistorias/perfis')
  return { ok: true, data: undefined }
}

export async function archiveInspectionProfile(id: string): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const { data: before } = await supabase.from('inspection_profiles').select().eq('id', id).single()
  if (!before) return { ok: false, error: { code: 'NOT_FOUND', message: 'Perfil não encontrado' } }
  if (before.archived_at) return { ok: true, data: undefined }

  const { error } = await supabase
    .from('inspection_profiles')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao arquivar perfil' } }

  await logAction({ action: 'update', table: 'inspection_profiles', recordId: id, oldData: before })
  revalidatePath('/vistorias/perfis')
  return { ok: true, data: undefined }
}

export async function unarchiveInspectionProfile(id: string): Promise<ActionResult<void>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const { data: before } = await supabase.from('inspection_profiles').select().eq('id', id).single()
  if (!before) return { ok: false, error: { code: 'NOT_FOUND', message: 'Perfil não encontrado' } }
  if (!before.archived_at) return { ok: true, data: undefined }

  const { error } = await supabase
    .from('inspection_profiles')
    .update({ archived_at: null })
    .eq('id', id)
  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao reativar perfil' } }

  await logAction({ action: 'update', table: 'inspection_profiles', recordId: id, oldData: before })
  revalidatePath('/vistorias/perfis')
  return { ok: true, data: undefined }
}
