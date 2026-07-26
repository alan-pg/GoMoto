'use server'

import { createClient } from '@/lib/supabase/server'
import { effectiveBillingStatus } from '@/lib/billing-status'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  RentalSchema,
  RenewRentalSchema,
  TerminateRentalSchema,
  RegisterPaymentSchema,
  ApplyDiscountSchema,
  OneTimeChargeSchema,
  AddToQueueSchema,
  UploadClientDocumentSchema,
  CreateRentalAdjustmentSchema,
  RegenerateRentalScheduleSchema,
  generateCycleCharges,
  canRegisterPayment,
  canApplyDiscount,
  isRentalTerminationWithinMinimum,
  calculateAdjustedBillingAmount,
  computeScheduleRegenerationCutoff,
  getMoveUpNote,
  getMoveDownNote,
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
  LateChargeConfig,
} from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')
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
    p_tenant_id:          tenantId,
    p_vehicle_id:         parsed.data.vehicle_id,
    p_customer_id:        parsed.data.customer_id,
    p_cycle:              parsed.data.cycle,
    p_due_day:            parsed.data.due_day,
    p_cycle_amount:       parsed.data.cycle_amount,
    p_start_date:         parsed.data.start_date,
    p_end_date:           parsed.data.end_date,
    p_use_pro_rata:       parsed.data.use_pro_rata,
    p_charges:            charges,
    p_security_deposit:     parsed.data.security_deposit ?? null,
    p_late_charge_config:   parsed.data.late_charge_config ?? null,
    p_deposit_paid:         parsed.data.deposit_paid,
    p_deposit_payment_date: parsed.data.deposit_payment_date ?? null,
    p_deposit_due_date:     parsed.data.deposit_due_date ?? null,
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

  // Remove da fila ao iniciar locação (best-effort: não falha a locação se não houver entrada)
  await supabase
    .from('queue_entries')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('customer_id', parsed.data.customer_id)

  revalidateRentalPaths()
  revalidatePath('/locacoes/fila')
  revalidatePath('/veiculos')
  return { ok: true, data: { lease_id: leaseId as string } }
}

// ---------------------------------------------------------------------------
// updateRental — edita caução e observações de uma locação ativa. Tudo que
// afeta cobranças (valor, ciclo, dia, datas) passa por adjustRental/
// renewRental/terminateRental — não por aqui.
// ---------------------------------------------------------------------------

export async function updateRental(
  leaseId: string,
  data: Pick<CreateRental, 'observations' | 'security_deposit'>,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const updates: Record<string, unknown> = {}
  if (data.observations !== undefined) updates.observations = data.observations

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('rentals')
      .update(updates)
      .eq('id', leaseId)
      .eq('tenant_id', tenantId)

    if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  // Caução agora vive na tabela `deposits` (migration 20260719000010)
  if (data.security_deposit != null && data.security_deposit > 0) {
    const { data: rentalRow } = await supabase
      .from('rentals')
      .select('customer_id, start_date')
      .eq('id', leaseId)
      .eq('tenant_id', tenantId)
      .single()

    if (rentalRow) {
      const { data: existingDeposit } = await supabase
        .from('deposits')
        .select('id, amount, balance, status, billing_id')
        .eq('rental_id', leaseId)
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'received'])
        .maybeSingle()

      if (existingDeposit?.status === 'pending') {
        // Ainda não paga: muda o valor da cobrança pendente vinculada junto —
        // a cobrança é a fonte de verdade até ser paga (registerPayment é
        // quem libera o saldo, ver cobrancas/[id]/actions.ts).
        await supabase
          .from('deposits')
          .update({ amount: data.security_deposit })
          .eq('id', existingDeposit.id)
          .eq('tenant_id', tenantId)

        if (existingDeposit.billing_id) {
          await supabase
            .from('billings')
            .update({ original_amount: data.security_deposit })
            .eq('id', existingDeposit.billing_id)
            .eq('tenant_id', tenantId)
        }
      } else if (existingDeposit) {
        // Já paga (ou outro estado) — cobrança já quitada é imutável
        // (RNF-007); só o registro de caução é ajustado.
        const usedAmount = existingDeposit.amount - existingDeposit.balance
        const newBalance = Math.max(0, data.security_deposit - usedAmount)
        await supabase
          .from('deposits')
          .update({ amount: data.security_deposit, balance: newBalance })
          .eq('id', existingDeposit.id)
          .eq('tenant_id', tenantId)
      } else {
        await supabase.from('deposits').insert({
          tenant_id:   tenantId,
          rental_id:   leaseId,
          customer_id: rentalRow.customer_id,
          amount:      data.security_deposit,
          balance:     data.security_deposit,
          status:      'received',
          received_at: rentalRow.start_date ?? new Date().toISOString().slice(0, 10),
        })
      }
    }
  }

  await logAction({ action: 'update', table: 'rentals', recordId: leaseId })
  revalidateRentalPaths()
  revalidatePath(`/locacoes/${leaseId}`)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// removeFromQueue — remover entrada da fila de espera
