/**
 * @file schemas/inspectionProfile.ts
 * @description Schemas Zod do Perfil de Vistoria — checklist + itens de imagem
 * (Spec 0009 §5.2). Entidade única reaproveitada nos dois vínculos de
 * `rentals` (ADR 0015).
 */

import { z } from 'zod'

export const InspectionProfileChecklistItemSchema = z.object({
  name: z.string().trim().min(3).max(200),
  sort_order: z.number().int().nonnegative().default(0),
})
export type InspectionProfileChecklistItemInput = z.infer<typeof InspectionProfileChecklistItemSchema>

export const InspectionProfilePhotoItemSchema = z.object({
  label: z.string().trim().min(2).max(100),
  is_required: z.boolean().default(true),
  sort_order: z.number().int().nonnegative().default(0),
})
export type InspectionProfilePhotoItemInput = z.infer<typeof InspectionProfilePhotoItemSchema>

export const CreateInspectionProfileSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  checklist_items: z.array(InspectionProfileChecklistItemSchema).min(1, 'Adicione ao menos um item de checklist'),
  photo_items: z.array(InspectionProfilePhotoItemSchema).min(1, 'Adicione ao menos um item de imagem'),
})
export type CreateInspectionProfile = z.infer<typeof CreateInspectionProfileSchema>

export const UpdateInspectionProfileSchema = CreateInspectionProfileSchema.partial()
export type UpdateInspectionProfile = z.infer<typeof UpdateInspectionProfileSchema>
