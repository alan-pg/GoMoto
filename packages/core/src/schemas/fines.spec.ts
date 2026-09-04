import { describe, it, expect } from 'vitest'
import { FineSchema } from './index'

const BASE = {
  vehicle_id: '12345678-1234-4234-8234-123456789012',
  description: 'Excesso de velocidade',
  amount: 130.16,
  infraction_date: '2026-08-01',
  responsible: 'company' as const,
}

describe('FineSchema — RENAINF opcional (RN-002 revogada)', () => {
  it('aceita multa sem RENAINF', () => {
    const result = FineSchema.safeParse({ ...BASE })
    expect(result.success).toBe(true)
  })

  it('aceita multa com RENAINF', () => {
    const result = FineSchema.safeParse({ ...BASE, renainf_number: '10581781538' })
    expect(result.success).toBe(true)
  })
})

describe('FineSchema — responsible obrigatório', () => {
  it('rejeita multa sem responsible', () => {
    const { responsible: _omit, ...withoutResponsible } = BASE
    const result = FineSchema.safeParse(withoutResponsible)
    expect(result.success).toBe(false)
  })
})

describe('FineSchema.partial() — usada em updateFine', () => {
  it('aceita atualização parcial só com um campo', () => {
    const result = FineSchema.partial().safeParse({ observations: 'Recurso protocolado' })
    expect(result.success).toBe(true)
  })
})