// ---------------------------------------------------------------------------

export async function removeFromQueue(
  queueEntryId: string,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const { error } = await supabase
    .from('queue_entries')
    .delete()
    .eq('id', queueEntryId)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'delete', table: 'queue_entries', recordId: queueEntryId })
  revalidatePath('/locacoes/fila')
  revalidatePath('/locacoes')
  return { ok: true, data: undefined }
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
  revalidatePath('/veiculos')
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
    .select('status, customer_id')
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
      customer_id:     rental.customer_id,
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

  // Impedir duplicata: cliente já aguardando
  const { data: existing } = await supabase
    .from('queue_entries')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', parsed.data.customer_id)
    .eq('status', 'waiting')
    .maybeSingle()

  if (existing) {
    return { ok: false, error: { code: 'DUPLICATE_ENTRY', message: 'Este cliente já está na fila de espera.' } }
  }

  // Insere com posição atômica via RPC (evita race condition)
  const { data: entry, error } = await supabase
    .rpc('add_to_queue', {
      p_tenant_id:   tenantId,
      p_customer_id: parsed.data.customer_id,
    })
    .single()

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'create', table: 'queue_entries', recordId: (entry as { id: string }).id })
  revalidatePath('/locacoes/fila')
  revalidatePath('/locacoes')
  return { ok: true, data: { queue_entry_id: (entry as { id: string }).id } }
}

// ---------------------------------------------------------------------------
// moveInQueue — reordenação de posição na fila de espera
// ---------------------------------------------------------------------------

