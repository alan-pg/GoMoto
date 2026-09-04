import type { z } from 'zod'
import type { DelinquencySettingsSchema } from '../schemas/financial'

// ============================================================
// Tipos base derivados de schemas Zod
// ============================================================

export type DelinquencyLevel = 'current' | 'late' | 'delinquent' | 'blocked'
export type DepositStatus = 'received' | 'fully_returned' | 'partially_returned' | 'fully_retained'
export type CreditOrigin = 'maintenance_refund' | 'reversal' | 'manual_adjustment'
export type BillingSource = 'rental_cycle' | 'maintenance' | 'fine' | 'expense' | 'manual'

// ============================================================
// Resultado de cálculo de encargos (rules/charges.ts)
// ============================================================

// ============================================================
// Cobrança enriquecida com encargos calculados (RF-014)
// ============================================================

// ============================================================
// ROI por veículo (RF-041–044)
// ============================================================

export interface VehicleCostsByCategory {
  maintenance: number
  insurance: number
  documentation: number
  other: number
}

export interface VehicleROI {
  vehicle_id: string
  acquisition_amount: number | null
  revenues: number
  costs_by_category: VehicleCostsByCategory
  total_costs: number
  sale_value: number | null
  net_result: number | null
  roi: number | null
}

// ============================================================
// Painel financeiro da empresa (RF-038–040)
// ============================================================

export interface OverdueBillingSummary {
  billing_id: string
  customer_name: string
  vehicle_license_plate: string
  amount: number
  days_overdue: number
  due_date: string
}

export interface FinancialDashboard {
  overdue_billings: OverdueBillingSummary[]
  month_receivable: number
  month_received: number
  month_revenue: number
  month_expenses: number
  month_result: number
}

// ============================================================
// Crédito do cliente (RF-022–026)
// ============================================================

export interface CreditApplication {
  id: string
  credit_id: string
  billing_id: string
  amount: number
  applied_at: string
  is_auto: boolean
}

export interface CustomerCredit {
  id: string
  tenant_id: string
  customer_id: string
  amount: number
  available_balance: number
  origin: CreditOrigin
  reason: string
  created_at: string
  applications?: CreditApplication[]
}

// ============================================================
// Caução (RF-003–010)
// ============================================================

export interface DepositMovement {
  id: string
  deposit_id: string
  type: 'return' | 'retention'
  amount: number
  reason: string | null
  movement_date: string
}

export interface Deposit {
  id: string
  tenant_id: string
  rental_id: string
  customer_id: string
  amount: number
  balance: number
  status: DepositStatus
  received_at: string
  closed_at: string | null
}

// ============================================================
// Resultado de validateCreditApplication (rules/credit.ts)
// ============================================================

export type CreditValidationError = 'OVER_BALANCE' | 'OVER_BILLING'

export type CreditValidationResult =
  | { ok: true }
  | { ok: false; errorCode: CreditValidationError }

export type DelinquencySettings = z.infer<typeof DelinquencySettingsSchema>
