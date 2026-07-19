'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ExpenseSchema } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { ActionResult, LateChargeConfig } from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createExpense(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = ExpenseSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()

  if (error) return { error: 'Erro ao registrar despesa' }

  await logAction({ action: 'create', table: 'expenses', recordId: data.id, newData: data })
  revalidatePath('/despesas')
  return { data }
}

export async function updateExpense(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = ExpenseSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('expenses').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('expenses')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar despesa' }

  await logAction({ action: 'update', table: 'expenses', recordId: id, oldData: before, newData: data })
  revalidatePath('/despesas')
  return { data }
}

export async function deleteExpense(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('expenses').select().eq('id', id).single()
  const { error } = await supabase.from('expenses').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir despesa' }

  await logAction({ action: 'delete', table: 'expenses', recordId: id, oldData: before })
  revalidatePath('/despesas')
  return { success: true }
}

// ============================================================
// confirmExpenseBilling — gera cobrança a partir de despesa (RF-017)
// ============================================================

const LateChargeConfigSchema = z.object({
  late_fee_type:       z.enum(['fixed', 'percentage']),
  late_fee_value:      z.number().min(0),
  daily_interest_rate: z.number().min(0).max(1),
  grace_period_days:   z.number().int().min(0),
})

const ConfirmExpenseSchema = z.discriminatedUnion('action', [
  z.object({
    action:             z.literal('confirm'),
    expense_id:         uuid(),
    amount:             z.number().positive(),
    due_date:           dateString,
    rental_id:          uuid().optional(),
    late_charge_config: LateChargeConfigSchema,
  }),
  z.object({
    action:     z.literal('refuse'),
    expense_id: uuid(),
  }),
])

export async function confirmExpenseBilling(
  input: unknown,
): Promise<ActionResult<{ confirmed: true; billing_id: string } | { confirmed: false } | { no_active_rental: true }>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = ConfirmExpenseSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  if (parsed.data.action === 'refuse') {
    await logAction({ action: 'update', table: 'expenses', recordId: parsed.data.expense_id, newData: { billing_refused: true } })
    return { ok: true, data: { confirmed: false } }
  }

  let rentalId = parsed.data.rental_id
  let customerId: string | null = null

  if (!rentalId) {
    const { data: expense } = await supabase
      .from('expenses').select('vehicle_id').eq('id', parsed.data.expense_id).eq('tenant_id', tenantId).single()

    if (expense?.vehicle_id) {
      const { data: rental } = await supabase
        .from('rentals').select('id, customer_id').eq('vehicle_id', expense.vehicle_id).eq('tenant_id', tenantId).eq('status', 'active').maybeSingle()
      if (!rental) return { ok: true, data: { no_active_rental: true } }
      rentalId = rental.id
      customerId = rental.customer_id
    } else {
      return { ok: true, data: { no_active_rental: true } }
    }
  } else {
    const { data: rental } = await supabase.from('rentals').select('customer_id').eq('id', rentalId).eq('tenant_id', tenantId).single()
    customerId = rental?.customer_id ?? null
  }

  const { data: billing, error } = await supabase
    .from('billings')
    .insert({
      tenant_id:          tenantId,
      lease_id:           rentalId,
      customer_id:        customerId,
      description:        'Cobrança de despesa',
      original_amount:    parsed.data.amount,
      due_date:           parsed.data.due_date,
      billing_type:       'one_time',
      source:             'expense',
      late_charge_config: parsed.data.late_charge_config as LateChargeConfig,
      status:             'pending',
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'create', table: 'billings', recordId: billing.id, newData: { source: 'expense', expense_id: parsed.data.expense_id } })
  revalidatePath('/cobrancas')
  revalidatePath('/despesas')
  return { ok: true, data: { confirmed: true, billing_id: billing.id } }
}
