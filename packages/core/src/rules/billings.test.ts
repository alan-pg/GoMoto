import { describe, expect, it } from 'vitest'
import {
  calculateAverageTicket,
  calculateDaysOverdue,
  calculateDefaultRate,
  calculatePunctualityRate,
  calculateFinalAmount,
  canApplyDiscount,
  canEditDownPayment,
  canRegisterPayment,
  isChargeOverdue,
} from './billings'

const TODAY = new Date('2026-06-10T12:00:00')

describe('isChargeOverdue', () => {
  it('status overdue → true', () => {
    expect(isChargeOverdue({ status: 'overdue', due_date: '2026-12-01' }, TODAY)).toBe(true)
  })

  it('pending com due_date passada → true', () => {
    expect(isChargeOverdue({ status: 'pending', due_date: '2026-06-01' }, TODAY)).toBe(true)
  })

  it('pending com due_date futura → false', () => {
    expect(isChargeOverdue({ status: 'pending', due_date: '2026-06-20' }, TODAY)).toBe(false)
  })

  it('paid → false (mesmo se due_date passou)', () => {
    expect(isChargeOverdue({ status: 'paid', due_date: '2026-06-01' }, TODAY)).toBe(false)
  })
})

describe('calculateDaysOverdue', () => {
  it('retorna dias entre hoje e due_date', () => {
    expect(calculateDaysOverdue({ status: 'overdue', due_date: '2026-06-01' }, TODAY)).toBe(9)
  })

  it('zero quando não está vencida', () => {
    expect(calculateDaysOverdue({ status: 'paid', due_date: '2026-06-01' }, TODAY)).toBe(0)
  })
})

describe('calculateDefaultRate', () => {
  it('overdue + prejudice contam como inadimplência', () => {
    const rate = calculateDefaultRate([
      { status: 'paid' },
      { status: 'overdue' },
      { status: 'prejudice' },
      { status: 'pending' },
    ])
    expect(rate).toBe(50)
  })

  it('zero quando não há cobranças', () => {
    expect(calculateDefaultRate([])).toBe(0)
  })
})

describe('calculatePunctualityRate', () => {
  it('payment_date <= due_date conta como pontual', () => {
    const rate = calculatePunctualityRate([
      { status: 'paid', due_date: '2026-06-01', payment_date: '2026-05-30' },
      { status: 'paid', due_date: '2026-06-01', payment_date: '2026-06-01' },
      { status: 'paid', due_date: '2026-06-01', payment_date: '2026-06-05' },
      { status: 'pending', due_date: '2026-06-01', payment_date: null },
    ])
    expect(rate).toBeCloseTo(66.67, 1)
  })

  it('zero quando não há cobranças pagas', () => {
    expect(calculatePunctualityRate([{ status: 'pending', due_date: '2026-06-01' }])).toBe(0)
  })
})

describe('calculateAverageTicket', () => {
  it('média das pagas', () => {
    expect(calculateAverageTicket([
      { status: 'paid', amount: 100 },
      { status: 'paid', amount: 200 },
      { status: 'pending', amount: 999 },
    ])).toBe(150)
  })

  it('zero quando não há pagas', () => {
    expect(calculateAverageTicket([{ status: 'pending', amount: 100 }])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Novas regras Spec 0004
// ---------------------------------------------------------------------------

describe('canRegisterPayment', () => {
  it('permite baixa em pending', () => {
    expect(canRegisterPayment('pending')).toEqual({ ok: true })
  })

  it('permite baixa em overdue', () => {
    expect(canRegisterPayment('overdue')).toEqual({ ok: true })
  })

  it('bloqueia baixa em paid', () => {
    const result = canRegisterPayment('paid')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('BILLING_ALREADY_PAID')
  })

  it('bloqueia baixa em prejudice', () => {
    const result = canRegisterPayment('prejudice')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('BILLING_CANCELLED')
  })
})

describe('canApplyDiscount', () => {
  it('permite desconto em pending', () => {
    expect(canApplyDiscount('pending', 50, 300)).toEqual({ ok: true })
  })

  it('bloqueia desconto maior que o original', () => {
    const result = canApplyDiscount('pending', 400, 300)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('DISCOUNT_EXCEEDS_AMOUNT')
  })

  it('bloqueia desconto em cancelled', () => {
    const result = canApplyDiscount('cancelled', 50, 300)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('BILLING_CANCELLED')
  })

  it('bloqueia desconto em prejudice', () => {
    const result = canApplyDiscount('prejudice', 50, 300)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('BILLING_CANCELLED')
  })
})

describe('calculateFinalAmount', () => {
  it('subtrai desconto do original', () => {
    expect(calculateFinalAmount(300, 50)).toBe(250)
  })

  it('sem desconto retorna o original', () => {
    expect(calculateFinalAmount(300, 0)).toBe(300)
  })
})

describe('canEditDownPayment', () => {
  it('permite editar Entrada pending', () => {
    expect(canEditDownPayment('pending')).toEqual({ ok: true })
  })

  it('bloqueia edição de Entrada já paga', () => {
    const result = canEditDownPayment('paid')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('DOWN_PAYMENT_ALREADY_PAID')
  })

  it('bloqueia edição de Entrada cancelada', () => {
    const result = canEditDownPayment('cancelled')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('BILLING_CANCELLED')
  })
})
