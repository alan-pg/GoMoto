import { describe, it, expect } from 'vitest'
import {
  classifyCustomerDelinquency,
  canStartNewRental,
  DEFAULT_DELINQUENCY_POLICY,
  type DelinquencyPolicy,
  type DelinquencyFacts,
} from './delinquency-v2'

function facts(overdue_count: number, max_days_overdue: number, overdue_amount = 500): DelinquencyFacts {
  return { overdue_count, max_days_overdue, overdue_amount }
}

describe('classifyCustomerDelinquency', () => {
  it('sem linha na view, o cliente está em dia', () => {
    expect(classifyCustomerDelinquency(null)).toBe('current')
    expect(classifyCustomerDelinquency(undefined)).toBe('current')
  })

  it('zero vencidas é em dia', () => {
    expect(classifyCustomerDelinquency(facts(0, 0))).toBe('current')
  })

  it('uma vencida dentro da tolerância de dias ainda é em dia', () => {
    const policy: DelinquencyPolicy = { ...DEFAULT_DELINQUENCY_POLICY, late_days: 5 }
    expect(classifyCustomerDelinquency(facts(1, 3), policy)).toBe('current')
  })

  it('uma vencida além da tolerância é atraso', () => {
    expect(classifyCustomerDelinquency(facts(1, 5))).toBe('late')
  })

  it('atinge o limiar por QUANTIDADE vira inadimplente', () => {
    expect(classifyCustomerDelinquency(facts(3, 5))).toBe('delinquent')
  })

  it('atinge o limiar por DIAS vira inadimplente', () => {
    expect(classifyCustomerDelinquency(facts(1, 30))).toBe('delinquent')
  })

  it('não bloqueia automaticamente quando auto_block é falso', () => {
    expect(classifyCustomerDelinquency(facts(10, 90))).toBe('delinquent')
  })

  it('bloqueia automaticamente quando auto_block é verdadeiro', () => {
    const policy: DelinquencyPolicy = { ...DEFAULT_DELINQUENCY_POLICY, auto_block: true }
    expect(classifyCustomerDelinquency(facts(5, 10), policy)).toBe('blocked')
    expect(classifyCustomerDelinquency(facts(1, 60), policy)).toBe('blocked')
  })

  it('bloqueio manual vence a derivação, mesmo com o cliente em dia', () => {
    expect(classifyCustomerDelinquency(null, DEFAULT_DELINQUENCY_POLICY, true)).toBe('blocked')
    expect(classifyCustomerDelinquency(facts(0, 0), DEFAULT_DELINQUENCY_POLICY, true)).toBe('blocked')
  })

  it('quitar as cobranças não desfaz bloqueio manual', () => {
    // O desbloqueio exige ação humana explícita — a mesma semântica que a
    // ADR 0014 protegia, preservada aqui.
    expect(classifyCustomerDelinquency(facts(0, 0), DEFAULT_DELINQUENCY_POLICY, true)).toBe('blocked')
  })

  it('limiares do tenant são respeitados', () => {
    const rigoroso: DelinquencyPolicy = {
      ...DEFAULT_DELINQUENCY_POLICY, delinquent_count: 2, delinquent_days: 10,
    }
    expect(classifyCustomerDelinquency(facts(2, 1), rigoroso)).toBe('delinquent')
    expect(classifyCustomerDelinquency(facts(1, 1), rigoroso)).toBe('late')
  })

  it('a escada é monotônica: mais atraso nunca melhora a classificação', () => {
    const policy: DelinquencyPolicy = { ...DEFAULT_DELINQUENCY_POLICY, auto_block: true }
    const ordem = { current: 0, late: 1, delinquent: 2, blocked: 3 }

    let anterior = 0
    for (const dias of [0, 1, 5, 15, 30, 45, 60, 90]) {
      const nivel = ordem[classifyCustomerDelinquency(facts(1, dias), policy)]
      expect(nivel).toBeGreaterThanOrEqual(anterior)
      anterior = nivel
    }
  })

  it('o caso que o trigger antigo nunca detectava: cobrança que só envelheceu', () => {
    // Nenhum UPDATE aconteceu — apenas o tempo passou. O trigger da ADR 0014
    // jamais disparava aqui; a view calcula na leitura.
    expect(classifyCustomerDelinquency(facts(1, 45))).toBe('delinquent')
  })
})

describe('canStartNewRental', () => {
  it('bloqueado não inicia nova locação', () => {
    expect(canStartNewRental('blocked')).toBe(false)
  })

  it('os demais níveis podem iniciar', () => {
    expect(canStartNewRental('current')).toBe(true)
    expect(canStartNewRental('late')).toBe(true)
    expect(canStartNewRental('delinquent')).toBe(true)
  })
})
