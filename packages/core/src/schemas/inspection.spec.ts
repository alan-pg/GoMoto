import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { SubmitInspectionSchema, ReviewInspectionSchema } from './inspection'

describe('SubmitInspectionSchema', () => {
  it('aceita payload válido com respostas e fotos', () => {
    const result = SubmitInspectionSchema.safeParse({
      answers: [{ item_id: randomUUID(), status: 'ok' }],
      photos: [{ item_id: randomUUID(), storage_path: 'tenant/inspection/frente.jpg' }],
    })
    expect(result.success).toBe(true)
  })

  it('sem answers → erro', () => {
    const result = SubmitInspectionSchema.safeParse({ answers: [], photos: [] })
    expect(result.success).toBe(false)
  })

  it('status inválido → erro', () => {
    const result = SubmitInspectionSchema.safeParse({
      answers: [{ item_id: randomUUID(), status: 'maybe' }],
      photos: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('ReviewInspectionSchema', () => {
  it('rejected sem review_notes → erro', () => {
    const result = ReviewInspectionSchema.safeParse({ decision: 'rejected' })
    expect(result.success).toBe(false)
  })

  it('rejected com motivo → válido', () => {
    const result = ReviewInspectionSchema.safeParse({
      decision: 'rejected',
      review_notes: 'Foto do farol dianteiro não confere com o item',
    })
    expect(result.success).toBe(true)
  })

  it('approved sem motivo → válido', () => {
    const result = ReviewInspectionSchema.safeParse({ decision: 'approved' })
    expect(result.success).toBe(true)
  })
})
