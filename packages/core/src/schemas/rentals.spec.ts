import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { RentalSchema } from './rentals'

const base = {
  vehicle_id: randomUUID(),
  customer_id: randomUUID(),
  cycle: 'monthly' as const,
  due_day: 10,
  cycle_amount: 500,
  start_date: '2026-01-01',
  end_date: '2026-12-01',
}

describe('RentalSchema — vínculo de Vistoria Periódica (RN-005)', () => {
  it('perfil periódico sem frequência → erro no campo periodic_inspection_frequency_days', () => {
    const result = RentalSchema.safeParse({
      ...base,
      periodic_inspection_profile_id: randomUUID(),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('periodic_inspection_frequency_days'))
      expect(issue).toBeDefined()
    }
  })

  it('perfil + frequência juntos → válido', () => {
    const result = RentalSchema.safeParse({
      ...base,
      periodic_inspection_profile_id: randomUUID(),
      periodic_inspection_frequency_days: 30,
    })
    expect(result.success).toBe(true)
  })

  it('nenhum vínculo → válido', () => {
    const result = RentalSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('vínculo de check-in/check-out independe do periódico', () => {
    const result = RentalSchema.safeParse({
      ...base,
      checkin_checkout_inspection_profile_id: randomUUID(),
    })
    expect(result.success).toBe(true)
  })
})
