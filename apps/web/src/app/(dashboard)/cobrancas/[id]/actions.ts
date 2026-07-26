'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { calculateLateCharges } from '@gomoto/core'
import type { LateChargeConfig } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { ActionResult } from '@gomoto/core'

// Zod 4 uuid() é estrito (RFC 4122 variant). IDs do seed local usam formatos
// não-RFC e falhariam na validação; usamos regex frouxo — FK do banco garante existência.
const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')

async function getAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'UNAUTHORIZED' as const }
  return { supabase, user, tenantId }
}

// ============================================================
// registerPayment — registra pagamento na tabela `payments` (ADR 0013)
// Captura encargos em `late_charges` e marca billing como 'paid'
// ============================================================

const RegisterPaymentSchema = z.object({
  billing_id: uuid(),
  amount:     z.number().positive(),
  payment_method: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other']),
  paid_at:    z.string().datetime(),
  notes:      z.string().max(500).optional(),
})

export async function registerPayment(
  input: unknown,
): Promise<ActionResult<{ payment_id: string }>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = RegisterPaymentSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, user, tenantId } = ctx

  const { data: billing, error: billingErr } = await supabase
    .from('billings')
    .select('id, status, billing_type, original_amount, discount_amount, credit_applied, late_charge_config, due_date, lease_id, customer_id')
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)
    .single()

  if (billingErr || !billing) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }

  if (billing.status === 'paid') return { ok: false, error: { code: 'CONFLICT', message: 'Cobrança já paga' } }
  if (billing.status === 'cancelled') return { ok: false, error: { code: 'CONFLICT', message: 'Cobrança cancelada' } }

  const baseAmount = (billing.original_amount ?? 0) - (billing.discount_amount ?? 0)
  const chargesCalc = billing.late_charge_config
    ? calculateLateCharges(billing.late_charge_config as LateChargeConfig, baseAmount, billing.due_date)
    : null

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      tenant_id: tenantId,
      billing_id: parsed.data.billing_id,
      customer_id: billing.customer_id,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      paid_at: parsed.data.paid_at,
      received_by: user.id,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()

  if (payErr) return { ok: false, error: { code: 'INTERNAL', message: payErr.message } }

  // Captura snapshot de encargos no momento do pagamento (RNF-009)
  if (chargesCalc && !chargesCalc.grace_period_active && chargesCalc.total > 0) {
    await supabase.from('late_charges').insert({
      tenant_id: tenantId,
      billing_id: parsed.data.billing_id,
      fee_amount: chargesCalc.fee,
      interest_amount: chargesCalc.interest,
      days_overdue: chargesCalc.days_overdue,
      snapshot_config: billing.late_charge_config,
      captured_at: parsed.data.paid_at,
    })
  }

  await supabase
    .from('billings')
    .update({ status: 'paid', paid_at: parsed.data.paid_at, payment_method: parsed.data.payment_method })
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)

  // Cobrança de caução paga → libera o saldo pro cliente (gatilho da caução
  // ainda-não-paga virar disponível, ver locacoes/actions.ts::createRental).
  if (billing.billing_type === 'deposit') {
    await supabase
      .from('deposits')
      .update({ status: 'received', balance: billing.original_amount, received_at: parsed.data.paid_at })
      .eq('billing_id', parsed.data.billing_id)
      .eq('tenant_id', tenantId)
  }

  await logAction({ action: 'create', table: 'payments', recordId: payment.id, newData: { billing_id: parsed.data.billing_id, amount: parsed.data.amount } })
  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
  if (billing.lease_id) revalidatePath(`/locacoes/${billing.lease_id}`)
  return { ok: true, data: { payment_id: payment.id } }
}

// ============================================================
// waiveCharges — dispensa encargos de uma cobrança (RF-015, RN-014)
// Irreversível: registra snapshot de encargos zerando fee/interest
// ============================================================

const WaiveChargesSchema = z.object({
  billing_id: uuid(),
  reason:     z.string().min(5, 'Motivo deve ter ao menos 5 caracteres').max(500),
})

