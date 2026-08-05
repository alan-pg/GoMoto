import { describe, it, expect } from 'vitest'
import { classifyDelinquency } from './delinquency'

describe('classifyDelinquency', () => {
  // CA-040 / RN-030: sem cobranças vencidas → adimplente
  it('CA-040: 0 vencidas → current', () => {
    expect(classifyDelinquency(0, 0)).toBe('current')
  })

  // RN-031: pelo menos 1 vencida, dentro do limiar → em atraso
  it('RN-031: 1 vencida (abaixo do limiar) → late', () => {
    expect(classifyDelinquency(1, 5)).toBe('late')
  })

  it('RN-031: 2 vencidas, 20 dias → ainda late (limiar padrão=3 cobranças / 30 dias)', () => {
    expect(classifyDelinquency(2, 20)).toBe('late')
  })

  // CA-039 / RN-032: excede limiar de cobranças → inadimplente
  it('CA-039: 3 vencidas (= limiar padrão) → delinquent', () => {
    expect(classifyDelinquency(3, 5)).toBe('delinquent')
  })

  it('RN-032: excede limiar de dias (30) → delinquent', () => {
    expect(classifyDelinquency(1, 30)).toBe('delinquent')
  })

  it('RN-032: excede limiar custom de cobranças', () => {
    const result = classifyDelinquency(5, 10, { delinquent_count: 5 })
    expect(result).toBe('delinquent')
  })

  // RN-033: auto_block=true com threshold atingido → blocked
  it('RN-033: auto_block=true + 5 vencidas (= limiar) → blocked', () => {
    expect(classifyDelinquency(5, 10, { auto_block: true })).toBe('blocked')
  })

  it('RN-033: auto_block=true + 60 dias → blocked', () => {
    expect(classifyDelinquency(1, 60, { auto_block: true })).toBe('blocked')
  })

  it('auto_block=false mesmo com 5 vencidas → delinquent, não blocked', () => {
    expect(classifyDelinquency(5, 10, { auto_block: false })).toBe('delinquent')
  })

  // Limiares customizados
  it('limiares custom: delinquent_count=2', () => {
    expect(classifyDelinquency(2, 5, { delinquent_count: 2 })).toBe('delinquent')
  })

  it('limiares custom: delinquent_days=7', () => {
    expect(classifyDelinquency(1, 7, { delinquent_days: 7 })).toBe('delinquent')
  })

  // Isolamento por tenant: sem cobranças vencidas mesmo com thresholds baixos
  it('RN-029: 0 vencidas sempre current, independente dos limiares', () => {
    expect(classifyDelinquency(0, 0, { delinquent_count: 1, delinquent_days: 1 })).toBe('current')
  })
})