export async function moveInQueue(
  queueEntryId: string,
  direction: 'up' | 'down',
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  if (direction !== 'up' && direction !== 'down') {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Direção inválida' } }
  }

  const noteUp   = getMoveUpNote('Reordenação da fila')
  const noteDown = getMoveDownNote('Reordenação da fila')

  const { error } = await supabase.rpc('swap_queue_positions', {
    p_tenant_id:  tenantId,
    p_entry_id:   queueEntryId,
    p_direction:  direction,
    p_note_up:    noteUp,
    p_note_down:  noteDown,
  })

  if (error) {
    if (error.message?.includes('QUEUE_ENTRY_NOT_FOUND')) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Entrada da fila não encontrada.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  await logAction({ action: 'update', table: 'queue_entries', recordId: queueEntryId })
  revalidatePath('/locacoes/fila')
  return { ok: true, data: undefined }
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

// ---------------------------------------------------------------------------
// createRentalWithDeposit — criação de locação com caução e config de encargos
// ---------------------------------------------------------------------------

// late_charge_config já vem de RentalSchema — não precisa redeclarar aqui
// (e o Zod v4 não permite sobrescrever chave em schema com .refine()).
const RentalWithDepositSchema = RentalSchema.extend({
  deposit_received_at: dateString.optional(),
})

export async function createRentalWithDeposit(
  data: unknown,
): Promise<ActionResult<{ lease_id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = RentalWithDepositSchema.safeParse(data)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  // Verifica bloqueio de inadimplência
  const { data: customer } = await supabase
    .from('customers').select('delinquency_status').eq('id', parsed.data.customer_id).eq('tenant_id', tenantId).single()
  if (customer?.delinquency_status === 'blocked') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Cliente bloqueado por inadimplência.', field: 'customer_id' } }
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
    p_tenant_id:          tenantId,
    p_vehicle_id:         parsed.data.vehicle_id,
    p_customer_id:        parsed.data.customer_id,
    p_cycle:              parsed.data.cycle,
    p_due_day:            parsed.data.due_day,
    p_cycle_amount:       parsed.data.cycle_amount,
    p_start_date:         parsed.data.start_date,
    p_end_date:           parsed.data.end_date,
    p_use_pro_rata:       parsed.data.use_pro_rata,
    p_charges:            charges,
    p_security_deposit:   parsed.data.security_deposit ?? null,
    p_deposit_received_at: parsed.data.deposit_received_at ?? null,
    p_late_charge_config: (parsed.data.late_charge_config ?? null) as LateChargeConfig | null,
  })

  if (error) {
    if (error.message?.includes('VEHICLE_ALREADY_RENTED')) return { ok: false, error: { code: 'VEHICLE_ALREADY_RENTED', message: 'Veículo já possui locação ativa.' } }
    if (error.message?.includes('could not obtain lock')) return { ok: false, error: { code: 'VEHICLE_LOCKED', message: 'Tente novamente em instantes.' } }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  await logAction({ action: 'create', table: 'rentals', recordId: leaseId, newData: { charges_count: charges.length, has_deposit: !!parsed.data.security_deposit } })
  await supabase.from('queue_entries').delete().eq('tenant_id', tenantId).eq('customer_id', parsed.data.customer_id)
  revalidateRentalPaths()
  revalidatePath('/locacoes/fila')
  revalidatePath('/veiculos')
  return { ok: true, data: { lease_id: leaseId as string } }
}

// ---------------------------------------------------------------------------
// closeRentalFinancial — encerramento financeiro (caução) de uma locação
// ---------------------------------------------------------------------------

const CloseRentalFinancialSchema = z.discriminatedUnion('deposit_action', [
  z.object({ rental_id: uuid(), deposit_action: z.literal('full_return'), return_date: dateString }),
  z.object({ rental_id: uuid(), deposit_action: z.literal('partial_return'), returned_amount: z.number().positive(), retained_amount: z.number().positive(), retention_reason: z.string().min(5), return_date: dateString }),
  z.object({ rental_id: uuid(), deposit_action: z.literal('full_retention'), retention_reason: z.string().min(5) }),
  z.object({ rental_id: uuid(), deposit_action: z.literal('none') }),
])

export async function closeRentalFinancial(
  input: unknown,
): Promise<ActionResult<{ complementary_billing_needed: boolean; shortfall_amount?: number }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = CloseRentalFinancialSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  if (parsed.data.deposit_action === 'none') {
    return { ok: true, data: { complementary_billing_needed: false } }
  }

  // Encontra a caução ativa da locação
  const { data: deposit } = await supabase
    .from('deposits')
    .select('id, amount, balance, status')
    .eq('rental_id', parsed.data.rental_id)
    .eq('tenant_id', tenantId)
    .in('status', ['received', 'partially_returned'])
    .limit(1)
    .maybeSingle()

  if (!deposit) return { ok: false, error: { code: 'NOT_FOUND', message: 'Caução não encontrada para esta locação' } }

  const now = new Date().toISOString()

  if (parsed.data.deposit_action === 'full_return') {
    await supabase.from('deposits').update({ status: 'fully_returned', balance: 0, closed_at: now }).eq('id', deposit.id).eq('tenant_id', tenantId)
    await supabase.from('deposit_movements').insert({ tenant_id: tenantId, deposit_id: deposit.id, type: 'return', amount: deposit.balance, reason: null, movement_date: parsed.data.return_date })
    await logAction({ action: 'update', table: 'deposits', recordId: deposit.id, newData: { status: 'fully_returned' } })
    return { ok: true, data: { complementary_billing_needed: false } }
  }

  if (parsed.data.deposit_action === 'full_retention') {
    await supabase.from('deposits').update({ status: 'fully_retained', balance: 0, closed_at: now }).eq('id', deposit.id).eq('tenant_id', tenantId)
    await supabase.from('deposit_movements').insert({ tenant_id: tenantId, deposit_id: deposit.id, type: 'retention', amount: deposit.balance, reason: parsed.data.retention_reason, movement_date: now.split('T')[0] })
    await logAction({ action: 'update', table: 'deposits', recordId: deposit.id, newData: { status: 'fully_retained' } })
    return { ok: true, data: { complementary_billing_needed: false } }
  }

  // partial_return
  const { returned_amount, retained_amount, retention_reason, return_date } = parsed.data
  const totalHandled = returned_amount + retained_amount
  const shortfall = Math.max(0, totalHandled - deposit.balance)
  const newBalance = Math.max(0, deposit.balance - retained_amount)

  await supabase.from('deposits').update({ status: 'partially_returned', balance: newBalance, closed_at: now }).eq('id', deposit.id).eq('tenant_id', tenantId)

  await supabase.from('deposit_movements').insert([
    { tenant_id: tenantId, deposit_id: deposit.id, type: 'return', amount: returned_amount, reason: null, movement_date: return_date },
    { tenant_id: tenantId, deposit_id: deposit.id, type: 'retention', amount: retained_amount, reason: retention_reason, movement_date: return_date },
  ])

  await logAction({ action: 'update', table: 'deposits', recordId: deposit.id, newData: { status: 'partially_returned', returned_amount, retained_amount } })
  revalidateRentalPaths()
  return { ok: true, data: { complementary_billing_needed: shortfall > 0, shortfall_amount: shortfall > 0 ? shortfall : undefined } }
}

