import { describe, it, expect } from 'vitest'
import { canChangeStatus, getSelectableStatuses } from './vehicle-status'

describe('canChangeStatus', () => {
  it('permite available → sold', () => {
    expect(canChangeStatus('available', 'sold')).toBe(true)
  })

  it('permite available → inactive', () => {
    expect(canChangeStatus('available', 'inactive')).toBe(true)
  })

  it('permite sold → available (Reativar)', () => {
    expect(canChangeStatus('sold', 'available')).toBe(true)
  })

  it('permite inactive → available (Reativar)', () => {
    expect(canChangeStatus('inactive', 'available')).toBe(true)
  })

  it('permite available → reserved', () => {
    expect(canChangeStatus('available', 'reserved')).toBe(true)
  })

  it('permite available → maintenance', () => {
    expect(canChangeStatus('available', 'maintenance')).toBe(true)
  })

  it('permite available → sinister', () => {
    expect(canChangeStatus('available', 'sinister')).toBe(true)
  })

  it('bloqueia rented → sold (RN-001)', () => {
    expect(canChangeStatus('rented', 'sold')).toBe(false)
  })

  it('bloqueia rented → inactive (RN-001)', () => {
    expect(canChangeStatus('rented', 'inactive')).toBe(false)
  })

  it('bloqueia rented → reserved (RN-002)', () => {
    expect(canChangeStatus('rented', 'reserved')).toBe(false)
  })

  it('bloqueia rented → available', () => {
    expect(canChangeStatus('rented', 'available')).toBe(false)
  })

  it('bloqueia sold → inactive', () => {
    expect(canChangeStatus('sold', 'inactive')).toBe(false)
  })

  it('bloqueia inactive → sold', () => {
    expect(canChangeStatus('inactive', 'sold')).toBe(false)
  })
})

describe('getSelectableStatuses', () => {
  it('available → [sold, inactive]', () => {
    expect(getSelectableStatuses('available')).toEqual(['sold', 'inactive'])
  })

  it('sold → [available]', () => {
    expect(getSelectableStatuses('sold')).toEqual(['available'])
  })

  it('inactive → [available]', () => {
    expect(getSelectableStatuses('inactive')).toEqual(['available'])
  })

  it('rented → []', () => {
    expect(getSelectableStatuses('rented')).toEqual([])
  })

  it('reserved → [sold, inactive]', () => {
    expect(getSelectableStatuses('reserved')).toEqual(['sold', 'inactive'])
  })

  it('maintenance → [sold, inactive]', () => {
    expect(getSelectableStatuses('maintenance')).toEqual(['sold', 'inactive'])
  })

  it('sinister → [sold, inactive]', () => {
    expect(getSelectableStatuses('sinister')).toEqual(['sold', 'inactive'])
  })
})
