/**
 * @file rules/inspection.ts
 * @description Regras puras do módulo de Vistoria (Spec 0009 §2.3, §3.3):
 * geração determinística das datas de vistoria periódica upfront (espelha
 * exatamente o loop em SQL de `create_rental_with_charges` — mesmo cálculo
 * nos dois lados), classificação de agendamento "atrasado" (RN-009, sem
 * trigger/cron) e checagem de fotos obrigatórias (RF-014/RN-007).
 */

import type { InspectionScheduleDerivedStatus } from '../types/inspection'

// ---------------------------------------------------------------------------
// calculateInspectionScheduleDates — agendamento upfront (RF-011)
// ---------------------------------------------------------------------------

export interface CalculateInspectionScheduleDatesInput {
  start_date: string
  end_date: string
  frequency_days: number
}

/**
 * Gera as datas-alvo de vistoria periódica de `start_date + frequency_days`
 * até `end_date` (inclusive), em passos de `frequency_days`. Não inclui
 * `start_date` em si — a primeira vistoria periódica só faz sentido depois
 * de decorrido o primeiro ciclo.
 */
export function calculateInspectionScheduleDates(
  input: CalculateInspectionScheduleDatesInput,
): string[] {
  const dates: string[] = []
  const end = new Date(input.end_date + 'T12:00:00')
  let cursor = new Date(input.start_date + 'T12:00:00')
  cursor.setDate(cursor.getDate() + input.frequency_days)

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + input.frequency_days)
  }
  return dates
}

// ---------------------------------------------------------------------------
// isInspectionScheduleOverdue — status "atrasada" derivado na leitura (RN-009)
// ---------------------------------------------------------------------------

export interface InspectionScheduleOverdueInput {
  target_date: string
  /** true se já existe `inspections` com status `submitted` ou `approved` para o agendamento. */
  has_submitted_or_approved_inspection: boolean
}

/**
 * `inspection_schedules` não tem coluna de status — "atrasada" é calculado
 * no momento da leitura (sem trigger/cron, Spec 0009 §2.3). `today` é
 * injetável para os testes não dependerem de relógio real.
 */
export function isInspectionScheduleOverdue(
  input: InspectionScheduleOverdueInput,
  today: Date = new Date(),
): boolean {
  if (input.has_submitted_or_approved_inspection) return false
  const due = new Date(input.target_date + 'T12:00:00')
  return today >= due
}

// ---------------------------------------------------------------------------
// deriveInspectionScheduleStatus — combina agendamento + última vistoria
// vinculada num status exibível (RN-009, RN-010). Pura — quem chama resolve
// a leitura (packages/data ou Server Component) e só passa os dados já
// carregados; por isso é segura de importar tanto em Client quanto em
// Server Components (diferente de packages/data, que arrasta hooks/contexto
// React e quebra o boundary de Server Component).
// ---------------------------------------------------------------------------

export interface LatestInspectionForSchedule {
  status: 'pending' | 'completed' | 'submitted' | 'approved' | 'rejected'
}

export function deriveInspectionScheduleStatus(
  schedule: Pick<InspectionScheduleOverdueInput, 'target_date'>,
  latestInspection: LatestInspectionForSchedule | null,
  today: Date = new Date(),
): InspectionScheduleDerivedStatus {
  if (latestInspection?.status === 'approved') return 'approved'
  if (latestInspection?.status === 'submitted') return 'submitted'

  const overdue = isInspectionScheduleOverdue(
    { target_date: schedule.target_date, has_submitted_or_approved_inspection: false },
    today,
  )
  if (overdue) return 'overdue'
  if (latestInspection?.status === 'rejected') return 'rejected'
  return 'pending'
}

/** Agrupa vistorias por `schedule_id`, mantendo a mais recente (`created_at`) de cada. */
export function pickLatestInspectionBySchedule<T extends { schedule_id: string | null; created_at: string }>(
  inspections: T[],
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const insp of inspections) {
    if (!insp.schedule_id) continue
    const current = latest.get(insp.schedule_id)
    if (!current || insp.created_at > current.created_at) latest.set(insp.schedule_id, insp)
  }
  return latest
}

// ---------------------------------------------------------------------------
// validateRequiredPhotos — RF-014 / RN-007
// ---------------------------------------------------------------------------

export interface RequiredPhotoItem {
  id: string
  label: string
  is_required: boolean
}

export interface SubmittedPhoto {
  item_id: string
}

export type ValidateRequiredPhotosResult =
  | { ok: true }
  | { ok: false; missingLabel: string }

/**
 * Confere que toda foto obrigatória do perfil foi enviada. Roda no client
 * (UX imediata) e é reafirmada no backend antes de persistir — a checagem
 * depende do perfil vinculado, que não está no payload de `SubmitInspectionSchema`.
 * Retorna o rótulo do primeiro item obrigatório faltante (determinístico pela
 * ordem de `photo_items`).
 */
export function validateRequiredPhotos(
  photoItems: RequiredPhotoItem[],
  photos: SubmittedPhoto[],
): ValidateRequiredPhotosResult {
  const providedIds = new Set(photos.map((p) => p.item_id))
  const missing = photoItems.find((item) => item.is_required && !providedIds.has(item.id))
  if (missing) return { ok: false, missingLabel: missing.label }
  return { ok: true }
}
