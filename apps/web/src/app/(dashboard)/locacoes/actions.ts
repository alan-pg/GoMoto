'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  RentalSchema,
  RenewRentalSchema,
  TerminateRentalSchema,
  RegisterPaymentSchema,
  ApplyDiscountSchema,
  OneTimeChargeSchema,
  AddToQueueSchema,
  UploadClientDocumentSchema,
  generateCycleCharges,
  canRegisterPayment,
  canApplyDiscount,
  isRentalTerminationWithinMinimum,
} from '@gomoto/core'
import type {
  ActionResult,
  CreateRental,
  RenewRental,
  TerminateRental,
  RegisterPayment,
  ApplyDiscount,
  CreateOneTimeCharge,
  AddToQueue,
  UploadClientDocument,
} from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

function revalidateRentalPaths() {
  revalidatePath('/locacoes')
  revalidatePath('/cobrancas')
}

// ---------------------------------------------------------------------------
// createRental — criação de locação com cobranças via RPC atômico
// ---------------------------------------------------------------------------

export async function createRental(
  data: CreateRental,
): Promise<ActionResult<{ lease_id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = RentalSchema.safeParse(data)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: firstError?.message ?? 'Dados inválidos',
        field: firstError?.path?.map(String).join('.'),
      },
    }
  }

  const charges = generateCycleCharges({
    start_date:   parsed.data.start_date,
    end_date:     parsed.data.end_date,
    cycle:        parsed.data.cycle,
    due_day:      parsed.data.due_day,
    cycle_amount: parsed.data.cycle_amount,
    use_pro_rata: parsed.data.use_pro_rata,
  })

  const { data: leaseId, error } = await supabase.rpc('create_rental_with_charges', {
    p_tenant_id:     tenantId,
    p_motorcycle_id: parsed.data.motorcycle_id,
    p_customer_id:   parsed.data.customer_id,
    p_cycle:         parsed.data.cycle,
    p_due_day:       parsed.data.due_day,
    p_cycle_amount:  parsed.data.cycle_amount,
    p_start_date:    parsed.data.start_date,
    p_end_date:      parsed.data.end_date,
    p_use_pro_rata:  parsed.data.use_pro_rata,
    p_charges:       charges,
  })

  if (error) {
    if (error.message?.includes('VEHICLE_ALREADY_RENTED')) {
      return { ok: false, error: { code: 'VEHICLE_ALREADY_RENTED', message: 'Veículo já possui locação ativa.' } }
    }
    if (error.message?.includes('could not obtain lock')) {
      return { ok: false, error: { code: 'VEHICLE_LOCKED', message: 'Tente novamente em instantes.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  await logAction({ action: 'create', table: 'rentals', recordId: leaseId, newData: { charges_count: charges.length } })
  revalidateRentalPaths()
  revalidatePath('/motos')
  return { ok: true, data: { lease_id: leaseId as string } }
}

// ---------------------------------------------------------------------------
// terminateRental — encerramento antecipado via RPC
// ---------------------------------------------------------------------------

export async function terminateRental(
  data: TerminateRental,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = TerminateRentalSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  // Determinar status de saída (rent_to_own cumprido → transferred)
  const { data: rental } = await supabase
    .from('rentals')
    .select('contract_type, start_date')
    .eq('id', parsed.data.lease_id)
    .single()

  let newStatus = parsed.data.new_status ?? 'closed'
  if (
    rental?.contract_type === 'rent_to_own' &&
    !isRentalTerminationWithinMinimum(
      { start_date: rental.start_date, rental_type: 'rent_to_own' },
      new Date(parsed.data.termination_date),
    )
  ) {
    newStatus = 'transferred'
  }

  const { error } = await supabase.rpc('terminate_rental', {
    p_tenant_id:        tenantId,
    p_lease_id:         parsed.data.lease_id,
    p_termination_date: parsed.data.termination_date,
    p_new_status:       newStatus,
  })

  if (error) {
    if (error.message?.includes('RENTAL_NOT_ACTIVE')) {
      return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  await logAction({ action: 'update', table: 'rentals', recordId: parsed.data.lease_id })
  revalidateRentalPaths()
  revalidatePath('/motos')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// renewRental — renovação com recálculo de última cobrança
// ---------------------------------------------------------------------------

export async function renewRental(
  data: RenewRental,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = RenewRentalSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  // Buscar dados da locação para recalcular cobranças
  const { data: rental, error: rentalError } = await supabase
    .from('rentals')
    .select('cycle, due_day, cycle_amount, use_pro_rata, end_date')
    .eq('id', parsed.data.lease_id)
    .single()

  if (rentalError || !rental) {
    return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não encontrada.' } }
  }

  // Buscar última cobrança da locação
  const { data: lastBilling } = await supabase
    .from('billings')
    .select('id, original_amount, status, due_date')
    .eq('lease_id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)
    .order('due_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Determinar ação complementar e ponto de renovação
  let complementaryAction: Record<string, unknown> | null = null
  let renewalStart = rental.end_date

  if (lastBilling && rental.cycle_amount) {
    if (lastBilling.status !== 'paid' && lastBilling.original_amount !== rental.cycle_amount) {
      // Última não paga com valor pro rata → recalcular para ciclo completo
      complementaryAction = {
        action:     'update',
        billing_id: lastBilling.id,
        amount:     rental.cycle_amount,
      }
    } else if (lastBilling.status === 'paid' && lastBilling.original_amount !== rental.cycle_amount) {
      // Última paga pro rata → gerar complementar
      const complementaryAmount = rental.cycle_amount - lastBilling.original_amount
      complementaryAction = {
        action:   'insert',
        amount:   complementaryAmount,
        due_date: lastBilling.due_date,
      }
    }
    renewalStart = lastBilling.due_date
  }

  // Gerar novas cobranças do ponto de renovação até nova data de fim
  const newCharges = rental.cycle && rental.due_day && rental.cycle_amount
    ? generateCycleCharges({
        start_date:   renewalStart ?? rental.end_date,
        end_date:     parsed.data.new_end_date,
        cycle:        rental.cycle as 'weekly' | 'monthly',
        due_day:      rental.due_day,
        cycle_amount: rental.cycle_amount,
        use_pro_rata: rental.use_pro_rata ?? true,
      }).filter(c => c.due_date > (lastBilling?.due_date ?? rental.end_date))
    : []

  const { error } = await supabase.rpc('renew_rental', {
    p_tenant_id:            tenantId,
    p_lease_id:             parsed.data.lease_id,
    p_new_end_date:         parsed.data.new_end_date,
    p_complementary_action: complementaryAction,
    p_new_charges:          newCharges,
  })

  if (error) {
    if (error.message?.includes('RENTAL_NOT_ACTIVE')) {
      return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  await logAction({ action: 'update', table: 'rentals', recordId: parsed.data.lease_id })
  revalidateRentalPaths()
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// registerPayment — baixa manual de cobrança
// ---------------------------------------------------------------------------

export async function registerPayment(
  data: RegisterPayment,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = RegisterPaymentSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  const { data: billing } = await supabase
    .from('billings')
    .select('status')
    .eq('id', parsed.data.billing_id)
    .single()

  if (!billing) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Cobrança não encontrada' } }

  const check = canRegisterPayment(billing.status)
  if (!check.ok) {
    const msg = check.errorCode === 'BILLING_ALREADY_PAID'
      ? 'Esta cobrança já foi paga.'
      : 'Esta cobrança está cancelada.'
    return { ok: false, error: { code: check.errorCode as 'BILLING_ALREADY_PAID' | 'BILLING_CANCELLED', message: msg } }
  }

  const { error } = await supabase
    .from('billings')
    .update({
      status:         'paid',
      paid_at:        parsed.data.paid_at,
      payment_method: parsed.data.payment_method,
      paid_by:        user.id,
    })
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'update', table: 'billings', recordId: parsed.data.billing_id })
  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// applyDiscount — desconto em cobrança
// ---------------------------------------------------------------------------

export async function applyDiscount(
  data: ApplyDiscount,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = ApplyDiscountSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  const { data: billing } = await supabase
    .from('billings')
    .select('status, original_amount')
    .eq('id', parsed.data.billing_id)
    .single()

  if (!billing) return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Cobrança não encontrada' } }

  const check = canApplyDiscount(billing.status, parsed.data.discount_amount, billing.original_amount ?? 0)
  if (!check.ok) {
    const msgMap: Record<string, string> = {
      BILLING_CANCELLED:       'Esta cobrança está cancelada.',
      DISCOUNT_EXCEEDS_AMOUNT: 'Desconto não pode ser maior que o valor da cobrança.',
      BILLING_ALREADY_PAID:    'Esta cobrança já foi paga.',
    }
    return { ok: false, error: { code: check.errorCode as 'BILLING_CANCELLED' | 'DISCOUNT_EXCEEDS_AMOUNT', message: msgMap[check.errorCode] ?? 'Operação inválida' } }
  }

  const { error } = await supabase
    .from('billings')
    .update({
      discount_amount: parsed.data.discount_amount,
      discount_reason: parsed.data.discount_reason,
      discounted_by:   user.id,
    })
    .eq('id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'update', table: 'billings', recordId: parsed.data.billing_id })
  revalidatePath('/cobrancas')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// createOneTimeCharge — cobrança avulsa
// ---------------------------------------------------------------------------

export async function createOneTimeCharge(
  data: CreateOneTimeCharge,
): Promise<ActionResult<{ billing_id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = OneTimeChargeSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  // Verificar que a locação está ativa (RN-029)
  const { data: rental } = await supabase
    .from('rentals')
    .select('status')
    .eq('id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)
    .single()

  if (!rental || rental.status !== 'active') {
    return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
  }

  const { data: billing, error } = await supabase
    .from('billings')
    .insert({
      tenant_id:       tenantId,
      lease_id:        parsed.data.lease_id,
      description:     parsed.data.description,
      original_amount: parsed.data.amount,
      due_date:        parsed.data.due_date,
      billing_type:    'one_time',
      status:          'pending',
    })
    .select()
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'create', table: 'billings', recordId: billing.id, newData: billing })
  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
  return { ok: true, data: { billing_id: billing.id } }
}

// ---------------------------------------------------------------------------
// addToQueue — adicionar cliente à fila de espera
// ---------------------------------------------------------------------------

export async function addToQueue(
  data: AddToQueue,
): Promise<ActionResult<{ queue_entry_id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = AddToQueueSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  // Verificar se fila está habilitada (RN-031)
  const { data: tenant } = await supabase
    .from('tenants')
    .select('queue_enabled')
    .eq('id', tenantId)
    .single()

  if (!tenant?.queue_enabled) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Fila de espera está desabilitada neste tenant.' } }
  }

  const { data: lastEntry } = await supabase
    .from('queue_entries')
    .select('position')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = (lastEntry?.position ?? 0) + 1

  const { data: entry, error } = await supabase
    .from('queue_entries')
    .insert({
      tenant_id:   tenantId,
      customer_id: parsed.data.customer_id,
      position:    nextPosition,
      status:      'waiting',
    })
    .select()
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'create', table: 'queue_entries', recordId: entry.id })
  revalidatePath('/locacoes')
  return { ok: true, data: { queue_entry_id: entry.id } }
}

// ---------------------------------------------------------------------------
// uploadClientDocument — upload de documento de cliente
// ---------------------------------------------------------------------------

export async function uploadClientDocument(
  data: UploadClientDocument,
): Promise<ActionResult<{ document_id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = UploadClientDocumentSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  const { data: doc, error } = await supabase
    .from('clients_documents')
    .insert({
      tenant_id:     tenantId,
      customer_id:   parsed.data.customer_id,
      document_type: parsed.data.document_type,
      storage_path:  parsed.data.storage_path,
      file_name:     parsed.data.file_name,
      uploaded_by:   user.id,
    })
    .select()
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'create', table: 'clients_documents', recordId: doc.id })
  revalidatePath('/clientes')
  return { ok: true, data: { document_id: doc.id } }
}
