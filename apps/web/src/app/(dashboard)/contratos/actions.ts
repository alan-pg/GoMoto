'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { CONTRACT_TERMINATION_FINE_BRL } from '@gomoto/core'
import { z } from 'zod'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// Zod 4 `z.string().uuid()` valida o variant byte (4º grupo deve começar com
// 8|9|a|b). IDs sintéticos do seed local (`11111111-1111-1111-1111-111111111111`)
// não respeitam isso e falhariam, mesmo sendo aceitos pelo Postgres como UUID
// válido. Usamos um regex de formato livre — a FK do banco garante existência.
const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ContractSchema = z.object({
  customer_id: z.string().regex(UUID_LOOSE),
  motorcycle_id: z.string().regex(UUID_LOOSE),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthly_amount: z.number().positive().max(9999999),
  status: z.enum(['active', 'closed', 'transferred']).optional(),
  pdf_url: z.string().url().optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
})

export async function createContract(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = ContractSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('rentals')
    .insert({ ...parsed.data, status: parsed.data.status ?? 'active', tenant_id: tenantId })
    .select()
    .single()

  if (error) return { error: 'Erro ao criar contrato' }

  await logAction({ action: 'create', table: 'rentals', recordId: data.id, newData: data })
  revalidatePath('/contratos')
  return { data }
}

export async function updateContract(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ContractSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('rentals').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('rentals')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar contrato' }

  await logAction({ action: 'update', table: 'rentals', recordId: id, oldData: before, newData: data })
  revalidatePath('/contratos')
  return { data }
}

export async function deleteContract(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('rentals').select().eq('id', id).single()
  const { error } = await supabase.from('rentals').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir contrato' }

  await logAction({ action: 'delete', table: 'rentals', recordId: id, oldData: before })
  revalidatePath('/contratos')
  return { success: true }
}

/**
 * Encerra contrato pela vontade do cliente (rescisão antecipada).
 * Operação composta com 3 mutações: cancela contrato, gera multa para o
 * cliente e libera a moto. Cada mutação registra entrada própria no
 * audit log para preservar rastreabilidade fim a fim.
 */
export async function terminateContractByCustomer(contractId: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const { data: contract } = await supabase
    .from('rentals')
    .select('id, customer_id, motorcycle_id, status, end_date')
    .eq('id', contractId)
    .single()
  if (!contract) return { error: 'Contrato não encontrado' }

  const today = new Date().toISOString().split('T')[0]

  const { data: updatedContract, error: contractErr } = await supabase
    .from('rentals')
    .update({ status: 'closed', end_date: today })
    .eq('id', contractId)
    .select()
    .single()
  if (contractErr) return { error: 'Erro ao encerrar contrato' }
  await logAction({
    action: 'update', table: 'rentals', recordId: contractId,
    oldData: contract, newData: updatedContract,
  })

  const { data: fine, error: fineErr } = await supabase
    .from('fines')
    .insert({
      customer_id: contract.customer_id,
      motorcycle_id: contract.motorcycle_id,
      description: 'Multa por rescisão antecipada de contrato',
      amount: CONTRACT_TERMINATION_FINE_BRL,
      infraction_date: today,
      due_date: today,
      status: 'pending',
      responsible: 'customer',
      tenant_id: tenantId,
    })
    .select()
    .single()
  if (fineErr) return { error: 'Erro ao gerar multa de rescisão' }
  await logAction({ action: 'create', table: 'fines', recordId: fine.id, newData: fine })

  const { data: motoBefore } = await supabase
    .from('motorcycles').select().eq('id', contract.motorcycle_id).single()
  const { data: moto, error: motoErr } = await supabase
    .from('motorcycles')
    .update({ status: 'available' })
    .eq('id', contract.motorcycle_id)
    .select()
    .single()
  if (motoErr) return { error: 'Erro ao liberar a moto' }
  await logAction({
    action: 'update', table: 'motorcycles', recordId: contract.motorcycle_id,
    oldData: motoBefore, newData: moto,
  })

  revalidatePath('/contratos')
  return { data: { fineAmount: CONTRACT_TERMINATION_FINE_BRL } }
}

/**
 * Encerra contrato pela empresa (sem multa). Exige justificativa
 * detalhada (mín. 50 caracteres) gravada em `observations`.
 */
export async function terminateContractByCompany(contractId: string, reason: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  if (!reason || reason.trim().length < 50) {
    return { error: 'Motivo é obrigatório e deve ter ao menos 50 caracteres' }
  }

  const { data: contract } = await supabase
    .from('rentals')
    .select('id, motorcycle_id, status, end_date, observations')
    .eq('id', contractId)
    .single()
  if (!contract) return { error: 'Contrato não encontrado' }

  const today = new Date().toISOString().split('T')[0]

  const { data: updatedContract, error: contractErr } = await supabase
    .from('rentals')
    .update({ status: 'closed', end_date: today, observations: reason.trim() })
    .eq('id', contractId)
    .select()
    .single()
  if (contractErr) return { error: 'Erro ao encerrar contrato' }
  await logAction({
    action: 'update', table: 'rentals', recordId: contractId,
    oldData: contract, newData: updatedContract,
  })

  const { data: motoBefore } = await supabase
    .from('motorcycles').select().eq('id', contract.motorcycle_id).single()
  const { data: moto, error: motoErr } = await supabase
    .from('motorcycles')
    .update({ status: 'available' })
    .eq('id', contract.motorcycle_id)
    .select()
    .single()
  if (motoErr) return { error: 'Erro ao liberar a moto' }
  await logAction({
    action: 'update', table: 'motorcycles', recordId: contract.motorcycle_id,
    oldData: motoBefore, newData: moto,
  })

  revalidatePath('/contratos')
  return { success: true }
}

const TemplateUpsertSchema = z.object({
  slug: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  file_url: z.string().url(),
})

/**
 * Upsert do modelo de contrato (.docx). `tenant_id` é resolvido server-side
 * para evitar manipulação client-side; templates são por tenant (Fase 5).
 */
export async function upsertContractTemplate(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = TemplateUpsertSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase
    .from('contract_templates').select().eq('slug', parsed.data.slug).maybeSingle()

  const { data, error } = await supabase
    .from('contract_templates')
    .upsert(
      { ...parsed.data, updated_at: new Date().toISOString(), tenant_id: tenantId },
      { onConflict: 'slug' },
    )
    .select()
    .single()

  if (error) return { error: 'Erro ao salvar modelo de contrato' }

  await logAction({
    action: before ? 'update' : 'create',
    table: 'contract_templates',
    recordId: data.id,
    oldData: before, newData: data,
  })
  revalidatePath('/contratos')
  return { data }
}

export async function removeContractTemplate(slug: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase
    .from('contract_templates').select().eq('slug', slug).maybeSingle()
  if (!before) return { error: 'Modelo não encontrado' }

  const { data, error } = await supabase
    .from('contract_templates')
    .update({ file_url: null, updated_at: null })
    .eq('slug', slug)
    .select()
    .single()

  if (error) return { error: 'Erro ao remover modelo' }

  await logAction({
    action: 'update', table: 'contract_templates', recordId: before.id,
    oldData: before, newData: data,
  })
  revalidatePath('/contratos')
  return { success: true }
}
