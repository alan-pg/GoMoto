import { describe, it, expect } from 'vitest'
import { calculateLateCharges } from './charges'
import type { LateChargeConfig } from '../types/financial'

const fixed: LateChargeConfig = {
  late_fee_type: 'fixed',
  late_fee_value: 25,
  daily_interest_rate: 0.005,
  grace_period_days: 0,
}

const pct: LateChargeConfig = {
  late_fee_type: 'percentage',
  late_fee_value: 5,
  daily_interest_rate: 0.001,
  grace_period_days: 0,
}

const withGrace: LateChargeConfig = {
  late_fee_type: 'fixed',
  late_fee_value: 25,
  daily_interest_rate: 0.005,
  grace_period_days: 5,
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function dueDate(daysAgoN: number): string {
  return daysAgo(daysAgoN).toISOString().slice(0, 10)
}

describe('calculateLateCharges', () => {
  it('retorna zeros quando config é null', () => {
    const result = calculateLateCharges(null, 500, dueDate(10))
    expect(result.total).toBe(0)
    expect(result.grace_period_active).toBe(false)
  })

  it('retorna zeros quando baseAmount é zero', () => {
    const result = calculateLateCharges(fixed, 0, dueDate(10))
    expect(result.total).toBe(0)
  })

  it('retorna zeros quando a cobrança não está vencida', () => {
    const result = calculateLateCharges(fixed, 500, dueDate(0))
    expect(result.total).toBe(0)
    expect(result.days_since_due).toBeLessThanOrEqual(0)
  })

  // CA-017: R$500, multa R$25 fixo, 0 carência, vencida há 10 dias, juros 0,5%/dia
  it('CA-017: fee fixa + juros 10 dias, sem carência', () => {
    const result = calculateLateCharges(fixed, 500, dueDate(10))
    expect(result.fee).toBe(25)
    expect(result.interest).toBe(25)   // 10 × 0,005 × 500 = 25
    expect(result.total).toBe(50)
    expect(result.days_overdue).toBe(10)
    expect(result.grace_period_active).toBe(false)
  })

  // CA-018: 5 dias de carência, vencida há 3 dias → ainda na carência
  it('CA-018: dentro do período de carência → zeros com grace_period_active=true', () => {
    const result = calculateLateCharges(withGrace, 500, dueDate(3))
    expect(result.fee).toBe(0)
    expect(result.interest).toBe(0)
    expect(result.total).toBe(0)
    expect(result.grace_period_active).toBe(true)
    expect(result.days_overdue).toBe(0)
  })

  // CA-019: 5 dias de carência, vencida há 6 dias → 1 dia de encargos
  it('CA-019: carência encerrada no dia 5, 1 dia de encargos', () => {
    const result = calculateLateCharges(withGrace, 500, dueDate(6))
    expect(result.grace_period_active).toBe(false)
    expect(result.days_overdue).toBe(1)
    expect(result.fee).toBe(25)           // multa aplicada uma vez
    expect(result.interest).toBe(2.5)    // 1 × 0,005 × 500
    expect(result.total).toBe(27.5)
  })

  // RN-010: multa aplicada uma única vez independente dos dias
  it('RN-010: multa fixa não duplica com mais dias', () => {
    const r10 = calculateLateCharges(fixed, 500, dueDate(10))
    const r20 = calculateLateCharges(fixed, 500, dueDate(20))
    expect(r10.fee).toBe(25)
    expect(r20.fee).toBe(25)             // mesma multa
    expect(r20.interest).toBeGreaterThan(r10.interest)
  })

  // RN-012: encargos sobre valor líquido (base = amount − discount)
  it('RN-012: encargos calculados sobre o baseAmount informado', () => {
    const base = 300 // 500 - 200 de desconto
    const result = calculateLateCharges(fixed, base, dueDate(10))
    expect(result.fee).toBe(25)              // fixo, independe do base
    expect(result.interest).toBeCloseTo(15) // 10 × 0.005 × 300
  })

  // Taxa percentual
  it('multa percentual calculada sobre baseAmount', () => {
    const result = calculateLateCharges(pct, 1000, dueDate(5))
    expect(result.fee).toBe(50)    // 5% de 1000
    expect(result.interest).toBe(5) // 5 × 0.001 × 1000
    expect(result.total).toBe(55)
  })

  // Encargos zerados (late_fee_value=0 + daily_interest_rate=0)
  it('encargos zerados quando ambas as taxas são 0', () => {
    const zeroConfig: LateChargeConfig = {
      late_fee_type: 'fixed',
      late_fee_value: 0,
      daily_interest_rate: 0,
      grace_period_days: 0,
    }
    const result = calculateLateCharges(zeroConfig, 500, dueDate(10))
    expect(result.fee).toBe(0)
    expect(result.interest).toBe(0)
    expect(result.total).toBe(0)
  })
})
