'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { createCharge } from '@/lib/financial'
import { ACCOUNTS } from '@gomoto/core'
import type { ActionResult } from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')

const LateChargeConfigSchema = z.object({
  late_fee_type:       z.enum(['fixed', 'percentage']),
  late_fee_value:      z.number().min(0),
  daily_interest_rate: z.number().min(0).max(1),
  grace_period_days:   z.number().int().min(0),
})

async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'UNAUTHORIZED' as const }
  return { supabase, user, tenantId }
}

// ============================================================
// confirmAutoBilling — gera cobrança a partir de manutenção (RF-017)
// ============================================================

const ConfirmSchema = z.discriminatedUnion('action', [
  z.object({
    action:             z.literal('confirm'),
    maintenance_id:     uuid(),
    amount:             z.number().positive(),
    due_date:           dateString,
    rental_id:          uuid().optional(),
    late_charge_config: LateChargeConfigSchema,
  }),
  z.object({
    action:         z.literal('refuse'),
    maintenance_id: uuid(),
  }),
])

export async function confirmAutoBilling(
  input: unknown,
): Promise<ActionResult<{ confirmed: true; billing_id: string } | { confirmed: false } | { no_active_rental: true }>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = ConfirmSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, tenantId, user } = ctx

  if (parsed.data.action === 'refuse') {
    await logAction({ action: 'update', table: 'maintenances', recordId: parsed.data.maintenance_id, newData: { billing_refused: true } })
    return { ok: true, data: { confirmed: false } }
  }

  // Resolve rental + customer
  let rentalId = parsed.data.rental_id
  let customerId: string | null = null
  let vehicleId: string | null = null

  if (!rentalId) {
    const { data: maintenance } = await supabase
      .from('maintenances').select('vehicle_id').eq('id', parsed.data.maintenance_id).eq('tenant_id', tenantId).single()

    vehicleId = maintenance?.vehicle_id ?? null

    if (maintenance?.vehicle_id) {
      const { data: rental } = await supabase
        .from('rentals').select('id, customer_id').eq('vehicle_id', maintenance.vehicle_id).eq('tenant_id', tenantId).eq('status', 'active').maybeSingle()
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

  if (!customerId) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Locação sem cliente vinculado.' } }
  }

  // Repasse de manutenção credita conta de REPASSE, não receita: é custo da
  // empresa recuperado do cliente (ADR 0024, R-03). A terceira e última cópia
  // da lógica de sincronizar cobrança sai daqui.
  let billing: { id: string }
  try {
    const charge = await createCharge(supabase, tenantId, {
      customerId,
      rentalId: rentalId ?? null,
      dueDate: parsed.data.due_date,
      sourceModule: 'maintenance',
      sourceId: parsed.data.maintenance_id,
      createdBy: user!.id,
      items: [{
        description: 'Manutenção',
        credit_account_code: ACCOUNTS.MAINTENANCE_REIMBURSEMENT,
        quantity: 1,
        unit_amount: parsed.data.amount,
        amount: parsed.data.amount,
        source_module: 'maintenance',
        source_id: parsed.data.maintenance_id,
        vehicle_id: vehicleId,
      }],
    })
    billing = { id: charge.chargeId }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: String(err) } }
  }

  await logAction({ action: 'create', table: 'charges', recordId: billing.id, newData: { source: 'maintenance', maintenance_id: parsed.data.maintenance_id } })
  revalidatePath('/cobrancas')
  revalidatePath('/manutencao')
  return { ok: true, data: { confirmed: true, billing_id: billing.id } }
}
