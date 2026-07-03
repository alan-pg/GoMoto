import { describe, expect, it } from 'vitest'
import { isIdleVehicle } from './vehicles'

const TODAY = new Date('2026-06-10T12:00:00')

describe('isIdleVehicle', () => {
  it('available + sem update há 10 dias → ocioso', () => {
    expect(isIdleVehicle(
      { status: 'available', updated_at: '2026-05-31T12:00:00Z' },
      TODAY,
    )).toBe(true)
  })

  it('available + atualizado ontem → não ocioso', () => {
    expect(isIdleVehicle(
      { status: 'available', updated_at: '2026-06-09T12:00:00Z' },
      TODAY,
    )).toBe(false)
  })

  it('alugado nunca é ocioso', () => {
    expect(isIdleVehicle(
      { status: 'rented', updated_at: '2025-01-01T00:00:00Z' },
      TODAY,
    )).toBe(false)
  })

  it('aceita threshold customizado', () => {
    expect(isIdleVehicle(
      { status: 'available', updated_at: '2026-06-05T12:00:00Z' },
      TODAY,
      3,
    )).toBe(true)
  })
})
