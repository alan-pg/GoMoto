import { z } from 'zod'
import { isCpfDigits, normalizeCpf } from '../identity/index'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')

/**
 * CPF aceita qualquer formato na entrada (com ou sem máscara) e
 * normaliza para 11 dígitos antes de validar. Rejeita ausente/inválido —
 * é identidade obrigatória do cliente (ADR 0004 §2).
 */
const cpfDigitsString = z
  .string({ error: 'CPF é obrigatório' })
  .transform((input) => normalizeCpf(input))
  .refine((digits) => isCpfDigits(digits), { message: 'CPF inválido: precisa ter 11 dígitos' })

export const MotorcycleSchema = z.object({
  license_plate: z.string().trim().max(10),
  model: z.string().trim().max(100).optional().nullable(),
  make: z.string().trim().max(100).optional().nullable(),
  year_manufacture: z.string().trim().max(10).optional().nullable(),
  year_model: z.string().trim().max(10).optional().nullable(),
  color: z.string().trim().max(50).optional().nullable(),
  renavam: z.string().trim().max(20).optional().nullable(),
  chassis: z.string().trim().max(20).optional().nullable(),
  fuel: z.string().trim().max(50).optional().nullable(),
  engine_capacity: z.string().trim().max(20).optional().nullable(),
  previous_owner: z.string().trim().max(200).optional().nullable(),
  previous_owner_cpf: z.string().trim().max(14).optional().nullable(),
  purchase_date: dateString.optional().nullable(),
  fipe_value: z.number().positive().max(9999999).optional().nullable(),
  maintenance_up_to_date: z.boolean().optional().nullable(),
  status: z.enum(['available', 'rented', 'maintenance', 'inactive']).optional(),
  photo_url: z.string().url().optional().nullable(),
  km_current: z.number().int().min(0).optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
  // PRD 0002 — identidade documental atual (CRV/CRLV vigente)
  registered_owner_name: z.string().trim().max(200).optional().nullable(),
  registered_owner_document: z.string().trim().max(20).optional().nullable(),
  registered_owner_type: z.enum(['cpf', 'cnpj']).optional().nullable(),
  registration_state: z.string().trim().max(2).optional().nullable(),
  ownership_transferred: z.boolean().optional(),
  ownership_transfer_date: dateString.optional().nullable(),
  // PRD 0002 — aquisição pela empresa
  acquisition_type: z.enum(['zero_km', 'purchase', 'consignment', 'lease', 'donation', 'other']).optional(),
  acquisition_amount: z.number().positive().max(9999999).optional().nullable(),
})

/**
 * VehicleDocumentSchema — CRV/CRLV/recibo de transferência (PRD 0002).
 * Cada moto tem no máximo 1 documento `is_current=true` por tipo
 * (garantido por índice parcial único na migration).
 */
export const VehicleDocumentSchema = z.object({
  motorcycle_id: z.string().uuid(),
  type: z.enum(['crv', 'crlv', 'transfer_receipt', 'other']),
  exercise_year: z.number().int().min(1900).max(2100).optional().nullable(),
  document_number: z.string().trim().max(50).optional().nullable(),
  issued_at: dateString.optional().nullable(),
  registered_owner_name: z.string().trim().max(200).optional().nullable(),
  registered_owner_document: z.string().trim().max(20).optional().nullable(),
  registered_owner_type: z.enum(['cpf', 'cnpj']).optional().nullable(),
  file_url: z.string().url().optional().nullable(),
  is_current: z.boolean().optional(),
  observations: z.string().trim().max(2000).optional().nullable(),
})

/**
 * VehicleObligationSchema — IPVA/licenciamento/DPVAT/seguro/taxa (PRD 0002).
 * `overdue` é derivado em runtime (rules/documentation) e não deve ser
 * gravado diretamente no V1, mas é aceito no enum para o futuro PRD de alertas.
 */
export const VehicleObligationSchema = z.object({
  motorcycle_id: z.string().uuid(),
  type: z.enum(['ipva', 'licensing', 'dpvat', 'insurance', 'crv_issuance', 'detran_fee', 'other']),
  reference_year: z.number().int().min(1900).max(2100),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().min(0).max(9999999),
  due_date: dateString,
  status: z.enum(['pending', 'paid', 'overdue', 'exempt', 'cancelled']).optional(),
  paid_at: dateString.optional().nullable(),
  payment_method: z.string().trim().max(50).optional().nullable(),
  payment_reference: z.string().trim().max(200).optional().nullable(),
  receipt_url: z.string().url().optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
})

export const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cpf: cpfDigitsString,
  rg: z.string().trim().max(20).optional().nullable(),
  state: z.string().trim().max(2).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  zip_code: z.string().trim().max(10).optional().nullable(),
  emergency_contact: z.string().trim().max(300).optional().nullable(),
  drivers_license: z.string().trim().max(20).optional().nullable(),
  drivers_license_validity: dateString.optional().nullable(),
  drivers_license_category: z.string().trim().max(10).optional().nullable(),
  birth_date: dateString.optional().nullable(),
  payment_status: z.string().trim().max(50).optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
  in_queue: z.boolean().optional(),
  active: z.boolean().optional(),
  departure_date: dateString.optional().nullable(),
  departure_reason: z.string().trim().max(1000).optional().nullable(),
})

