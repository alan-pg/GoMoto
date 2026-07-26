import { describe, it, expect } from 'vitest'
import {
  LateChargeConfigSchema,
  CloseRentalFinancialSchema,
  CreateRentalAdjustmentSchema,
  RegenerateRentalScheduleSchema,
  CreatePaymentSchema,
  WaiveChargesSchema,
  CreateCreditSchema,
  ApplyCreditSchema,
  BlockCustomerSchema,
  UnblockCustomerSchema,
  CreateRentalWithDepositSchema,
} from './financial'

describe('LateChargeConfigSchema', () => {
  it('aceita configuração válida com tipo fixo', () => {
    const result = LateChargeConfigSchema.safeParse({
      late_fee_type: 'fixed',
      late_fee_value: 30,
      daily_interest_rate: 0.005,
      grace_period_days: 5,
    })
    expect(result.success).toBe(true)
  })

  it('aceita taxa percentual', () => {
    const result = LateChargeConfigSchema.safeParse({
      late_fee_type: 'percentage',
      late_fee_value: 5,
      daily_interest_rate: 0,
      grace_period_days: 0,
    })
    expect(result.success).toBe(true)
  })

  it('rejeita daily_interest_rate > 1', () => {
    const result = LateChargeConfigSchema.safeParse({
      late_fee_type: 'fixed',
      late_fee_value: 30,
      daily_interest_rate: 1.5,
      grace_period_days: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejeita grace_period_days negativo', () => {
    const result = LateChargeConfigSchema.safeParse({
      late_fee_type: 'fixed',
      late_fee_value: 30,
      daily_interest_rate: 0.005,
      grace_period_days: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe('CloseRentalFinancialSchema', () => {
  const rentalId = '00000000-0000-4000-8000-000000000001'

  // CA-008: devolução integral
  it('CA-008: full_return válido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'full_return',
      return_date: '2026-07-19',
    })
    expect(result.success).toBe(true)
  })

  // CA-009: devolução parcial com motivo
  it('CA-009: partial_return válido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'partial_return',
      returned_amount: 300,
      retained_amount: 200,
      retention_reason: 'Cobertura de dano no veículo',
      return_date: '2026-07-19',
    })
    expect(result.success).toBe(true)
  })

  // CA-011 / RN-006: retenção sem motivo → inválido
  it('CA-011: partial_return sem retention_reason → inválido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'partial_return',
      returned_amount: 300,
      retained_amount: 200,
      return_date: '2026-07-19',
    })
    expect(result.success).toBe(false)
  })

  it('full_retention sem motivo → inválido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'full_retention',
    })
    expect(result.success).toBe(false)
  })

  it('full_retention com motivo → válido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'full_retention',
      retention_reason: 'Cobranças pendentes não quitadas',
    })
    expect(result.success).toBe(true)
  })

  it('motivo com menos de 5 chars → inválido', () => {
    const result = CloseRentalFinancialSchema.safeParse({
      rental_id: rentalId,
      deposit_action: 'full_retention',
      retention_reason: 'abc',
    })
    expect(result.success).toBe(false)
  })
})

describe('CreateRentalAdjustmentSchema', () => {
  const rentalId = '00000000-0000-4000-8000-000000000001'

  // CA-035: justificativa obrigatória
  it('CA-035: sem justificativa → inválido', () => {
    const result = CreateRentalAdjustmentSchema.safeParse({
      rental_id: rentalId,
      new_cycle_amount: 600,
    })
    expect(result.success).toBe(false)
  })

  it('justificativa vazia → inválido', () => {
    const result = CreateRentalAdjustmentSchema.safeParse({
      rental_id: rentalId,
      new_cycle_amount: 600,
      justification: 'ab',
    })
    expect(result.success).toBe(false)
  })

  it('ajuste válido com justificativa', () => {
    const result = CreateRentalAdjustmentSchema.safeParse({
      rental_id: rentalId,
      new_cycle_amount: 600,
      justification: 'Reajuste anual contratual',
    })
    expect(result.success).toBe(true)
  })

  it('new_cycle_amount zero → inválido', () => {
    const result = CreateRentalAdjustmentSchema.safeParse({
      rental_id: rentalId,
      new_cycle_amount: 0,
      justification: 'Justificativa válida aqui',
    })
    expect(result.success).toBe(false)
  })
})

