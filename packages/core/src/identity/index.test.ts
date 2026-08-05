import { describe, it, expect } from 'vitest'
import {
  assertCpfDigits,
  cpfFromShellEmail,
  cpfShellEmail,
  formatCpf,
  isCpfDigits,
  isCpfShellEmail,
  normalizeCpf,
  validateCpfDigits,
} from './index'

describe('identity helpers', () => {
  it('normaliza qualquer formato para 11 dígitos', () => {
    expect(normalizeCpf('123.456.789-09')).toBe('12345678909')
    expect(normalizeCpf('  123 456 789 09 ')).toBe('12345678909')
    expect(normalizeCpf('12345678909')).toBe('12345678909')
    expect(normalizeCpf(null)).toBe('')
  })

  it('isCpfDigits aceita só 11 dígitos exatos', () => {
    expect(isCpfDigits('12345678909')).toBe(true)
    expect(isCpfDigits('123.456.789-09')).toBe(false)
    expect(isCpfDigits('1234567890')).toBe(false)
  })

  it('assertCpfDigits normaliza e exige 11 dígitos', () => {
    expect(assertCpfDigits('123.456.789-09')).toBe('12345678909')
    expect(() => assertCpfDigits('123')).toThrow(/CPF inválido/)
    expect(() => assertCpfDigits(null)).toThrow(/CPF inválido/)
  })

  it('formatCpf aplica máscara de exibição', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09')
    expect(formatCpf('invalid')).toBe('invalid')
  })

  it('cpfShellEmail é determinístico independentemente do formato de entrada', () => {
    expect(cpfShellEmail('123.456.789-09')).toBe('12345678909@cliente.gomoto.app')
    expect(cpfShellEmail('12345678909')).toBe('12345678909@cliente.gomoto.app')
  })

  it('isCpfShellEmail identifica corretamente', () => {
    expect(isCpfShellEmail('12345678909@cliente.gomoto.app')).toBe(true)
    expect(isCpfShellEmail('alan@email.com')).toBe(false)
    expect(isCpfShellEmail('12345678909@outro.app')).toBe(false)
    expect(isCpfShellEmail(null)).toBe(false)
  })

  it('cpfFromShellEmail extrai os dígitos', () => {
    expect(cpfFromShellEmail('12345678909@cliente.gomoto.app')).toBe('12345678909')
    expect(cpfFromShellEmail('alan@email.com')).toBeNull()
  })
})

describe('validateCpfDigits', () => {
  it('aceita CPF válido', () => expect(validateCpfDigits('52998224725')).toBe(true))
  it('rejeita CPF com dígito verificador errado', () => expect(validateCpfDigits('52998224726')).toBe(false))
  it('rejeita sequência trivial (111...1)', () => expect(validateCpfDigits('11111111111')).toBe(false))
  it('rejeita sequência trivial (000...0)', () => expect(validateCpfDigits('00000000000')).toBe(false))
  it('rejeita string com menos de 11 dígitos', () => expect(validateCpfDigits('123')).toBe(false))
  it('rejeita string vazia', () => expect(validateCpfDigits('')).toBe(false))
})