export const BillingSchema = z.object({
  contract_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(9999999),
  due_date: dateString,
  status: z.enum(['pending', 'paid', 'overdue', 'loss']).optional(),
  payment_date: dateString.optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
})

export const IncomeSchema = z.object({
  vehicle: z.string().trim().max(10),
  date: dateString,
  lessee: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(9999999),
  reference: z.string().trim().max(50).optional().nullable(),
  payment_method: z.string().trim().max(50).optional().nullable(),
  period_from: dateString.optional().nullable(),
  period_to: dateString.optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
})

export const ExpenseSchema = z.object({
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(9999999),
  category: z.string().trim().max(100),
  date: dateString,
  motorcycle_id: z.string().uuid().optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
  invoice_url: z.string().url().optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  // PRD 0002 — despesas podem ser lançadas com vencimento futuro
  payment_status: z.enum(['pending', 'paid']).optional(),
  paid_at: dateString.optional().nullable(),
})

/**
 * FineSchema — PRD 0002 (D3, D6): multa pertence ao veículo. customer_id
 * é opcional (pode ser atribuído depois da identificação do condutor).
 */
export const FineSchema = z.object({
  customer_id: z.string().uuid().optional().nullable(),
  motorcycle_id: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(9999999),
  infraction_date: dateString,
  due_date: dateString.optional().nullable(),
  status: z.enum(['pending', 'paid']).optional(),
  payment_date: dateString.optional().nullable(),
  responsible: z.enum(['customer', 'company']).optional(),
  observations: z.string().trim().max(2000).optional().nullable(),
  // PRD 0002 — campos do AIT (Auto de Infração de Trânsito)
  ait_number: z.string().trim().max(50).optional().nullable(),
  infraction_code: z.string().trim().max(20).optional().nullable(),
  infraction_location: z.string().trim().max(2000).optional().nullable(),
  points: z.number().int().min(0).max(7).optional().nullable(),
  source: z.enum(['detran', 'cetran', 'municipal', 'private_area', 'other']).optional().nullable(),
  ticket_url: z.string().url().optional().nullable(),
})

/**
 * TenantSchema — usado na criação/edição de tenants pela área administrativa
 * da plataforma. Slug obedece kebab-case (mesma convenção dos seeds).
 */
/**
 * CNPJ aceita máscara na entrada, normaliza para 14 dígitos antes de
 * validar. Opcional — a empresa pode entrar sem CNPJ formal (ex.: piloto).
 */
const cnpjDigitsOptional = z
  .string()
  .trim()
  .transform((input) => input.replace(/\D+/g, ''))
  .refine((digits) => digits === '' || /^[0-9]{14}$/.test(digits), {
    message: 'CNPJ inválido: precisa ter 14 dígitos',
  })
  .optional()
  .nullable()

const cepDigits = z
  .string()
  .trim()
  .transform((input) => input.replace(/\D+/g, ''))
  .refine((digits) => /^[0-9]{8}$/.test(digits), { message: 'CEP precisa ter 8 dígitos' })

const ufCode = z
  .string()
  .trim()
  .transform((input) => input.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), { message: 'UF precisa ter 2 letras' })

export const TenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífens (ex.: gomoto-norte)'),
  legal_name: z.string().trim().min(2, 'Razão social é obrigatória').max(200),
  cnpj: cnpjDigitsOptional,
  contact_email: z.string().trim().toLowerCase().email('Email de contato inválido').max(200),
  contact_phone: z.string().trim().min(8, 'Telefone obrigatório').max(30),
  address_zip: cepDigits,
  address_street: z.string().trim().min(2, 'Logradouro obrigatório').max(200),
  address_number: z.string().trim().min(1, 'Número obrigatório').max(20),
  address_complement: z.string().trim().max(100).optional().nullable(),
  address_district: z.string().trim().min(2, 'Bairro obrigatório').max(100),
  address_city: z.string().trim().min(2, 'Cidade obrigatória').max(100),
  address_state: ufCode,
})

/**
 * Cadastro completo de empresa (tenant + owner principal).
 * O owner é criado em auth.users pelo RPC; a senha é definida pelo
 * platform_admin no momento do cadastro (cliente troca depois).
 */
export const CreateTenantWithOwnerSchema = z.object({
  tenant: TenantSchema,
  owner: z.object({
    name: z.string().trim().min(2, 'Nome do responsável é obrigatório').max(200),
    email: z.string().trim().toLowerCase().email('Email do owner inválido').max(200),
    password: z.string().min(8, 'Senha precisa de no mínimo 8 caracteres').max(72),
  }),
})

export const TenantSuspendSchema = z.object({
  reason: z.string().trim().min(1, 'Informe o motivo da suspensão').max(500),
})

export const MaintenanceBootstrapSchema = z.array(z.object({
  standard_item_id: z.string().uuid(),
  last_km: z.number().int().min(0).optional().nullable(),
  last_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  next_km: z.number().int().min(0).optional().nullable(),
  next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['pending', 'done', 'overdue']).optional(),
  observations: z.string().trim().max(2000).optional().nullable(),
}))

