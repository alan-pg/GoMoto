import { describe, expect, it } from 'vitest'
import {
  calculateAverageTicket,
  calculateDaysOverdue,
  calculateDefaultRate,
  calculatePunctualityRate,
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
  it('overdue + loss contam como inadimplência', () => {
    const rate = calculateDefaultRate([
      { status: 'paid' },
      { status: 'overdue' },
      { status: 'loss' },
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
