import { describe, it, expect } from 'vitest'
import {
  CloseRentalFinancialSchema,
  CreatePaymentSchema,
  WaiveChargesSchema,
  CreateCreditSchema,
  ApplyCreditSchema,
  BlockCustomerSchema,
  UnblockCustomerSchema,
} from './financial'

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

