'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { ContractTemplateSchema } from '@gomoto/core'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createContractTemplate(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido' }

  const parsed = ContractTemplateSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('contract_templates')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()

  if (error) return { error: 'Erro ao criar modelo de contrato' }

  await logAction({ action: 'create', table: 'contract_templates', recordId: data.id, newData: data })
  revalidatePath('/contratos/modelos')
  return { data }
}

export async function updateContractTemplate(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ContractTemplateSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase
    .from('contract_templates').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('contract_templates')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar modelo de contrato' }

  await logAction({ action: 'update', table: 'contract_templates', recordId: id, oldData: before, newData: data })
  revalidatePath('/contratos/modelos')
  revalidatePath(`/contratos/modelos/${id}`)
  return { data }
}

export async function deleteContractTemplate(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase
    .from('contract_templates').select().eq('id', id).single()

  if (!before) return { error: 'Modelo não encontrado' }

  const { error } = await supabase
    .from('contract_templates')
    .delete()
    .eq('id', id)

  if (error) return { error: 'Erro ao excluir modelo de contrato' }

  await logAction({ action: 'delete', table: 'contract_templates', recordId: id, oldData: before })
  revalidatePath('/contratos/modelos')
  return { success: true }
}
