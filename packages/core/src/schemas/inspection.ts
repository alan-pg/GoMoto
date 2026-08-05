/**
 * @file schemas/inspection.ts
 * @description Schemas Zod de execução e análise de vistoria (Spec 0009 §5.2).
 * `SubmitInspectionSchema` é usado tanto por `submitAdminInspection()` (web)
 * quanto pelo Route Handler consumido pelo mobile — mesma validação nos dois
 * pontos de escrita (ADR 0016).
 */

import { z } from 'zod'

const InspectionAnswerSchema = z.object({
  item_id: z.string().uuid(),
  status: z.enum(['ok', 'not_ok']),
  note: z.string().trim().max(1000).optional(),
})
export type InspectionAnswer = z.infer<typeof InspectionAnswerSchema>

const InspectionPhotoSchema = z.object({
  item_id: z.string().uuid(),
  storage_path: z.string().min(1),
})
export type InspectionPhotoAnswer = z.infer<typeof InspectionPhotoSchema>

export const SubmitInspectionSchema = z.object({
  answers: z.array(InspectionAnswerSchema).min(1),
  photos: z.array(InspectionPhotoSchema),
})
export type SubmitInspection = z.infer<typeof SubmitInspectionSchema>
// Validação de fotos obrigatórias (RF-014/RN-007) depende do perfil vinculado
// (fora do payload) — feita por validateRequiredPhotos() em
// packages/core/rules/inspection.ts, chamada após o parse deste schema.

export const ReviewInspectionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  review_notes: z.string().trim().max(1000).optional(),
}).refine(
  (data) => data.decision !== 'rejected' || !!data.review_notes,
  { message: 'Motivo é obrigatório ao rejeitar', path: ['review_notes'] },
)
export type ReviewInspection = z.infer<typeof ReviewInspectionSchema>
