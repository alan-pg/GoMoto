import { describe, it, expect } from 'vitest'
import { formatDateExtensoPtBr } from './date-words'

describe('formatDateExtensoPtBr', () => {
  it('formata dia/mês/ano por extenso', () => {
    expect(formatDateExtensoPtBr('2026-07-01')).toBe('1 de julho de 2026')
  })
  it('mês de virada de ano', () => {
    expect(formatDateExtensoPtBr('2026-12-31')).toBe('31 de dezembro de 2026')
    expect(formatDateExtensoPtBr('2027-01-01')).toBe('1 de janeiro de 2027')
  })
  it('todos os meses têm nome correto', () => {
    expect(formatDateExtensoPtBr('2026-01-05')).toBe('5 de janeiro de 2026')
    expect(formatDateExtensoPtBr('2026-02-05')).toBe('5 de fevereiro de 2026')
    expect(formatDateExtensoPtBr('2026-03-05')).toBe('5 de março de 2026')
    expect(formatDateExtensoPtBr('2026-09-05')).toBe('5 de setembro de 2026')
  })
})
