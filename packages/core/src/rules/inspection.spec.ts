import { describe, it, expect } from 'vitest'
import {
  calculateInspectionScheduleDates,
  isInspectionScheduleOverdue,
  validateRequiredPhotos,
} from './inspection'

describe('calculateInspectionScheduleDates', () => {
  it('frequência mensal gera N datas até end_date', () => {
    const dates = calculateInspectionScheduleDates({
      start_date: '2026-01-01',
      end_date: '2026-06-01',
      frequency_days: 30,
    })
    expect(dates).toEqual([
      '2026-01-31',
      '2026-03-02',
      '2026-04-01',
      '2026-05-01',
      '2026-05-31',
    ])
  })

  it('frequência semanal gera mais datas que mensal no mesmo período', () => {
    const monthly = calculateInspectionScheduleDates({
      start_date: '2026-01-01',
      end_date: '2026-03-01',
      frequency_days: 30,
    })
    const weekly = calculateInspectionScheduleDates({
      start_date: '2026-01-01',
      end_date: '2026-03-01',
      frequency_days: 7,
    })
    expect(weekly.length).toBeGreaterThan(monthly.length)
  })

  it('nenhuma data quando o primeiro ciclo já ultrapassa end_date', () => {
    const dates = calculateInspectionScheduleDates({
      start_date: '2026-01-01',
      end_date: '2026-01-10',
      frequency_days: 30,
    })
    expect(dates).toEqual([])
  })
})

describe('isInspectionScheduleOverdue', () => {
  const today = new Date('2026-07-30T12:00:00')

  it('target_date passado sem inspections vinculada → true', () => {
    expect(isInspectionScheduleOverdue(
      { target_date: '2026-07-01', has_submitted_or_approved_inspection: false },
      today,
    )).toBe(true)
  })

  it('target_date passado com inspections submitted/approved → false', () => {
    expect(isInspectionScheduleOverdue(
      { target_date: '2026-07-01', has_submitted_or_approved_inspection: true },
      today,
    )).toBe(false)
  })

  it('target_date futuro → false', () => {
    expect(isInspectionScheduleOverdue(
      { target_date: '2026-08-15', has_submitted_or_approved_inspection: false },
      today,
    )).toBe(false)
  })
})

describe('validateRequiredPhotos', () => {
  const photoItems = [
    { id: 'a', label: 'Frente', is_required: true },
    { id: 'b', label: 'Traseira', is_required: true },
    { id: 'c', label: 'Painel', is_required: false },
  ]

  it('todos os itens obrigatórios presentes → ok', () => {
    const result = validateRequiredPhotos(photoItems, [
      { item_id: 'a' },
      { item_id: 'b' },
    ])
    expect(result.ok).toBe(true)
  })

  it('item obrigatório ausente → retorna rótulo faltante', () => {
    const result = validateRequiredPhotos(photoItems, [{ item_id: 'a' }])
    expect(result).toEqual({ ok: false, missingLabel: 'Traseira' })
  })

  it('item opcional ausente → ok', () => {
    const result = validateRequiredPhotos(photoItems, [
      { item_id: 'a' },
      { item_id: 'b' },
    ])
    expect(result.ok).toBe(true)
  })
})
