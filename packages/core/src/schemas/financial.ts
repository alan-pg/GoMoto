import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')

// ============================================================
// Configuração de encargos por atraso (RF-001, RN-013)
// Snapshot gravado em billings.late_charge_config no momento da criação.
// ============================================================

export const LateChargeConfigSchema = z.object({
  late_fee_type:       z.enum(['fixed', 'percentage']),
  late_fee_value:      z.number().min(0),
  daily_interest_rate: z.number().min(0).max(1),
  grace_period_days:   z.number().int().min(0),
})

export const FinancialSettingsSchema = z.object({
  late_charge_defaults: LateChargeConfigSchema,
  auto_apply_credit:    z.boolean().default(false),
})

export const DelinquencySettingsSchema = z.object({
  delinquent_count:  z.number().int().min(1),
  delinquent_days:   z.number().int().min(1),
  blocked_count:     z.number().int().min(1),
  blocked_days:      z.number().int().min(1),
  auto_block:        z.boolean().default(false),
})

// ============================================================
// Criação de locação com caução (RF-003, RF-011)
// ============================================================

export const CreateRentalWithDepositSchema = z.object({
  deposit_amount:      z.number().positive().optional(),
  deposit_received_at: dateString.optional(),
  late_charge_config:  LateChargeConfigSchema,
}).refine(
  (d) => !d.deposit_amount || !!d.deposit_received_at,
  { message: 'deposit_received_at obrigatório quando deposit_amount informado', path: ['deposit_received_at'] },
)

// ============================================================
// Encerramento financeiro de locação (RF-006–009)
// ============================================================

export const CloseRentalFinancialSchema = z.discriminatedUnion('deposit_action', [
  z.object({
    rental_id:     z.string().uuid(),
    deposit_action: z.literal('full_return'),
    return_date:   dateString,
  }),
  z.object({
    rental_id:        z.string().uuid(),
    deposit_action:   z.literal('partial_return'),
    returned_amount:  z.number().positive(),
    retained_amount:  z.number().positive(),
    retention_reason: z.string().min(5),
    return_date:      dateString,
  }),
  z.object({
    rental_id:        z.string().uuid(),
    deposit_action:   z.literal('full_retention'),
    retention_reason: z.string().min(5),
  }),
  z.object({
    rental_id:      z.string().uuid(),
    deposit_action: z.literal('none'),
  }),
])

// ============================================================
// Reajuste de locação (RF-027–031)
// ============================================================

export const CreateRentalAdjustmentSchema = z.object({
  rental_id:              z.string().uuid(),
  new_cycle_amount:       z.number().positive(),
  new_late_charge_config: LateChargeConfigSchema.optional(),
  justification:          z.string().min(5),
})

// ============================================================
// Mudança de ciclo/dia de vencimento/pro rata — cancela pendentes + regera
// (extensão do reajuste: mudar a forma do cronograma, não só o valor)
// ============================================================

export const RegenerateRentalScheduleSchema = z.object({
  rental_id:              z.string().uuid(),
  new_cycle:              z.enum(['weekly', 'monthly']),
  new_due_day:            z.number().int().min(1).max(28),
  new_cycle_amount:       z.number().positive(),
  new_use_pro_rata:       z.boolean(),
  new_late_charge_config: LateChargeConfigSchema.optional(),
  justification:          z.string().min(5),
})

// ============================================================
// Pagamento de cobrança (RF-049, ADR 0013)
// ============================================================

export const CreatePaymentSchema = z.object({
  billing_id:     z.string().uuid(),
  amount:         z.number().positive(),
  payment_method: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other']),
  paid_at:        z.string().datetime(),
  notes:          z.string().optional(),
})

// ============================================================
// Dispensa de encargos (RF-015, RN-014)
// ============================================================

export const WaiveChargesSchema = z.object({
  billing_id: z.string().uuid(),
  reason:     z.string().min(5),
})

// ============================================================
// Crédito do cliente (RF-022–026)
// ============================================================

export const CreateCreditSchema = z.object({
  customer_id: z.string().uuid(),
  amount:      z.number().positive(),
  origin:      z.enum(['maintenance_refund', 'reversal', 'manual_adjustment']),
  reason:      z.string().min(5),
})

export const ApplyCreditSchema = z.object({
  billing_id: z.string().uuid(),
  credit_id:  z.string().uuid(),
  amount:     z.number().positive(),
})

// ============================================================
// Cobrança automática: confirmação / recusa (RF-017–021)
// ============================================================

export const ConfirmAutoBillingSchema = z.discriminatedUnion('action', [
  z.object({
    action:            z.literal('confirm'),
    source_id:         z.string().uuid(),
    source_type:       z.enum(['maintenance', 'fine', 'expense']),
    amount:            z.number().positive(),
    due_date:          dateString,
    rental_id:         z.string().uuid().optional(),
    late_charge_config: LateChargeConfigSchema,
  }),
  z.object({
    action:      z.literal('refuse'),
    source_id:   z.string().uuid(),
    source_type: z.enum(['maintenance', 'fine', 'expense']),
  }),
])

// ============================================================
// Bloqueio / desbloqueio de cliente (RF-035–036)
// ============================================================

export const BlockCustomerSchema = z.object({
  customer_id: z.string().uuid(),
  reason:      z.string().min(5),
})

export const UnblockCustomerSchema = z.object({
  customer_id:   z.string().uuid(),
  justification: z.string().min(5),
})

// ============================================================
// Alienação de veículo (RF-043)
// ============================================================

export const RegisterVehicleSaleSchema = z.object({
  vehicle_id:  z.string().uuid(),
  sale_value:  z.number().positive(),
  sold_at:     dateString,
})
