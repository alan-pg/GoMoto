import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')

// ============================================================
// Inadimplência — limiares que classificam o cliente (RF-033)
// ============================================================

export const DelinquencySettingsSchema = z.object({
  delinquent_count:  z.number().int().min(1),
  delinquent_days:   z.number().int().min(1),
  blocked_count:     z.number().int().min(1),
  blocked_days:      z.number().int().min(1),
  auto_block:        z.boolean().default(false),
})

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
