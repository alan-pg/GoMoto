/**
 * @file schemas/rentals.ts
 * @description Schemas Zod para o módulo de locação e cobranças (Spec 0004 §5.2).
 * Todos os campos de UI são validados aqui antes de chegarem às Server Actions.
 */

import { z } from 'zod'
import { LateChargeConfigSchema } from './financial'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (YYYY-MM-DD)')

// ---------------------------------------------------------------------------
// Locação — criação
// ---------------------------------------------------------------------------

export const RentalSchema = z.object({
  vehicle_id:         z.string().uuid({ error: 'Veículo obrigatório' }),
  customer_id:        z.string().uuid({ error: 'Cliente obrigatório' }),
  contract_type:      z.enum(['rental', 'rent_to_own']).default('rental'),
  cycle:              z.enum(['weekly', 'monthly']),
  due_day:            z.number().int().min(1).max(28),
  cycle_amount:       z.number().positive({ error: 'Valor do ciclo deve ser positivo' }),
  start_date:         dateString,
  end_date:           dateString,
  use_pro_rata:       z.boolean().default(true),
  security_deposit:   z.number().min(0).nullable().optional(),
  // Se a caução já foi paga no momento da criação (default true — cobrança
  // nasce 'paid'). Se false, gera cobrança 'pending' aguardando pagamento.
  deposit_paid:       z.boolean().default(true),
  // Relevante apenas quando deposit_paid = true: quando o pagamento ocorreu.
  deposit_payment_date: dateString.optional(),
  // Relevante apenas quando deposit_paid = false: vencimento da cobrança.
  deposit_due_date:     dateString.optional(),
  late_charge_config: LateChargeConfigSchema.optional(),
  // Modelo de contrato usado para gerar o PDF na criação (opcional).
  contract_template_id: z.string().uuid().nullable().optional(),
  observations:       z.string().max(2000).nullable().optional(),
}).refine((d) => d.end_date > d.start_date, {
  message: 'Data de fim deve ser posterior à data de início',
  path: ['end_date'],
})

export type CreateRental = z.infer<typeof RentalSchema>

// ---------------------------------------------------------------------------
// Locação — renovação
// ---------------------------------------------------------------------------

export const RenewRentalSchema = z.object({
  lease_id:         z.string().uuid(),
  new_end_date:     dateString,
  current_end_date: dateString,
}).refine((d) => d.new_end_date > d.current_end_date, {
  message: 'Nova data de fim deve ser posterior à data de fim atual',
  path: ['new_end_date'],
})

export type RenewRental = z.infer<typeof RenewRentalSchema>

// ---------------------------------------------------------------------------
// Locação — encerramento
// ---------------------------------------------------------------------------

export const TerminateRentalSchema = z.object({
  lease_id:         z.string().uuid(),
  termination_date: dateString,
  new_status:       z.enum(['closed', 'transferred']).default('closed'),
})

export type TerminateRental = z.infer<typeof TerminateRentalSchema>

// ---------------------------------------------------------------------------
// Cobrança — baixa manual
// ---------------------------------------------------------------------------

export const RegisterPaymentSchema = z.object({
  billing_id:     z.string().uuid(),
  paid_at:        dateString,
  payment_method: z.enum(['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer']),
})

export type RegisterPayment = z.infer<typeof RegisterPaymentSchema>

// ---------------------------------------------------------------------------
// Cobrança — desconto
// ---------------------------------------------------------------------------

export const ApplyDiscountSchema = z.object({
  billing_id:      z.string().uuid(),
  discount_amount: z.number().positive({ error: 'Valor do desconto deve ser positivo' }),
  discount_reason: z.string().min(3, { error: 'Motivo deve ter ao menos 3 caracteres' }),
})

export type ApplyDiscount = z.infer<typeof ApplyDiscountSchema>

// ---------------------------------------------------------------------------
// Cobrança — avulsa
// ---------------------------------------------------------------------------

export const OneTimeChargeSchema = z.object({
  lease_id:    z.string().uuid(),
  description: z.string().min(3, { error: 'Descrição deve ter ao menos 3 caracteres' }),
  amount:      z.number().positive({ error: 'Valor deve ser positivo' }),
  due_date:    dateString,
})

export type CreateOneTimeCharge = z.infer<typeof OneTimeChargeSchema>

// ---------------------------------------------------------------------------
// Fila — adicionar cliente
// ---------------------------------------------------------------------------

export const AddToQueueSchema = z.object({
  customer_id: z.string().uuid({ error: 'Cliente obrigatório' }),
})

export type AddToQueue = z.infer<typeof AddToQueueSchema>

// ---------------------------------------------------------------------------
// Fila — converter para locação
// ---------------------------------------------------------------------------

export const CreateRentalFromQueueSchema = RentalSchema.extend({
  queue_entry_id: z.string().uuid(),
})

export type CreateRentalFromQueue = z.infer<typeof CreateRentalFromQueueSchema>

// ---------------------------------------------------------------------------
// Documentos de clientes — upload
// ---------------------------------------------------------------------------

export const UploadClientDocumentSchema = z.object({
  customer_id:   z.string().uuid({ error: 'Cliente obrigatório' }),
  document_type: z.enum([
    'drivers_license_front',
    'drivers_license_back',
    'id_front',
    'id_back',
    'other',
  ]),
  storage_path: z.string().min(1),
  file_name:    z.string().min(1),
})

export type UploadClientDocument = z.infer<typeof UploadClientDocumentSchema>

// ---------------------------------------------------------------------------
// Locação — anexo do contrato assinado
// ---------------------------------------------------------------------------

export const AttachSignedContractSchema = z.object({
  lease_id:     z.string().uuid(),
  storage_path: z.string().min(1),
  file_name:    z.string().min(1),
})

export type AttachSignedContract = z.infer<typeof AttachSignedContractSchema>