// ---------------------------------------------------------------------------
// adjustRental — reajusta valor do ciclo e encargos, com histórico (RF-027–031)
// ---------------------------------------------------------------------------

export async function adjustRental(
  input: unknown,
): Promise<ActionResult<{ updated_billings_count: number }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = CreateRentalAdjustmentSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { data: rental } = await supabase
    .from('rentals').select('id, status, cycle_amount').eq('id', parsed.data.rental_id).eq('tenant_id', tenantId).single()

  if (!rental) return { ok: false, error: { code: 'NOT_FOUND', message: 'Locação não encontrada' } }
  if (rental.status !== 'active') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Somente locações ativas podem ser reajustadas.' } }
  }

  // RN-025/RN-026: só cobranças de ciclo pendentes entram no reajuste — pagas,
  // vencidas e canceladas são preservadas. O banco nunca grava status='overdue'
  // literalmente (é derivado em runtime, ver @/lib/billing-status) — status='pending'
  // sozinho não basta pra saber se já venceu, por isso filtramos due_date também.
  const { data: candidateBillings, error: fetchErr } = await supabase
    .from('billings')
    .select('id, original_amount, due_date, status')
    .eq('lease_id', parsed.data.rental_id)
    .eq('tenant_id', tenantId)
    .eq('billing_type', 'cycle')
    .eq('status', 'pending')

  if (fetchErr) return { ok: false, error: { code: 'INTERNAL_ERROR', message: fetchErr.message } }

  const pendingBillings = (candidateBillings ?? []).filter(b => effectiveBillingStatus(b) === 'pending')

  // RN-027: recalcula proporcionalmente (preserva cobranças pro rata como fração do novo valor)
  const billingUpdates = pendingBillings.map(b => ({
    billing_id: b.id,
    new_amount: calculateAdjustedBillingAmount(b.original_amount, rental.cycle_amount ?? 0, parsed.data.new_cycle_amount),
  }))

  const { data: updatedCount, error: rpcErr } = await supabase.rpc('adjust_rental', {
    p_tenant_id:              tenantId,
    p_lease_id:               parsed.data.rental_id,
    p_new_cycle_amount:       parsed.data.new_cycle_amount,
    p_new_late_charge_config: parsed.data.new_late_charge_config ?? null,
    p_justification:          parsed.data.justification,
    p_adjusted_by:            user.id,
    p_billing_updates:        billingUpdates,
  })

  if (rpcErr) {
    if (rpcErr.message?.includes('RENTAL_NOT_ACTIVE')) {
      return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: rpcErr.message } }
  }

  const count = (updatedCount as number | null) ?? 0

  await logAction({ action: 'update', table: 'rentals', recordId: parsed.data.rental_id, newData: { new_cycle_amount: parsed.data.new_cycle_amount, updated_billings_count: count } })
  revalidateRentalPaths()
  revalidatePath(`/locacoes/${parsed.data.rental_id}`)
  revalidatePath(`/locacoes/${parsed.data.rental_id}/financeiro`)
  return { ok: true, data: { updated_billings_count: count } }
}

// ---------------------------------------------------------------------------
// regenerateRentalSchedule — muda ciclo/dia de vencimento/pro rata: cancela
// as cobranças pendentes futuras (que não batem mais com o novo padrão),
// estorna crédito aplicado nelas, e regera a partir do ponto de corte.
// ---------------------------------------------------------------------------

