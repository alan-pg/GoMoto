'use server'

import { createClient } from '@/lib/supabase/server'
import { effectiveBillingStatus } from '@/lib/billing-status'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  AdjustScheduleSchema,
  RentalSchema,
  RenewRentalSchema,
  TerminateRentalSchema,
  RegisterPaymentSchema,
  ApplyDiscountSchema,
  OneTimeChargeSchema,
  AddToQueueSchema,
  UploadClientDocumentSchema,
  AttachSignedContractSchema,
  CreateRentalAdjustmentSchema,
  RegenerateRentalScheduleSchema,
  generateSchedule,
  ACCOUNTS,
  classifyCustomerDelinquency,
  canStartNewRental,
  DEFAULT_DELINQUENCY_POLICY,
  type DelinquencyFacts,
  type DelinquencyPolicy,
  canRegisterPayment,
  canApplyDiscount,
  canEditDownPayment,
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
  AttachSignedContract,
  LateChargeConfig,
} from '@gomoto/core'

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = () => z.string().regex(UUID_LOOSE, 'ID inválido')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (YYYY-MM-DD)')
import { logAction } from '@/lib/audit'
import { createCharge, cancelCharge, receivePayment, postTransaction, dimensionsOf } from '@/lib/financial'
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

  // Spec 0014: grava o PLANO, não documentos. Um rent-to-own de 2 anos cria 104
  // linhas de cronograma em vez de 104 cobranças emitidas — "Total a receber"
  // volta a significar emitido e não pago (F-10). A emissão vira trabalho do
  // job diário, conforme o período chega.
  const schedule = generateSchedule({
    start_date:   parsed.data.start_date,
    end_date:     parsed.data.end_date,
    cycle:        parsed.data.cycle,
    due_day:      parsed.data.due_day,
    cycle_amount: parsed.data.cycle_amount,
    use_pro_rata: parsed.data.use_pro_rata,
  })

  const { data: leaseId, error } = await supabase.rpc('create_rental_with_schedule', {
    p_tenant_id: tenantId,
    p_rental: {
      customer_id:   parsed.data.customer_id,
      vehicle_id:    parsed.data.vehicle_id,
      start_date:    parsed.data.start_date,
      end_date:      parsed.data.end_date,
      cycle:         parsed.data.cycle,
      cycle_amount:  parsed.data.cycle_amount,
      due_day:       parsed.data.due_day,
      use_pro_rata:  parsed.data.use_pro_rata,
      contract_type: parsed.data.contract_type ?? 'rental',
      observations:  parsed.data.observations ?? null,
      contract_template_id: parsed.data.contract_template_id ?? null,
      checkin_checkout_inspection_profile_id: parsed.data.checkin_checkout_inspection_profile_id ?? null,
      periodic_inspection_profile_id:         parsed.data.periodic_inspection_profile_id ?? null,
      periodic_inspection_frequency_days:     parsed.data.periodic_inspection_frequency_days ?? null,
    },
    p_schedule: schedule,
  })

  if (error) {
    if (error.message?.includes('VEHICLE_NOT_FOUND')) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Veículo não encontrado.' } }
    }
    if (error.message?.includes('could not obtain lock')) {
      return { ok: false, error: { code: 'VEHICLE_LOCKED', message: 'Tente novamente em instantes.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  const rentalId = leaseId as string

  // Caução: cobrança que credita PASSIVO, não receita. É o mesmo mecanismo de
  // cobrança, só que a conta creditada é `caucoes_a_devolver` — por isso a
  // caução nunca aparece em faturamento, sem depender de filtro em query.
  if (parsed.data.security_deposit && parsed.data.security_deposit > 0) {
    try {
      const depositCharge = await createCharge(supabase, tenantId, {
        customerId: parsed.data.customer_id,
        rentalId,
        dueDate: parsed.data.deposit_due_date ?? parsed.data.start_date,
        sourceModule: 'deposit',
        sourceId: rentalId,
        createdBy: user.id,
        items: [{
          description: 'Caução',
          credit_account_code: ACCOUNTS.DEPOSITS_PAYABLE,
          quantity: 1,
          unit_amount: parsed.data.security_deposit,
          amount: parsed.data.security_deposit,
          source_module: 'deposit',
          source_id: rentalId,
          // Sem a dimensão veículo, o lançamento não entra em
          // vehicle_financial_position e a moto aparece sem receita.
          vehicle_id: parsed.data.vehicle_id,
        }],
      })

      await supabase.from('deposits').insert({
        tenant_id:   tenantId,
        rental_id:   rentalId,
        customer_id: parsed.data.customer_id,
        amount:      parsed.data.security_deposit,
        charge_id:   depositCharge.chargeId,
        received_at: parsed.data.deposit_paid ? (parsed.data.deposit_payment_date ?? null) : null,
        registered_by: user.id,
      })

      // Marcada como já recebida no cadastro: registra o pagamento de fato.
      // Sem isto a cobrança nasceria "em aberto" apesar de o operador ter dito
      // que a caução foi paga — e o dinheiro não entraria no caixa.
      if (parsed.data.deposit_paid) {
        await receivePayment(supabase, tenantId, {
          customerId: parsed.data.customer_id,
          amount: parsed.data.security_deposit,
          method: 'cash',
          paidAt: parsed.data.deposit_payment_date
            ? new Date(parsed.data.deposit_payment_date)
            : new Date(),
          allocations: [{ chargeId: depositCharge.chargeId, amount: parsed.data.security_deposit }],
          receivedBy: user.id,
          notes: 'Caução recebida no cadastro da locação',
        })
      }
    } catch (err) {
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: `Locação criada, mas a caução falhou: ${String(err)}` },
      }
    }
  }

  // Entrada: receita não reembolsável (Spec 0010), logo credita receita.
  if (parsed.data.down_payment && parsed.data.down_payment > 0) {
    try {
      const downPaymentCharge = await createCharge(supabase, tenantId, {
        customerId: parsed.data.customer_id,
        rentalId,
        dueDate: parsed.data.down_payment_due_date ?? parsed.data.start_date,
        sourceModule: 'down_payment',
        sourceId: rentalId,
        createdBy: user.id,
        items: [{
          description: 'Entrada',
          credit_account_code: ACCOUNTS.RENTAL_REVENUE,
          quantity: 1,
          unit_amount: parsed.data.down_payment,
          amount: parsed.data.down_payment,
          source_module: 'down_payment',
          source_id: rentalId,
          vehicle_id: parsed.data.vehicle_id,
        }],
      })

      if (parsed.data.down_payment_paid) {
        await receivePayment(supabase, tenantId, {
          customerId: parsed.data.customer_id,
          amount: parsed.data.down_payment,
          method: 'cash',
          paidAt: parsed.data.down_payment_payment_date
            ? new Date(parsed.data.down_payment_payment_date)
            : new Date(),
          allocations: [{ chargeId: downPaymentCharge.chargeId, amount: parsed.data.down_payment }],
          receivedBy: user.id,
          notes: 'Entrada recebida no cadastro da locação',
        })
      }
    } catch (err) {
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: `Locação criada, mas a entrada falhou: ${String(err)}` },
      }
    }
  }

  await logAction({
    action: 'create',
    table: 'rentals',
    recordId: rentalId,
    newData: { schedule_lines: schedule.length },
  })

  // Remove da fila ao iniciar locação (best-effort).
  await supabase
    .from('queue_entries')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('customer_id', parsed.data.customer_id)

  revalidateRentalPaths()
  revalidatePath('/locacoes/fila')
  revalidatePath('/veiculos')
  return { ok: true, data: { lease_id: rentalId } }
}

