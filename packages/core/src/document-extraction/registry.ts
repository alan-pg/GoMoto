import { z } from 'zod'
import { extractionField, extractionResultSchema, type ExtractionDocumentType } from './types'
import { buildCnhPrompt, buildFineNoticePrompt } from './prompts'

export const CnhFieldsSchema = z.object({
  name: extractionField(z.string()),
  cpf: extractionField(z.string()),
  rg: extractionField(z.string()),
  birth_date: extractionField(z.string()), // ISO date
  drivers_license: extractionField(z.string()),
  drivers_license_category: extractionField(z.string()),
  drivers_license_validity: extractionField(z.string()), // ISO date
})
export type CnhFields = z.infer<typeof CnhFieldsSchema>
export const CnhExtractionResultSchema = extractionResultSchema(CnhFieldsSchema)
export type CnhExtractionResult = z.infer<typeof CnhExtractionResultSchema>

export const FineNoticeFieldsSchema = z.object({
  license_plate: extractionField(z.string()),
  description: extractionField(z.string()),
  infraction_date: extractionField(z.string()),
  due_date: extractionField(z.string()),
  amount: extractionField(z.number()),
  ait_number: extractionField(z.string()),
  infraction_location: extractionField(z.string()),
})
export type FineNoticeFields = z.infer<typeof FineNoticeFieldsSchema>
export const FineNoticeExtractionResultSchema = extractionResultSchema(FineNoticeFieldsSchema)
export type FineNoticeExtractionResult = z.infer<typeof FineNoticeExtractionResultSchema>

interface DocumentExtractionEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  fieldsSchema: TSchema
  promptBuilder: () => string
  targetEntity: 'customer' | 'fine'
}

// RN-005: novo tipo de documento = nova entrada aqui, sem tocar nas existentes.
export const documentExtractionRegistry = {
  cnh: {
    fieldsSchema: CnhFieldsSchema,
    promptBuilder: buildCnhPrompt,
    targetEntity: 'customer',
  },
  fine_notice: {
    fieldsSchema: FineNoticeFieldsSchema,
    promptBuilder: buildFineNoticePrompt,
    targetEntity: 'fine',
  },
} satisfies Record<ExtractionDocumentType, DocumentExtractionEntry>

export type DocumentExtractionRegistry = typeof documentExtractionRegistry
