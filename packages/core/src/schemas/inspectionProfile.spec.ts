import { describe, it, expect } from 'vitest'
import { CreateInspectionProfileSchema } from './inspectionProfile'

const base = {
  name: 'Perfil Padrão',
  checklist_items: [{ name: 'Faróis funcionando' }],
  photo_items: [{ label: 'Frente' }],
}

describe('CreateInspectionProfileSchema', () => {
  it('aceita payload mínimo válido', () => {
    const result = CreateInspectionProfileSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('sem checklist_items → erro', () => {
    const result = CreateInspectionProfileSchema.safeParse({ ...base, checklist_items: [] })
    expect(result.success).toBe(false)
  })

  it('sem photo_items → erro', () => {
    const result = CreateInspectionProfileSchema.safeParse({ ...base, photo_items: [] })
    expect(result.success).toBe(false)
  })

  it('item de foto sem label → erro', () => {
    const result = CreateInspectionProfileSchema.safeParse({
      ...base,
      photo_items: [{ label: 'F' }],
    })
    expect(result.success).toBe(false)
  })

  it('is_required do item de foto assume default true', () => {
    const result = CreateInspectionProfileSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.photo_items[0]?.is_required).toBe(true)
    }
  })
})