// ---------------------------------------------------------------------------
// updateRental — edita caução e observações de uma locação ativa. Tudo que
// afeta cobranças (valor, ciclo, dia, datas) passa por adjustRental/
// renewRental/terminateRental — não por aqui.
// ---------------------------------------------------------------------------

export async function updateRental(
  leaseId: string,
  data: Pick<CreateRental, 'observations' | 'security_deposit' | 'down_payment' | 'down_payment_due_date'>,
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
        .select('id, amount, charge_id')
        .eq('rental_id', leaseId)
        .eq('tenant_id', tenantId)
        .is('closed_at', null)
        .maybeSingle()

      const dep = existingDeposit as { id: string; amount: number; charge_id: string | null } | null

      if (dep?.charge_id) {
        const { data: bal } = await supabase
          .from('charge_balances')
          .select('paid_amount')
          .eq('charge_id', dep.charge_id)
          .maybeSingle()

        const paid = (bal as { paid_amount: number } | null)?.paid_amount ?? 0

        // Documento emitido é imutável (Princípio 5): alterar o valor da caução
        // cancela a cobrança e emite outra. Com pagamento já alocado, recusa —
        // ajustar exige estornar o recebimento antes.
        if (paid > 0) {
          return {
            ok: false,
            error: { code: 'CONFLICT', message: 'Caução já recebida não pode ser alterada. Estorne o recebimento primeiro.' },
          }
        }

        try {
          await cancelCharge(supabase, tenantId, dep.charge_id, 'Valor da caução revisado', user.id)

          const nova = await createCharge(supabase, tenantId, {
            customerId: rentalRow.customer_id,
            rentalId: leaseId,
            dueDate: rentalRow.start_date ?? new Date().toISOString().slice(0, 10),
            sourceModule: 'deposit',
            sourceId: leaseId,
            createdBy: user.id,
            items: [{
              description: 'Caução',
              credit_account_code: ACCOUNTS.DEPOSITS_PAYABLE,
              quantity: 1,
              unit_amount: data.security_deposit,
              amount: data.security_deposit,
              source_module: 'deposit',
              source_id: leaseId,
            }],
          })

          await supabase
            .from('deposits')
            .update({ amount: data.security_deposit, charge_id: nova.chargeId })
            .eq('id', dep.id)
            .eq('tenant_id', tenantId)
        } catch (err) {
          return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
        }
      } else if (!dep) {
        try {
          const nova = await createCharge(supabase, tenantId, {
            customerId: rentalRow.customer_id,
            rentalId: leaseId,
            dueDate: rentalRow.start_date ?? new Date().toISOString().slice(0, 10),
            sourceModule: 'deposit',
            sourceId: leaseId,
            createdBy: user.id,
            items: [{
              description: 'Caução',
              credit_account_code: ACCOUNTS.DEPOSITS_PAYABLE,
              quantity: 1,
              unit_amount: data.security_deposit,
              amount: data.security_deposit,
              source_module: 'deposit',
              source_id: leaseId,
            }],
          })

          await supabase.from('deposits').insert({
            tenant_id:   tenantId,
            rental_id:   leaseId,
            customer_id: rentalRow.customer_id,
            amount:      data.security_deposit,
            charge_id:   nova.chargeId,
            received_at: rentalRow.start_date ?? new Date().toISOString().slice(0, 10),
            registered_by: user.id,
          })
        } catch (err) {
          return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
        }
      }
    }
  }

  // Entrada: mesma regra. Documento emitido não se reescreve — a origem
  // (source_module='down_payment') localiza a cobrança sem precisar de coluna
  // dedicada como `billing_type` (F-11).
  if (data.down_payment != null) {
    const { data: item } = await supabase
      .from('charge_items')
      .select('charge_id')
      .eq('tenant_id', tenantId)
      .eq('source_module', 'down_payment')
      .eq('source_id', leaseId)
      .maybeSingle()

    const chargeId = (item as { charge_id: string } | null)?.charge_id ?? null

    if (chargeId) {
      const { data: bal } = await supabase
        .from('charge_balances')
        .select('paid_amount, status')
        .eq('charge_id', chargeId)
        .maybeSingle()

      const b = bal as { paid_amount: number; status: string } | null

      if (b && b.paid_amount > 0) {
        return {
          ok: false,
          error: { code: 'DOWN_PAYMENT_ALREADY_PAID', message: 'Entrada já paga não pode ser alterada.' },
        }
      }
      if (b && b.status === 'cancelled') {
        return { ok: false, error: { code: 'BILLING_CANCELLED', message: 'Esta Entrada está cancelada.' } }
      }

      const { data: rentalRow2 } = await supabase
        .from('rentals').select('customer_id, start_date').eq('id', leaseId).single()

      try {
        await cancelCharge(supabase, tenantId, chargeId, 'Valor da entrada revisado', user.id)
        await createCharge(supabase, tenantId, {
          customerId: rentalRow2!.customer_id,
          rentalId: leaseId,
          dueDate: data.down_payment_due_date ?? rentalRow2!.start_date ?? new Date().toISOString().slice(0, 10),
          sourceModule: 'down_payment',
          sourceId: leaseId,
          createdBy: user.id,
          items: [{
            description: 'Entrada',
            credit_account_code: ACCOUNTS.RENTAL_REVENUE,
            quantity: 1,
            unit_amount: data.down_payment,
            amount: data.down_payment,
            source_module: 'down_payment',
            source_id: leaseId,
          }],
        })
      } catch (err) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
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

  // Spec 0014: a RPC agora APURA antes de encerrar e recusa débito em aberto
  // sem p_force. Antes, cancelava pendentes e liberava o veículo sem olhar
  // dívida nem caução (F-08).
  const { data: settlement, error } = await supabase.rpc('terminate_rental', {
    p_tenant_id:        tenantId,
    p_rental_id:        parsed.data.lease_id,
    p_termination_date: parsed.data.termination_date,
    p_new_status:       newStatus,
    p_force:            parsed.data.force ?? false,
  })

  if (error) {
    if (error.message?.includes('RENTAL_NOT_ACTIVE')) {
      return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
    }
    if (error.message?.includes('RENTAL_HAS_OPEN_CHARGES')) {
      return {
        ok: false,
        error: {
          code: 'CONFLICT',
          message: 'Há cobranças em aberto. Quite, cancele ou confirme o encerramento mesmo assim.',
        },
      }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  void settlement

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

  const { data: rental, error: rentalError } = await supabase
    .from('rentals')
    .select('cycle, due_day, cycle_amount, use_pro_rata, end_date, status')
    .eq('id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)
    .single()

  if (rentalError || !rental) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Locação não encontrada.' } }
  }
  if (rental.status !== 'active') {
    return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
  }

  // Spec 0014: renovar é ACRESCENTAR linhas ao cronograma. O modelo anterior
  // precisava reconciliar a última cobrança pro rata — atualizar se não paga,
  // gerar complementar se paga — porque documento e plano eram a mesma coisa.
  // Aqui nada foi emitido ainda: basta continuar o plano.
  const { data: lastLine } = await supabase
    .from('rental_billing_schedules')
    .select('sequence_number, period_end')
    .eq('rental_id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const last = lastLine as { sequence_number: number; period_end: string } | null
  const renewalStart = last?.period_end ?? rental.end_date
  const offset = last?.sequence_number ?? 0

  if (!rental.cycle || !rental.due_day || !rental.cycle_amount) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Locação sem ciclo definido.' } }
  }

  const newLines = generateSchedule({
    start_date:   renewalStart ?? rental.end_date!,
    end_date:     parsed.data.new_end_date,
    cycle:        rental.cycle as 'weekly' | 'monthly',
    due_day:      rental.due_day,
    cycle_amount: rental.cycle_amount,
    use_pro_rata: rental.use_pro_rata ?? true,
  })

  if (newLines.length > 0) {
    const { error: insertError } = await supabase.from('rental_billing_schedules').insert(
      newLines.map((l) => ({
        tenant_id:       tenantId,
        rental_id:       parsed.data.lease_id,
        sequence_number: offset + l.sequence_number,
        period_start:    l.period_start,
        period_end:      l.period_end,
        due_date:        l.due_date,
        amount:          l.amount,
      })),
    )

    if (insertError) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: insertError.message } }
    }
  }

  const { error: updateError } = await supabase
    .from('rentals')
    .update({ end_date: parsed.data.new_end_date })
    .eq('id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)

  if (updateError) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: updateError.message } }
  }

  await logAction({
    action: 'update',
    table: 'rentals',
    recordId: parsed.data.lease_id,
    newData: { new_end_date: parsed.data.new_end_date, added_lines: newLines.length },
  })

  revalidateRentalPaths()
  revalidatePath(`/locacoes/${parsed.data.lease_id}`)
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

  const { data: balance } = await supabase
    .from('charge_balances')
    .select('charge_id, customer_id, status, open_amount')
    .eq('charge_id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const b = balance as {
    charge_id: string; customer_id: string; status: string; open_amount: number
  } | null

  if (!b) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (b.status === 'cancelled') {
    return { ok: false, error: { code: 'BILLING_CANCELLED', message: 'Esta cobrança está cancelada.' } }
  }
  if (b.open_amount <= 0) {
    return { ok: false, error: { code: 'BILLING_ALREADY_PAID', message: 'Esta cobrança já foi paga.' } }
  }

  try {
    // Spec 0014: recebimento é do CLIENTE, alocado à cobrança. Antes esta action
    // só trocava o status do documento, sem gerar linha em `payments` — e o
    // painel financeiro, que soma `payments`, não enxergava o recebimento.
    await receivePayment(supabase, tenantId, {
      customerId: b.customer_id,
      amount: b.open_amount,
      method: parsed.data.payment_method,
      paidAt: new Date(parsed.data.paid_at),
      allocations: [{ chargeId: b.charge_id, amount: b.open_amount }],
      receivedBy: user.id,
    })
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
  }

  await logAction({ action: 'update', table: 'charges', recordId: parsed.data.billing_id })
  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// applyDiscount — desconto como ITEM NEGATIVO da cobrança
