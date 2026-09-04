import { describe, it, expect } from 'vitest'
import {
  LateChargePolicyInputSchema,
  toPolicyRow,
  toPolicyInput,
  DAYS_PER_MONTH,
} from './late-charge-policy'
import { calculateAccruedCharges } from './allocation'

const base = {
  fee_type: 'percentage' as const,
  fee_value: 2,
  monthly_interest_percent: 1,
  grace_period_days: 0,
  min_amount: 0,
  effective_from: '2026-09-01',
}

describe('toPolicyRow — unidade do contrato vira unidade do banco', () => {
  it('multa de 2% vira a fração 0.02, não o número 2', () => {
    // O CHECK `late_charge_percentage_is_fraction` recusa 2. Antes desta
    // função, quem montasse o payload à mão tinha 50% de chance de acertar.
    expect(toPolicyRow(base).fee_value).toBe(0.02)
  })

  it('multa fixa é em reais e não vira fração', () => {
    expect(toPolicyRow({ ...base, fee_type: 'fixed', fee_value: 25 }).fee_value).toBe(25)
  })

  it('1% ao mês vira 0,0333% ao dia', () => {
    expect(toPolicyRow(base).daily_interest_rate).toBeCloseTo(0.000333, 6)
  })

  it('juros zero continua zero — não é o mesmo que "sem política"', () => {
    expect(toPolicyRow({ ...base, monthly_interest_percent: 0 }).daily_interest_rate).toBe(0)
  })
})

describe('a conversão produz o encargo que o contrato promete', () => {
  it('2% + 1% a.m. sobre R$ 1.000 em 30 dias de atraso dá R$ 30', () => {
    // O teste que amarra as duas pontas: se alguém trocar a convenção de
    // `fee_value` outra vez, é aqui que aparece — R$ 20,10 viraria R$ 0,30.
    const row = toPolicyRow(base)
    const acc = calculateAccruedCharges(row, 1000, '2026-07-01', new Date('2026-07-31T12:00:00'))

    expect(acc.days_overdue).toBe(30)
    expect(acc.fee).toBe(20)                  // 2% de 1.000
    expect(acc.interest).toBeCloseTo(9.99, 2) // 0,0333%/dia × 30 dias
    expect(acc.total).toBeCloseTo(29.99, 2)
  })

  it('carência adia o encargo sem perdoá-lo', () => {
    const row = toPolicyRow({ ...base, grace_period_days: 5 })
    const dentro = calculateAccruedCharges(row, 1000, '2026-07-01', new Date('2026-07-05T12:00:00'))
    const fora   = calculateAccruedCharges(row, 1000, '2026-07-01', new Date('2026-07-10T12:00:00'))

    expect(dentro.total).toBe(0)
    expect(dentro.grace_period_active).toBe(true)
    expect(fora.days_overdue).toBe(4)
    expect(fora.fee).toBe(20)
  })
})

describe('toPolicyInput — volta para o formulário', () => {
  it('devolve o percentual que o operador digitou', () => {
    expect(toPolicyInput(toPolicyRow(base))).toMatchObject({
      fee_type: 'percentage',
      fee_value: 2,
      monthly_interest_percent: 1,
    })
  })

  it('não inventa 1% onde a política é 0,99%', () => {
    // A política semeada guarda 0.00033, que é 0,99% ao mês — não 1%. Exibir
    // "1%" faria o operador salvar 1% achando que nada mudou, e mudaria.
    const semeada = { ...toPolicyRow(base), daily_interest_rate: 0.00033 }
    expect(toPolicyInput(semeada).monthly_interest_percent).toBe(0.99)
  })

  it('multa fixa não é multiplicada por 100 na volta', () => {
    const fixa = toPolicyRow({ ...base, fee_type: 'fixed', fee_value: 25 })
    expect(toPolicyInput(fixa).fee_value).toBe(25)
  })
})

describe('LateChargePolicyInputSchema', () => {
  it('aceita a política padrão do mercado', () => {
    expect(LateChargePolicyInputSchema.safeParse(base).success).toBe(true)
  })

  it('recusa multa percentual acima de 100%', () => {
    const r = LateChargePolicyInputSchema.safeParse({ ...base, fee_value: 150 })
    expect(r.success).toBe(false)
  })

  it('deixa passar valor fixo alto — R$ 150 de multa é plausível', () => {
    expect(LateChargePolicyInputSchema.safeParse({
      ...base, fee_type: 'fixed', fee_value: 150,
    }).success).toBe(true)
  })

  it('recusa carência fracionada', () => {
    expect(LateChargePolicyInputSchema.safeParse({
      ...base, grace_period_days: 2.5,
    }).success).toBe(false)
  })

  it('DAYS_PER_MONTH é 30 — a convenção comercial, não o mês do calendário', () => {
    expect(DAYS_PER_MONTH).toBe(30)
  })
})