export async function waiveCharges(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = WaiveChargesSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, user, tenantId } = ctx

  const { data: billing, error: billingErr } = await supabase
    .from('billings')
    .select('id, status, charges_waived')
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)
    .single()

  if (billingErr || !billing) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (billing.status === 'paid') return { ok: false, error: { code: 'CONFLICT', message: 'Cobrança já paga — encargos não podem ser dispensados' } }
  if (billing.charges_waived) return { ok: false, error: { code: 'CONFLICT', message: 'Encargos já dispensados' } }

  const { error } = await supabase
    .from('billings')
    .update({ charges_waived: true, waiver_reason: parsed.data.reason, waiver_by: user.id, waiver_at: new Date().toISOString() })
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'update', table: 'billings', recordId: parsed.data.billing_id, newData: { charges_waived: true, waiver_reason: parsed.data.reason } })
  revalidatePath('/cobrancas')
  return { ok: true, data: undefined }
}

// ============================================================
// applyCredit — aplica crédito do cliente em uma cobrança (RF-023–025)
// ============================================================

const ApplyCreditSchema = z.object({
  billing_id: uuid(),
  credit_id:  uuid(),
  amount:     z.number().positive(),
})

export async function applyCredit(
  input: unknown,
): Promise<ActionResult<{ new_amount_due: number }>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = ApplyCreditSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { supabase, tenantId } = ctx

  const [billingRes, creditRes] = await Promise.all([
    supabase.from('billings').select('id, status, original_amount, discount_amount, credit_applied').eq('id', parsed.data.billing_id).eq('tenant_id', tenantId).single(),
    supabase.from('customer_credits').select('id, available_balance').eq('id', parsed.data.credit_id).eq('tenant_id', tenantId).single(),
  ])

  if (billingRes.error || !billingRes.data) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (creditRes.error || !creditRes.data) return { ok: false, error: { code: 'NOT_FOUND', message: 'Crédito não encontrado' } }

  const billing = billingRes.data
  const credit = creditRes.data

  if (billing.status === 'paid') return { ok: false, error: { code: 'CONFLICT', message: 'Cobrança já paga' } }

  const baseAmount = (billing.original_amount ?? 0) - (billing.discount_amount ?? 0)
  const alreadyApplied = billing.credit_applied ?? 0
  const maxApplicable = Math.max(0, baseAmount - alreadyApplied)

  if (parsed.data.amount > credit.available_balance) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Valor excede saldo disponível do crédito' } }
  }
  if (parsed.data.amount > maxApplicable) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Valor excede saldo da cobrança' } }
  }

  const newCreditApplied = alreadyApplied + parsed.data.amount

  const [updateBilling, updateCredit] = await Promise.all([
    supabase.from('billings').update({ credit_applied: newCreditApplied }).eq('id', parsed.data.billing_id).eq('tenant_id', tenantId),
    supabase.from('customer_credits').update({ available_balance: credit.available_balance - parsed.data.amount }).eq('id', parsed.data.credit_id).eq('tenant_id', tenantId),
  ])

  if (updateBilling.error) return { ok: false, error: { code: 'INTERNAL', message: updateBilling.error.message } }
  if (updateCredit.error) return { ok: false, error: { code: 'INTERNAL', message: updateCredit.error.message } }

  await supabase.from('credit_applications').insert({
    tenant_id: tenantId,
    credit_id: parsed.data.credit_id,
    billing_id: parsed.data.billing_id,
    amount: parsed.data.amount,
    is_auto: false,
  })

  await logAction({ action: 'create', table: 'credit_applications', recordId: parsed.data.billing_id, newData: { credit_id: parsed.data.credit_id, amount: parsed.data.amount } })
  revalidatePath('/cobrancas')
  return { ok: true, data: { new_amount_due: Math.max(0, baseAmount - newCreditApplied) } }
}

// ============================================================
// cancelBilling — cancelamento manual de cobrança (status 'cancelled')
// ============================================================

const CancelBillingSchema = z.object({
  billing_id: uuid(),
  reason:     z.string().min(3).max(300).optional(),
})

export async function cancelBilling(input: unknown): Promise<ActionResult<void>> {
  const ctx = await getAuth()
  if ('error' in ctx) return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Não autorizado' } }

  const parsed = CancelBillingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }

  const { supabase, tenantId } = ctx

  const { data: billing } = await supabase
    .from('billings').select('id, status').eq('id', parsed.data.billing_id).eq('tenant_id', tenantId).single()

  if (!billing) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (billing.status === 'paid') return { ok: false, error: { code: 'CONFLICT', message: 'Cobrança já paga' } }

  const { error } = await supabase
    .from('billings').update({ status: 'cancelled' }).eq('id', parsed.data.billing_id).eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({ action: 'update', table: 'billings', recordId: parsed.data.billing_id, newData: { status: 'cancelled' } })
  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
  return { ok: true, data: undefined }
}
