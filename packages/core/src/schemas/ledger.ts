/**
 * Schemas Zod do domínio financeiro (Spec 0014).
 *
 * Validação de payload das Server Actions. Vive em @gomoto/core por regra
 * inviolável do CLAUDE.md: o schema base nunca é duplicado em apps/.
 */

import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')

/** Dinheiro: sempre positivo, no máximo 2 casas. */
const money = z
  .number({ error: 'Valor é obrigatório' })
  .positive('Valor deve ser maior que zero')
  .refine((n) => Math.round(n * 100) === n * 100, 'Valor não pode ter mais de 2 casas decimais')

/** Dinheiro que admite zero — usado em rateio. */
const moneyOrZero = z
  .number()
  .nonnegative('Valor não pode ser negativo')
  .refine((n) => Math.round(n * 100) === n * 100, 'Valor não pode ter mais de 2 casas decimais')

// ============================================================
// Cobrança
// ============================================================

export const ChargeItemSchema = z.object({
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(300),
  credit_account_code: z.string().min(1, 'Conta é obrigatória'),
  quantity: z.number().positive().default(1),
  unit_amount: money,
  amount: money,
  source_module: z.string().min(1),
  source_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
})

export const CreateChargeSchema = z.object({
  customer_id: z.string().uuid('Cliente inválido'),
  rental_id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable().optional(),
  due_date: dateString,
  issue_date: dateString.optional(),
  items: z.array(ChargeItemSchema).min(1, 'A cobrança precisa de ao menos um item'),
})
  // Espelha `charge_items_amount_matches_unit`: o erro aparece no formulário
  // em vez de vir como violação de CHECK do banco.
  .refine(
    (c) => c.items.every((i) => Math.abs(i.amount - round2(i.quantity * i.unit_amount)) < 0.005),
    { message: 'Valor do item não confere com quantidade × valor unitário', path: ['items'] },
  )

export const CancelChargeSchema = z.object({
  charge_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(500),
})

export const WriteOffChargeSchema = z.object({
  charge_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Informe o motivo da baixa').max(500),
})

// ============================================================
// Pagamento
// ============================================================

export const PaymentMethodEnum = z.enum([
  'pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer', 'other',
])

export const AllocationSchema = z.object({
  charge_id: z.string().uuid(),
  amount: money,
})

export const ReceivePaymentSchema = z.object({
  customer_id: z.string().uuid('Cliente inválido'),
  amount: money,
  method: PaymentMethodEnum,
  paid_at: z.string().min(1, 'Data do pagamento é obrigatória'),
  notes: z.string().trim().max(500).nullable().optional(),
  /** Vazio deixa o serviço alocar por vencimento mais antigo. */
  allocations: z.array(AllocationSchema).optional(),
})
  .refine(
    (p) => !p.allocations?.length ||
      round2(p.allocations.reduce((s, a) => s + a.amount, 0)) <= p.amount,
    { message: 'A soma das alocações excede o valor recebido', path: ['allocations'] },
  )

export const ReversePaymentSchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Informe o motivo do estorno').max(500),
})

// ============================================================
// Conta a pagar
// ============================================================

export const ResponsibilityEnum = z.enum(['company', 'customer', 'shared'])
export const ReimbursementEnum = z.enum(['none', 'charge', 'credit'])

export const CreatePayableSchema = z.object({
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(300),
  expense_account_code: z.string().min(1, 'Categoria é obrigatória'),
  cost_center_id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  rental_id: z.string().uuid().nullable().optional(),
  vendor_name: z.string().trim().max(200).nullable().optional(),
  competence_date: dateString,
  due_date: dateString,
  amount: money,
  responsibility: ResponsibilityEnum.default('company'),
  customer_id: z.string().uuid().nullable().optional(),
  customer_amount: moneyOrZero.default(0),
  reimbursement: ReimbursementEnum.default('none'),
  source_module: z.string().min(1),
  source_id: z.string().uuid().nullable().optional(),
  attachment_url: z.string().url().nullable().optional(),
})
  // As cinco regras de `payables`, replicadas para dar erro legível na UI.
  .refine((p) => p.customer_amount <= p.amount,
    { message: 'Parte do cliente excede o total', path: ['customer_amount'] })
  .refine((p) => p.responsibility !== 'company' || p.customer_amount === 0,
    { message: 'Responsabilidade da empresa não admite parte do cliente', path: ['customer_amount'] })
  .refine((p) => p.responsibility !== 'customer' || p.customer_amount === p.amount,
    { message: 'Responsabilidade do cliente exige parte igual ao total', path: ['customer_amount'] })
  .refine((p) => p.customer_amount === 0 || !!p.customer_id,
    { message: 'Informe o cliente responsável pela parte rateada', path: ['customer_id'] })
  .refine((p) => p.customer_amount === 0 || p.reimbursement !== 'none',
    { message: 'Defina como a parte do cliente retorna: cobrança ou crédito', path: ['reimbursement'] })

// ============================================================
// Caução e crédito
// ============================================================

export const CreateDepositSchema = z.object({
  rental_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  amount: money,
  received_at: dateString.nullable().optional(),
})

export const SettleDepositSchema = z.object({
  deposit_id: z.string().uuid(),
  retained_amount: moneyOrZero,
  returned_amount: moneyOrZero,
  reason: z.string().trim().max(500).nullable().optional(),
})
  .refine((d) => d.retained_amount > 0 || d.returned_amount > 0,
    { message: 'Informe quanto reter e/ou devolver' })
  .refine((d) => d.retained_amount === 0 || !!d.reason,
    { message: 'Retenção de caução exige justificativa', path: ['reason'] })

export const GrantCreditSchema = z.object({
  customer_id: z.string().uuid(),
  amount: money,
  origin: z.string().trim().min(1).max(50),
  reason: z.string().trim().min(3, 'Informe o motivo do crédito').max(500),
  expires_at: dateString.nullable().optional(),
  payable_id: z.string().uuid().nullable().optional(),
})

// ============================================================
// Cronograma
// ============================================================

export const AdjustScheduleSchema = z.object({
  rental_id: z.string().uuid(),
  new_amount: money,
  effective_from: dateString,
  justification: z.string().trim().min(3, 'Informe a justificativa do reajuste').max(500),
})

export const IssueChargesSchema = z.object({
  lead_days: z.number().int().min(0).max(30).default(0),
})

// ============================================================
// Classificação por tenant
// ============================================================

export const AccountMappingSchema = z.object({
  account_code: z.string().min(1),
  report_line_code: z.string().min(1),
  in_tax_base: z.boolean().default(false),
  effective_from: dateString,
})

// ============================================================
// Tipos inferidos
// ============================================================

export type ChargeItemInput = z.infer<typeof ChargeItemSchema>
export type CreateChargeInput = z.infer<typeof CreateChargeSchema>
export type ReceivePaymentInput = z.infer<typeof ReceivePaymentSchema>
export type ReversePaymentInput = z.infer<typeof ReversePaymentSchema>
export type CreatePayableInput = z.infer<typeof CreatePayableSchema>
export type CreateDepositInput = z.infer<typeof CreateDepositSchema>
export type SettleDepositInput = z.infer<typeof SettleDepositSchema>
export type GrantCreditInput = z.infer<typeof GrantCreditSchema>
export type AdjustScheduleInput = z.infer<typeof AdjustScheduleSchema>
export type AccountMappingInput = z.infer<typeof AccountMappingSchema>

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
