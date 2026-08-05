import { describe, it, expect } from 'vitest'
import { VehicleSchema } from './vehicles'

const base = {
  license_plate: 'ABC1D23',
  renavam: '12345678901',
  make: 'Honda',
  model: 'CG 160',
}

describe('VehicleSchema — IMEI', () => {
  it('rejeita IMEI com 5 dígitos', () => {
    const result = VehicleSchema.safeParse({
      ...base,
      has_tracker: true,
      tracker_brand: 'Rastrear',
      tracker_model: 'X1',
      tracker_imei: '12345',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.includes('15 dígitos'))).toBe(true)
    }
  })

  it('aceita IMEI com 15 dígitos', () => {
    const result = VehicleSchema.safeParse({
      ...base,
      has_tracker: true,
      tracker_brand: 'Rastrear',
      tracker_model: 'X1',
      tracker_imei: '123456789012345',
    })
    expect(result.success).toBe(true)
  })

  it('exige marca/modelo/IMEI quando has_tracker=true', () => {
    const result = VehicleSchema.safeParse({
      ...base,
      has_tracker: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.includes('rastreador'))).toBe(true)
    }
  })

  it('exige valor/vencimento quando has_insurance=true', () => {
    const result = VehicleSchema.safeParse({
      ...base,
      has_insurance: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.includes('seguro'))).toBe(true)
    }
  })
})

describe('VehicleSchema — campos obrigatórios', () => {
  it('rejeita sem license_plate', () => {
    const { license_plate: _, ...rest } = base
    const result = VehicleSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejeita sem renavam', () => {
    const { renavam: _, ...rest } = base
    const result = VehicleSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejeita sem make', () => {
    const { make: _, ...rest } = base
    const result = VehicleSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejeita sem model', () => {
    const { model: _, ...rest } = base
    const result = VehicleSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('aceita sem campos opcionais', () => {
    const result = VehicleSchema.safeParse(base)
    expect(result.success).toBe(true)
  })
})
