import { describe, it, expect } from 'vitest'
import { numberToWordsPtBr, currencyToExtensoPtBr } from './currency-words'

describe('numberToWordsPtBr', () => {
  it('zero e unidades', () => {
    expect(numberToWordsPtBr(0)).toBe('zero')
    expect(numberToWordsPtBr(1)).toBe('um')
    expect(numberToWordsPtBr(15)).toBe('quinze')
  })
  it('dezenas com e sem unidade', () => {
    expect(numberToWordsPtBr(20)).toBe('vinte')
    expect(numberToWordsPtBr(21)).toBe('vinte e um')
  })
  it('cem é caso especial (não "cento")', () => {
    expect(numberToWordsPtBr(100)).toBe('cem')
  })
  it('centenas compostas', () => {
    expect(numberToWordsPtBr(101)).toBe('cento e um')
    expect(numberToWordsPtBr(350)).toBe('trezentos e cinquenta')
  })
  it('milhar', () => {
    expect(numberToWordsPtBr(1000)).toBe('mil')
    expect(numberToWordsPtBr(2000)).toBe('dois mil')
    expect(numberToWordsPtBr(1050)).toBe('mil e cinquenta')
    expect(numberToWordsPtBr(1234)).toBe('mil duzentos e trinta e quatro')
  })
  it('centena de milhar', () => {
    expect(numberToWordsPtBr(100_000)).toBe('cem mil')
    expect(numberToWordsPtBr(200_000)).toBe('duzentos mil')
  })
  it('rejeita número negativo', () => {
    expect(() => numberToWordsPtBr(-1)).toThrow()
  })
})

describe('currencyToExtensoPtBr', () => {
  it('bate com a amostra hardcoded de valor_ciclo (350)', () => {
    expect(currencyToExtensoPtBr(350)).toBe('trezentos e cinquenta reais')
  })
  it('singular de real e centavo', () => {
    expect(currencyToExtensoPtBr(1)).toBe('um real')
    expect(currencyToExtensoPtBr(0.01)).toBe('um centavo')
  })
  it('reais e centavos combinados', () => {
    expect(currencyToExtensoPtBr(350.5)).toBe('trezentos e cinquenta reais e cinquenta centavos')
  })
  it('mil reais (amostra de caução)', () => {
    expect(currencyToExtensoPtBr(1000)).toBe('mil reais')
  })
})
