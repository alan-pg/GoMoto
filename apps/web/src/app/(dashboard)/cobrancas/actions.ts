'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { BillingSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createBilling(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = BillingSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('billings')
    .insert({ ...parsed.data, status: parsed.data.status ?? 'pending' })
    .select()
    .single()

  if (error) return { error: 'Erro ao criar cobrança' }

  await logAction({ action: 'create', table: 'billings', recordId: data.id, newData: data })
  revalidatePath('/cobrancas')
  return { data }
}

export async function updateBilling(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = BillingSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('billings').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('billings')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar cobrança' }

  await logAction({ action: 'update', table: 'billings', recordId: id, oldData: before, newData: data })
  revalidatePath('/cobrancas')
  return { data }
}

const VALID_PAYMENT_METHODS = ['PIX', 'Dinheiro', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência']

export async function markBillingAsPaid(id: string, paymentMethod: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    return { error: 'Método de pagamento inválido' }
  }

  const { data: before } = await supabase.from('billings').select().eq('id', id).single()

  const today = new Date().toISOString().split('T')[0]
  const existingObs = before?.observations ?? ''
  const observations = existingObs
    ? `${existingObs} | Recebido via ${paymentMethod}`
    : `Recebido via ${paymentMethod}`

  const { data, error } = await supabase
    .from('billings')
    .update({ status: 'paid', payment_date: today, observations })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao marcar como recebido' }

  await logAction({ action: 'update', table: 'billings', recordId: id, oldData: before, newData: data })
  revalidatePath('/cobrancas')
  return { data }
}

export async function markBillingAsLoss(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('billings').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('billings')
    .update({ status: 'loss' })
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao marcar como prejuízo' }

  await logAction({ action: 'update', table: 'billings', recordId: id, oldData: before, newData: data })
  revalidatePath('/cobrancas')
  return { data }
}

export async function deleteBilling(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('billings').select().eq('id', id).single()
  const { error } = await supabase.from('billings').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir cobrança' }

  await logAction({ action: 'delete', table: 'billings', recordId: id, oldData: before })
  revalidatePath('/cobrancas')
  return { success: true }
}