// ---------------------------------------------------------------------------
// `billings.discount_amount` deixou de existir. Desconto passa a ser um item de
// valor negativo, o que o torna rastreável como qualquer outra composição —
// aparece no extrato, tem origem e entra no ledger.

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

  const { data: balance } = await supabase
    .from('charge_balances')
    .select('charge_id, customer_id, rental_id, status, open_amount')
    .eq('charge_id', parsed.data.billing_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const b = balance as {
    charge_id: string; customer_id: string; rental_id: string | null
    status: string; open_amount: number
  } | null

  if (!b) return { ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }
  if (b.status !== 'open') {
    return { ok: false, error: { code: 'CONFLICT', message: 'Só cobrança em aberto admite desconto.' } }
  }
  if (parsed.data.discount_amount > b.open_amount) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Desconto maior que o saldo em aberto.' } }
  }

  const amount = -Math.abs(parsed.data.discount_amount)

  const { error } = await supabase.from('charge_items').insert({
    tenant_id: tenantId,
    charge_id: b.charge_id,
    description: parsed.data.discount_reason
      ? `Desconto — ${parsed.data.discount_reason}`
      : 'Desconto',
    credit_account_code: ACCOUNTS.RENTAL_REVENUE,
    quantity: 1,
    unit_amount: amount,
    amount,
    source_module: 'discount',
    source_id: b.charge_id,
  })

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  // Estorna a receita na proporção do desconto.
  try {
    await postTransaction(supabase, tenantId, {
      event: {
        type: 'charge_issuance_reversed',
        amount: Math.abs(amount),
        debit_account: ACCOUNTS.RENTAL_REVENUE,
        dimensions: dimensionsOf({
          customerId: b.customer_id,
          rentalId: b.rental_id,
          chargeId: b.charge_id,
        }),
      },
      description: 'Desconto concedido',
      sourceModule: 'discount',
      sourceId: b.charge_id,
      createdBy: user.id,
    })
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
  }

  await logAction({
    action: 'update',
    table: 'charges',
    recordId: b.charge_id,
    newData: { discount: parsed.data.discount_amount, reason: parsed.data.discount_reason },
  })

  revalidatePath('/cobrancas')
  revalidatePath('/locacoes')
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

  const { data: rental } = await supabase
    .from('rentals')
    .select('status, customer_id, vehicle_id')
    .eq('id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)
    .single()

  if (!rental || rental.status !== 'active') {
    return { ok: false, error: { code: 'RENTAL_NOT_ACTIVE', message: 'Locação não está ativa.' } }
  }

  try {
    const charge = await createCharge(supabase, tenantId, {
      customerId: rental.customer_id,
      rentalId: parsed.data.lease_id,
      dueDate: parsed.data.due_date,
      sourceModule: 'manual',
      sourceId: parsed.data.lease_id,
      createdBy: user.id,
      items: [{
        description: parsed.data.description,
        credit_account_code: ACCOUNTS.RENTAL_REVENUE,
        quantity: 1,
        unit_amount: parsed.data.amount,
        amount: parsed.data.amount,
        source_module: 'manual',
        vehicle_id: rental.vehicle_id ?? null,
      }],
    })

    await logAction({ action: 'create', table: 'charges', recordId: charge.chargeId })
    revalidatePath('/cobrancas')
    revalidatePath('/locacoes')
    return { ok: true, data: { billing_id: charge.chargeId } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
  }
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
// attachSignedContract — anexa o PDF do contrato assinado a uma locação.
// O upload em si (Storage, bucket rental-documents) acontece client-side;
// esta action só grava o path/nome resultante em `rentals`.
// ---------------------------------------------------------------------------

export async function attachSignedContract(
  data: AttachSignedContract,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = AttachSignedContractSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos' } }
  }

  const { error } = await supabase
    .from('rentals')
    .update({
      signed_contract_path:        parsed.data.storage_path,
      signed_contract_file_name:   parsed.data.file_name,
      signed_contract_uploaded_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.lease_id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'update', table: 'rentals', recordId: parsed.data.lease_id })
  revalidatePath(`/locacoes/${parsed.data.lease_id}`)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// updateContractTemplate — troca o modelo de contrato vinculado a uma locação
// já criada, para gerar um novo contrato com outro modelo.
// ---------------------------------------------------------------------------

export async function updateContractTemplate(
  leaseId: string,
  contractTemplateId: string | null,
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  if (contractTemplateId !== null && !uuid().safeParse(contractTemplateId).success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Modelo inválido' } }
  }

  const { error } = await supabase
    .from('rentals')
    .update({ contract_template_id: contractTemplateId })
    .eq('id', leaseId)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }

  await logAction({ action: 'update', table: 'rentals', recordId: leaseId })
  revalidatePath(`/locacoes/${leaseId}`)
  return { ok: true, data: undefined }
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

  // Bloqueio de inadimplência. Antes lia `customers.delinquency_status`, coluna
  // mantida por um trigger que nunca disparava para o caso que importa — o
  // campo ficava `current` para sempre, justamente para quem devia (F-04).
  // Agora os fatos vêm da view e a classificação é função pura.
  const [factsRes, policyRes, blockRes] = await Promise.all([
    supabase
      .from('customer_delinquency')
      .select('overdue_count, max_days_overdue, overdue_amount')
      .eq('customer_id', parsed.data.customer_id)
      .maybeSingle(),
    supabase
      .from('delinquency_policies')
      .select('late_days, delinquent_count, delinquent_days, blocked_count, blocked_days, auto_block')
      .eq('tenant_id', tenantId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // `delinquency_blocks` é log append-only com action block/unblock (ADR 0011),
    // não uma linha com data de desbloqueio: bloqueado = última ação é 'block'.
    supabase
      .from('delinquency_blocks')
      .select('action')
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
      .order('acted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const status = classifyCustomerDelinquency(
    factsRes.data as DelinquencyFacts | null,
    (policyRes.data as DelinquencyPolicy | null) ?? DEFAULT_DELINQUENCY_POLICY,
    (blockRes.data as { action: string } | null)?.action === 'block',
  )

  if (!canStartNewRental(status)) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Cliente bloqueado por inadimplência.', field: 'customer_id' },
    }
  }

  // A caução deixou de ser tratamento especial: `createRental` já a cria como
  // cobrança que credita passivo. Delegar elimina a duplicação que existia aqui.
  return createRental({
    ...parsed.data,
    deposit_payment_date: parsed.data.deposit_received_at ?? parsed.data.deposit_payment_date,
  } as CreateRental)
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

  // Saldo da caução vem do LEDGER, não de coluna: `deposits.balance` era
  // mutável e nunca era atualizado (F-08). deposit_movements desaparece —
  // movimento de caução é transação no ledger.
  const { data: deposit } = await supabase
    .from('deposits')
    .select('id, amount, customer_id')
    .eq('rental_id', parsed.data.rental_id)
    .eq('tenant_id', tenantId)
    .is('closed_at', null)
    .limit(1)
    .maybeSingle()

  const dep = deposit as { id: string; amount: number; customer_id: string } | null
  if (!dep) return { ok: false, error: { code: 'NOT_FOUND', message: 'Caução não encontrada para esta locação' } }

  const { data: balanceRow } = await supabase
    .from('deposit_balances')
    .select('balance')
    .eq('rental_id', parsed.data.rental_id)
    .maybeSingle()

  const balance = (balanceRow as { balance: number } | null)?.balance ?? 0
  if (balance <= 0) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Caução sem saldo a movimentar.' } }
  }

  const now = new Date().toISOString()
  const dims = dimensionsOf({
    customerId: dep.customer_id,
    rentalId: parsed.data.rental_id,
  })

  async function settle(returned: number, retained: number, reason: string | null) {
    // Retenção: o passivo com o cliente vira quitação de dívida dele.
    if (retained > 0) {
      await postTransaction(supabase, tenantId!, {
        event: { type: 'deposit_retained', amount: retained, dimensions: dims },
        description: reason ? `Retenção de caução — ${reason}` : 'Retenção de caução',
        sourceModule: 'deposit',
        sourceId: dep!.id,
        createdBy: user!.id,
      })
    }
    // Devolução: sai do caixa e zera o passivo.
    if (returned > 0) {
      await postTransaction(supabase, tenantId!, {
        event: { type: 'deposit_returned', amount: returned, dimensions: dims },
        description: 'Devolução de caução',
        sourceModule: 'deposit',
        sourceId: dep!.id,
        createdBy: user!.id,
      })
    }
  }

  try {
    if (parsed.data.deposit_action === 'full_return') {
      await settle(balance, 0, null)
      await supabase.from('deposits').update({ closed_at: now }).eq('id', dep.id).eq('tenant_id', tenantId)
      await logAction({ action: 'update', table: 'deposits', recordId: dep.id, newData: { returned: balance } })
      revalidateRentalPaths()
      return { ok: true, data: { complementary_billing_needed: false } }
    }

    if (parsed.data.deposit_action === 'full_retention') {
      await settle(0, balance, parsed.data.retention_reason ?? null)
      await supabase.from('deposits').update({ closed_at: now }).eq('id', dep.id).eq('tenant_id', tenantId)
      await logAction({ action: 'update', table: 'deposits', recordId: dep.id, newData: { retained: balance } })
      revalidateRentalPaths()
      return { ok: true, data: { complementary_billing_needed: false } }
    }

    // partial_return
    const { returned_amount, retained_amount, retention_reason } = parsed.data
    const totalHandled = returned_amount + retained_amount
    const shortfall = Math.max(0, totalHandled - balance)

    if (totalHandled > balance) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: `Total movimentado excede o saldo da caução (${balance}).` },
      }
    }

    await settle(returned_amount, retained_amount, retention_reason ?? null)
    await supabase.from('deposits').update({ closed_at: now }).eq('id', dep.id).eq('tenant_id', tenantId)

    await logAction({
      action: 'update',
      table: 'deposits',
      recordId: dep.id,
      newData: { returned_amount, retained_amount },
    })
    revalidateRentalPaths()
    return {
      ok: true,
      data: { complementary_billing_needed: shortfall > 0, shortfall_amount: shortfall > 0 ? shortfall : undefined },
    }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }
  }
}