describe('RegenerateRentalScheduleSchema', () => {
  const rentalId = '00000000-0000-4000-8000-000000000001'
  const valid = {
    rental_id: rentalId,
    new_cycle: 'weekly' as const,
    new_due_day: 3,
    new_cycle_amount: 700,
    new_use_pro_rata: true,
    justification: 'Mudança de ciclo solicitada pelo cliente',
  }

  it('mudança válida de ciclo/dia/pro-rata', () => {
    expect(RegenerateRentalScheduleSchema.safeParse(valid).success).toBe(true)
  })

  it('sem justificativa → inválido', () => {
    const { justification: _justification, ...rest } = valid
    expect(RegenerateRentalScheduleSchema.safeParse(rest).success).toBe(false)
  })

  it('new_due_day fora de [1,28] → inválido', () => {
    expect(RegenerateRentalScheduleSchema.safeParse({ ...valid, new_due_day: 29 }).success).toBe(false)
  })

  it('new_cycle inválido → inválido', () => {
    expect(RegenerateRentalScheduleSchema.safeParse({ ...valid, new_cycle: 'daily' }).success).toBe(false)
  })
})

describe('CreatePaymentSchema', () => {
  it('pagamento válido com pix', () => {
    const result = CreatePaymentSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      amount: 500,
      payment_method: 'pix',
      paid_at: '2026-07-19T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('método "other" é aceito', () => {
    const result = CreatePaymentSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      amount: 100,
      payment_method: 'other',
      paid_at: '2026-07-19T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('amount zero → inválido', () => {
    const result = CreatePaymentSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      amount: 0,
      payment_method: 'pix',
      paid_at: '2026-07-19T10:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('WaiveChargesSchema', () => {
  // CA-021: motivo obrigatório
  it('CA-021: sem motivo → inválido', () => {
    const result = WaiveChargesSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
    })
    expect(result.success).toBe(false)
  })

  it('motivo curto → inválido', () => {
    const result = WaiveChargesSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      reason: 'ok',
    })
    expect(result.success).toBe(false)
  })

  it('dispensa com motivo válido → ok', () => {
    const result = WaiveChargesSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      reason: 'Acordo comercial com o cliente',
    })
    expect(result.success).toBe(true)
  })
})

describe('CreateCreditSchema', () => {
  it('crédito válido', () => {
    const result = CreateCreditSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      amount: 150,
      origin: 'maintenance_refund',
      reason: 'Reembolso de peça com garantia',
    })
    expect(result.success).toBe(true)
  })

  it('amount zero → inválido', () => {
    const result = CreateCreditSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      amount: 0,
      origin: 'reversal',
      reason: 'Estorno de cobrança indevida',
    })
    expect(result.success).toBe(false)
  })
})

describe('ApplyCreditSchema', () => {
  it('aplicação válida', () => {
    const result = ApplyCreditSchema.safeParse({
      billing_id: '00000000-0000-4000-8000-000000000001',
      credit_id: '00000000-0000-4000-8000-000000000002',
      amount: 50,
    })
    expect(result.success).toBe(true)
  })
})

describe('BlockCustomerSchema', () => {
  it('bloqueio válido', () => {
    const result = BlockCustomerSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      reason: 'Histórico de inadimplência grave',
    })
    expect(result.success).toBe(true)
  })

  it('motivo curto → inválido', () => {
    const result = BlockCustomerSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      reason: 'não',
    })
    expect(result.success).toBe(false)
  })
})

describe('UnblockCustomerSchema', () => {
  // CA-044: justificativa obrigatória no desbloqueio
  it('CA-044: sem justificativa → inválido', () => {
    const result = UnblockCustomerSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
    })
    expect(result.success).toBe(false)
  })

  it('desbloqueio válido com justificativa', () => {
    const result = UnblockCustomerSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      justification: 'Cliente quitou todas as pendências',
    })
    expect(result.success).toBe(true)
  })
})

describe('CreateRentalWithDepositSchema', () => {
  const validConfig = {
    late_fee_type: 'fixed' as const,
    late_fee_value: 30,
    daily_interest_rate: 0.005,
    grace_period_days: 5,
  }

  it('locação sem caução → válido', () => {
    const result = CreateRentalWithDepositSchema.safeParse({
      late_charge_config: validConfig,
    })
    expect(result.success).toBe(true)
  })

  it('locação com caução e data → válido', () => {
    const result = CreateRentalWithDepositSchema.safeParse({
      deposit_amount: 500,
      deposit_received_at: '2026-07-19',
      late_charge_config: validConfig,
    })
    expect(result.success).toBe(true)
  })

  it('caução sem data → inválido (refine)', () => {
    const result = CreateRentalWithDepositSchema.safeParse({
      deposit_amount: 500,
      late_charge_config: validConfig,
    })
    expect(result.success).toBe(false)
  })
})