export async function regenerateRentalSchedule(
  input: unknown,
): Promise<ActionResult<{ cancelled_count: number; created_count: number }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = RegenerateRentalScheduleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos', field: first?.path?.map(String).join('.') } }
  }

  const { data: rental } = await supabase
    .from('rentals')
    .select('id, status, start_date, end_date')
    .eq('id', parsed.data.rental_id)
    .eq('tenant_id', tenantId)
    .single()

  if (!rental) return { ok: false, error: { code: 'NOT_FOUND', message: 'Locação não encontrada' } }
  if (rental.status !== 'active') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Somente locações ativas podem ser reajustadas.' } }
  }
  if (!rental.start_date || !rental.end_date) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Locação sem data de início/fim definida.' } }
  }

  const { data: billings, error: fetchErr } = await supabase
    .from('billings')
    .select('id, due_date, status, discount_amount, credit_applied')
    .eq('lease_id', parsed.data.rental_id)
    .eq('tenant_id', tenantId)
    .eq('billing_type', 'cycle')

  if (fetchErr) return { ok: false, error: { code: 'INTERNAL_ERROR', message: fetchErr.message } }

  const allBillings = billings ?? []
  const today = new Date()
  const cutoff = computeScheduleRegenerationCutoff(allBillings, today)

  // Mesmo critério de "pendente de verdade" usado em adjustRental — pending
  // com due_date já passado é vencida na prática (overdue nunca é gravado).
  const toCancel = allBillings.filter(b => effectiveBillingStatus(b) === 'pending')
  const cancelIds = toCancel.map(b => b.id)

  let creditReversals: { credit_id: string; amount: number }[] = []
  if (cancelIds.length > 0) {
    const { data: applications, error: creditErr } = await supabase
      .from('credit_applications')
      .select('credit_id, amount')
      .in('billing_id', cancelIds)
      .eq('tenant_id', tenantId)
      .is('reversed_at', null)

    if (creditErr) return { ok: false, error: { code: 'INTERNAL_ERROR', message: creditErr.message } }

    const byCredit = new Map<string, number>()
    for (const a of applications ?? []) {
      byCredit.set(a.credit_id, (byCredit.get(a.credit_id) ?? 0) + a.amount)
    }
    creditReversals = Array.from(byCredit, ([credit_id, amount]) => ({ credit_id, amount }))
  }

  const regenerateFrom = cutoff ?? rental.start_date
  const newCharges = generateCycleCharges({
    start_date:   regenerateFrom,
    end_date:     rental.end_date,
    cycle:        parsed.data.new_cycle,
    due_day:      parsed.data.new_due_day,
    cycle_amount: parsed.data.new_cycle_amount,
    use_pro_rata: parsed.data.new_use_pro_rata,
  }).filter(c => c.due_date > regenerateFrom)

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('regenerate_rental_schedule', {
    p_tenant_id:              tenantId,
    p_lease_id:               parsed.data.rental_id,
    p_new_cycle:              parsed.data.new_cycle,
    p_new_due_day:            parsed.data.new_due_day,
    p_new_cycle_amount:       parsed.data.new_cycle_amount,
    p_new_use_pro_rata:       parsed.data.new_use_pro_rata,
    p_new_late_charge_config: parsed.data.new_late_charge_config ?? null,
    p_justification:          parsed.data.justification,
    p_adjusted_by:            user.id,
    p_cancel_billing_ids:     cancelIds,
    p_credit_reversals:       creditReversals,
    p_new_charges:            newCharges,
  })

  if (rpcErr) {
    if (rpcErr.message?.includes('RENTAL_NOT_ACTIVE')) {
      return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: rpcErr.message } }
  }

  const result = (rpcResult as { cancelled_count: number; created_count: number }[] | null)?.[0]
    ?? { cancelled_count: 0, created_count: 0 }

  await logAction({
    action: 'update', table: 'rentals', recordId: parsed.data.rental_id,
    newData: { new_cycle: parsed.data.new_cycle, new_due_day: parsed.data.new_due_day, ...result },
  })
  revalidateRentalPaths()
  revalidatePath(`/locacoes/${parsed.data.rental_id}`)
  revalidatePath(`/locacoes/${parsed.data.rental_id}/financeiro`)
  return { ok: true, data: result }
}
