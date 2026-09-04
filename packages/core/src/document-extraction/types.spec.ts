import { describe, it, expect } from 'vitest'
import { ExtractDocumentFileSchema, extractionField, extractionResultSchema } from './types'
import { z } from 'zod'

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

describe('ExtractDocumentFileSchema', () => {
  it('aceita PDF dentro do limite de 10MB', () => {
    const file = makeFile('cnh.pdf', 'application/pdf', 1024)
    expect(ExtractDocumentFileSchema.safeParse(file).success).toBe(true)
  })

  it('rejeita arquivo > 10MB (RNF-003)', () => {
    const file = makeFile('cnh.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)
    const result = ExtractDocumentFileSchema.safeParse(file)
    expect(result.success).toBe(false)
  })

  it('rejeita MIME não suportado (RNF-003)', () => {
    const file = makeFile('cnh.txt', 'text/plain', 1024)
    const result = ExtractDocumentFileSchema.safeParse(file)
    expect(result.success).toBe(false)
  })
})

describe('extractionField', () => {
  const field = extractionField(z.string())

  it('aceita value + confidence bem formados', () => {
    expect(field.safeParse({ value: 'ABC123', confidence: 'high' }).success).toBe(true)
  })

  it('aceita value null (campo não identificado)', () => {
    expect(field.safeParse({ value: null, confidence: 'low' }).success).toBe(true)
  })

  it('rejeita confidence fora de high/low (RF-004)', () => {
    const result = field.safeParse({ value: 'ABC123', confidence: 'medium' })
    expect(result.success).toBe(false)
  })
})

describe('extractionResultSchema', () => {
  const schema = extractionResultSchema(
    z.object({ name: extractionField(z.string()) }),
  )

  it('aceita resultado bem formado', () => {
    const result = schema.safeParse({
      documentType: 'cnh',
      fields: { name: { value: 'João', confidence: 'high' } },
      fieldsFound: 1,
      fieldsTotal: 1,
    })
    expect(result.success).toBe(true)
  })

  it('rejeita documentType fora do enum', () => {
    const result = schema.safeParse({
      documentType: 'rg',
      fields: { name: { value: 'João', confidence: 'high' } },
      fieldsFound: 1,
      fieldsTotal: 1,
    })
    expect(result.success).toBe(false)
  })
})