// ---------------------------------------------------------------------------
// adjustRentalSchedule — reajuste sobre o CRONOGRAMA (Spec 0014 / ADR 0024)
// ---------------------------------------------------------------------------
// A reversão da ADR 0009 simplifica drasticamente este fluxo. Antes existiam
// duas operações: `adjustRental`, que reescrevia o valor de billings emitidos,
// e `regenerateRentalSchedule`, que cancelava documentos pendentes e regerava
// — porque o cronograma e o documento eram a mesma coisa.
//
// Agora o reajuste toca apenas linhas `scheduled`. Período já emitido é
// documento imutável (Princípio 5): ajustá-lo exige cobrança complementar ou
// renegociação, nunca reescrita.

export async function adjustRentalSchedule(
  input: unknown,
): Promise<ActionResult<{ updated_lines: number }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = AdjustScheduleSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Dados inválidos',
        field: first?.path?.map(String).join('.'),
      },
    }
  }

  const { data: count, error } = await supabase.rpc('adjust_rental_schedule', {
    p_tenant_id:      tenantId,
    p_rental_id:      parsed.data.rental_id,
    p_new_amount:     parsed.data.new_amount,
    p_effective_from: parsed.data.effective_from,
    p_justification:  parsed.data.justification,
    p_adjusted_by:    user.id,
  })

  if (error) {
    if (error.message?.includes('RENTAL_NOT_FOUND')) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Locação não encontrada.' } }
    }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
  }

  const updated = (count as number | null) ?? 0

  await logAction({
    action: 'update',
    table: 'rental_billing_schedules',
    recordId: parsed.data.rental_id,
    newData: { new_amount: parsed.data.new_amount, updated_lines: updated },
  })

  revalidateRentalPaths()
  revalidatePath(`/locacoes/${parsed.data.rental_id}`)
  revalidatePath(`/locacoes/${parsed.data.rental_id}/financeiro`)
  return { ok: true, data: { updated_lines: updated } }
}

