import { describe, expect, it } from 'vitest'
import { isIdleMotorcycle } from './motorcycles'

const TODAY = new Date('2026-06-10T12:00:00')

describe('isIdleMotorcycle', () => {
  it('available + sem update há 10 dias → ociosa', () => {
    expect(isIdleMotorcycle(
      { status: 'available', updated_at: '2026-05-31T12:00:00Z' },
      TODAY,
    )).toBe(true)
  })

  it('available + atualizada ontem → não ociosa', () => {
    expect(isIdleMotorcycle(
      { status: 'available', updated_at: '2026-06-09T12:00:00Z' },
      TODAY,
    )).toBe(false)
  })

  it('alugada nunca é ociosa', () => {
    expect(isIdleMotorcycle(
      { status: 'rented', updated_at: '2025-01-01T00:00:00Z' },
      TODAY,
    )).toBe(false)
  })

  it('aceita threshold customizado', () => {
    expect(isIdleMotorcycle(
      { status: 'available', updated_at: '2026-06-05T12:00:00Z' },
      TODAY,
      3,
    )).toBe(true)
  })
})
