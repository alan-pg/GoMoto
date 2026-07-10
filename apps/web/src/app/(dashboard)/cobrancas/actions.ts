'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { BillingSchema, GeneratePixSchema, canGeneratePix } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { getOrCreatePix } from '@/lib/payment/pix'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createBilling(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = BillingSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('billings')
    .insert({ ...parsed.data, status: parsed.data.status ?? 'pending', tenant_id: tenantId })
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

const PAYMENT_METHOD_MAP: Record<string, 'pix' | 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer'> = {
  'PIX':               'pix',
  'Dinheiro':          'cash',
  'Cartão de Crédito': 'credit_card',
  'Cartão de Débito':  'debit_card',
  'Transferência':     'bank_transfer',
}

export async function markBillingAsPaid(id: string, paymentMethod: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const dbMethod = PAYMENT_METHOD_MAP[paymentMethod]
  if (!dbMethod) return { error: 'Método de pagamento inválido' }

  const { data: before } = await supabase.from('billings').select().eq('id', id).single()

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('billings')
    .update({
      status:           'paid',
      paid_at:          today,
      payment_method:   dbMethod,
      confirmed_source: 'manual',
      paid_by:          user.id,
    })
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
    .update({ status: 'prejudice' })
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

  if (error) {
    if (error.code === '23503') return { error: 'Esta cobrança possui histórico de Pix e não pode ser excluída' }
    return { error: 'Erro ao excluir cobrança' }
  }

  await logAction({ action: 'delete', table: 'billings', recordId: id, oldData: before })
  revalidatePath('/cobrancas')
  return { success: true }
}

export async function generatePixAction(billingId: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não resolvido' } }

  const parsed = GeneratePixSchema.safeParse({ billing_id: billingId })
  if (!parsed.success) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'ID de cobrança inválido' } }

  const { data: billing } = await supabase
    .from('billings')
    .select('id, status, original_amount, discount_amount, tenant_id')
    .eq('id', billingId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!billing) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (billing.status === 'paid') return { ok: false, error: { code: 'CONFLICT', message: 'Esta cobrança já foi paga' } }

  const { data: conn } = await supabase
    .from('payment_connections')
    .select('mp_user_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!canGeneratePix(billing, !!conn)) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Configure a integração de pagamento nas Configurações' } }
  }

  try {
    const result = await getOrCreatePix(billingId, tenantId, supabase)

    if (!result.is_reused) {
      await logAction({
        action: 'generate_pix',
        table: 'billing_pix',
        recordId: billingId,
        newData: { billing_id: billingId, tenant_id: tenantId, actor: 'operator' },
      })
    }

    revalidatePath('/cobrancas')
    return { ok: true, data: result }
  } catch (err: unknown) {
    const e = err as Error & { code?: string }
    if (e.code === 'FORBIDDEN') return { ok: false, error: { code: 'FORBIDDEN', message: 'Configure a integração de pagamento nas Configurações' } }
    return { ok: false, error: { code: 'INTERNAL', message: 'Falha ao gerar Pix. Tente novamente.' } }
  }
}
