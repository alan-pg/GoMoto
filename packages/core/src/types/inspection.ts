/**
 * @file types/inspection.ts
 * @description Tipos de domínio do módulo de Vistoria (Spec 0009 §4).
 */

export type InspectionKind = 'checkin' | 'checkout' | 'periodic'

export type InspectionStatus = 'pending' | 'completed' | 'submitted' | 'approved' | 'rejected'

export interface InspectionProfile {
  id: string
  tenant_id: string
  name: string
  description: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  checklist_items?: InspectionProfileChecklistItem[]
  photo_items?: InspectionProfilePhotoItem[]
}

export interface InspectionProfileChecklistItem {
  id: string
  tenant_id: string
  profile_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface InspectionProfilePhotoItem {
  id: string
  tenant_id: string
  profile_id: string
  label: string
  is_required: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** Snapshot de um item de checklist respondido, gravado em `inspections.answers`. */
export interface InspectionAnswerRecord {
  item_id: string
  name: string
  status: 'ok' | 'not_ok'
  note?: string
}

/** Snapshot de uma foto enviada, gravado em `inspections.photos`. */
export interface InspectionPhotoRecord {
  item_id: string
  label: string
  is_required: boolean
  storage_path: string
}

export interface Inspection {
  id: string
  tenant_id: string
  rental_id: string
  inspection_profile_id: string
  schedule_id: string | null
  kind: InspectionKind
  status: InspectionStatus
  answers: InspectionAnswerRecord[]
  photos: InspectionPhotoRecord[]
  executed_by_user_id: string | null
  executed_at: string | null
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface InspectionSchedule {
  id: string
  tenant_id: string
  rental_id: string
  target_date: string
  created_at: string
  updated_at: string
}

/** `inspection_schedules` não tem coluna de status — derivado na leitura (RN-009). */
export type InspectionScheduleDerivedStatus = 'pending' | 'overdue' | 'submitted' | 'approved' | 'rejected'

export interface InspectionScheduleWithStatus extends InspectionSchedule {
  status: InspectionScheduleDerivedStatus
  latest_inspection: Inspection | null
}
