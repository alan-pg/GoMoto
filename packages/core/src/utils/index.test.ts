import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate } from './index'

describe('formatCurrency', () => {
  it('formata número inteiro como BRL', () => {
    expect(formatCurrency(1250)).toMatch(/R\$\s?1\.250,00/)
  })

  it('formata número decimal com duas casas', () => {
    expect(formatCurrency(99.9)).toMatch(/R\$\s?99,90/)
  })

  it('formata zero', () => {
    expect(formatCurrency(0)).toMatch(/R\$\s?0,00/)
  })
})

describe('formatDate', () => {
  it('formata string ISO como DD/MM/AAAA', () => {
    expect(formatDate('2026-06-10')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('formata objeto Date', () => {
    expect(formatDate(new Date('2026-06-10T12:00:00'))).toMatch(/10\/06\/2026/)
  })
})
