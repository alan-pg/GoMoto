'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { ActionResult } from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')

async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'UNAUTHORIZED' as const }
  return { supabase, user, tenantId }
}

/**
 * `delinquency_blocks` é log append-only com `action` block/unblock — não há
 * coluna de estado. Bloqueado = a última ação registrada é 'block'.
 *
 * Antes isso era lido de `customers.delinquency_status`, coluna removida pela
 * ADR 0024 (era mantida por trigger inerte: ficava 'current' para sempre,
 * inclusive para quem devia — F-04).
 *
 * Não exportada: arquivo `'use server'` só pode exportar função async que seja
 * Server Action de fato.
 */
async function isBlocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  customerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('delinquency_blocks')
    .select('action')
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId)
    .order('acted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as { action: string } | null)?.action === 'block'
}

// ============================================================
// createCustomerCredit — lança crédito para o cliente (RF-022)
// ============================================================

const CreateCreditSchema = z.object({
  customer_id: uuid(),
  amount:      z.number().positive(),
  origin:      z.enum(['maintenance_refund', 'reversal', 'manual_adjustment']),
  reason:      z.string().min(5).max(500),
})

export async function createCustomerCredit(
  input: unknown,
): Promise<ActionResult<{ credit_id: string }>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = CreateCreditSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, user, tenantId } = ctx

  const { data: customer } = await supabase
    .from('customers').select('id').eq('id', parsed.data.customer_id).eq('tenant_id', tenantId).single()

  if (!customer) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cliente não encontrado' } }

  const { data: credit, error } = await supabase
    .from('customer_credits')
    .insert({
      tenant_id:         tenantId,
      customer_id:       parsed.data.customer_id,
      amount:            parsed.data.amount,
      available_balance: parsed.data.amount,
      origin:            parsed.data.origin,
      reason:            parsed.data.reason,
      created_by:        user.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'create', table: 'customer_credits', recordId: credit.id, newData: { customer_id: parsed.data.customer_id, amount: parsed.data.amount } })
  revalidatePath(`/clientes/${parsed.data.customer_id}`)
  return { ok: true, data: { credit_id: credit.id } }
}

// ============================================================
// blockCustomer — bloqueio manual de cliente inadimplente (RF-035)
// ============================================================

const BlockCustomerSchema = z.object({
  customer_id: uuid(),
  reason:      z.string().min(5, 'Motivo deve ter ao menos 5 caracteres').max(500),
})

export async function blockCustomer(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = BlockCustomerSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, user, tenantId } = ctx

  const { data: customer } = await supabase
    .from('customers').select('id').eq('id', parsed.data.customer_id).eq('tenant_id', tenantId).single()

  if (!customer) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cliente não encontrado' } }
  if (await isBlocked(supabase, tenantId, parsed.data.customer_id)) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Cliente já está bloqueado' } }
  }

  const { error } = await supabase.from('delinquency_blocks').insert({
    tenant_id:   tenantId,
    customer_id: parsed.data.customer_id,
    action:      'block',
    reason:      parsed.data.reason,
    actor_id:    user.id,
  })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'create', table: 'delinquency_blocks', recordId: parsed.data.customer_id, newData: { action: 'block', reason: parsed.data.reason } })
  revalidatePath(`/clientes/${parsed.data.customer_id}`)
  revalidatePath('/clientes')
  return { ok: true, data: undefined }
}

// ============================================================
// unblockCustomer — desbloqueio manual com justificativa (RF-036)
// ============================================================

const UnblockCustomerSchema = z.object({
  customer_id:   uuid(),
  justification: z.string().min(5, 'Justificativa deve ter ao menos 5 caracteres').max(500),
})

export async function unblockCustomer(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = UnblockCustomerSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, user, tenantId } = ctx

  const { data: customer } = await supabase
    .from('customers').select('id').eq('id', parsed.data.customer_id).eq('tenant_id', tenantId).single()

  if (!customer) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cliente não encontrado' } }
  if (!(await isBlocked(supabase, tenantId, parsed.data.customer_id))) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Cliente não está bloqueado' } }
  }

  const { error } = await supabase.from('delinquency_blocks').insert({
    tenant_id:   tenantId,
    customer_id: parsed.data.customer_id,
    action:      'unblock',
    reason:      parsed.data.justification,
    actor_id:    user.id,
  })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'create', table: 'delinquency_blocks', recordId: parsed.data.customer_id, newData: { action: 'unblock', justification: parsed.data.justification } })
  revalidatePath(`/clientes/${parsed.data.customer_id}`)
  revalidatePath('/clientes')
  return { ok: true, data: undefined }
}
