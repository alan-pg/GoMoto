import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')

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
})

export const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cpf: z.string().trim().max(14).optional().nullable(),
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
})

export const FineSchema = z.object({
  customer_id: z.string().uuid(),
  motorcycle_id: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive().max(9999999),
  infraction_date: dateString,
  due_date: dateString.optional().nullable(),
  status: z.enum(['pending', 'paid']).optional(),
  payment_date: dateString.optional().nullable(),
  responsible: z.enum(['customer', 'company']).optional(),
  observations: z.string().trim().max(2000).optional().nullable(),
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

