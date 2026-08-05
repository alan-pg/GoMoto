'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { FineSchema } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createFine(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = FineSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('fines')
    .insert({ ...parsed.data, status: 'pending', tenant_id: tenantId })
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar multa' }

  await logAction({ action: 'create', table: 'fines', recordId: data.id, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function updateFine(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = FineSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('fines')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar multa' }

  await logAction({ action: 'update', table: 'fines', recordId: id, oldData: before, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function markFineAsPaid(id: string, paymentDate: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('fines')
    .update({ status: 'paid', payment_date: paymentDate })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao marcar multa como paga' }

  await logAction({ action: 'update', table: 'fines', recordId: id, oldData: before, newData: data })
  revalidatePath('/multas')
  return { data }
}

export async function deleteFine(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()
  const { error } = await supabase.from('fines').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir multa' }

  await logAction({ action: 'delete', table: 'fines', recordId: id, oldData: before })
  revalidatePath('/multas')
  return { success: true }
}

export async function addFineAttachment(
  fineId: string,
  type: string,
  fileUrl: string,
  label?: string,
  notes?: string,
) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido' }

  const { data, error } = await supabase
    .from('fine_attachments')
    .insert({ fine_id: fineId, tenant_id: tenantId, type, file_url: fileUrl, label: label ?? null, notes: notes ?? null })
    .select()
    .single()

  if (error) return { error: 'Erro ao salvar anexo' }

  await logAction({ action: 'create', table: 'fine_attachments', recordId: data.id, newData: data })
  revalidatePath(`/multas/${fineId}`)
  return { data }
}

export async function deleteFineAttachment(attachmentId: string, fineId: string, fileUrl: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fine_attachments').select().eq('id', attachmentId).single()
  const { error } = await supabase.from('fine_attachments').delete().eq('id', attachmentId)
  if (error) return { error: 'Erro ao remover anexo' }

  await supabase.storage.from('fine-documents').remove([fileUrl])

  await logAction({ action: 'delete', table: 'fine_attachments', recordId: attachmentId, oldData: before })
  revalidatePath(`/multas/${fineId}`)
  return { success: true }
}
