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
  amount: extractionField(z.number()),
  ait_number: extractionField(z.string()),
  infraction_location: extractionField(z.string()),
  // PRD 0013 — campos específicos da NA (Notificação de Autuação). Extração
  // não cobre a NP (RF-005) — devolve `null` se o documento não for uma NA.
  renainf_number: extractionField(z.string()),
  notification_date: extractionField(z.string()),
  prior_defense_deadline: extractionField(z.string()),
  driver_identification_deadline: extractionField(z.string()),
  senatran_infraction_code: extractionField(z.string()),
  senatran_infraction_subcode: extractionField(z.string()),
  issuing_agency_name: extractionField(z.string()),
  issuing_agency_code: extractionField(z.string()),
  competent_agency_code: extractionField(z.string()),
  competent_agency_name: extractionField(z.string()),
  driver_name: extractionField(z.string()),
  driver_cnh: extractionField(z.string()),
  driver_cpf: extractionField(z.string()),
  driver_document: extractionField(z.string()),
  infraction_time: extractionField(z.string()),
  measurement_instrument_id: extractionField(z.string()),
  traffic_agent_id: extractionField(z.string()),
  measured_speed: extractionField(z.number()),
  considered_speed: extractionField(z.number()),
  speed_limit: extractionField(z.number()),
  original_renainf_number: extractionField(z.string()),
  infraction_municipality_code: extractionField(z.string()),
  infraction_municipality_name: extractionField(z.string()),
  infraction_state: extractionField(z.string()),
  senatran_message: extractionField(z.string()),
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
