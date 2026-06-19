import { describe, it, expect } from 'vitest'
import {
  SUGGESTED_PLAN_ITEMS,
  groupSuggestionsByCategory,
  type SuggestedItemCategory,
} from './suggested-plan-items'

describe('SUGGESTED_PLAN_ITEMS', () => {
  it('todos os itens têm pelo menos um intervalo (km ou dias)', () => {
    for (const item of SUGGESTED_PLAN_ITEMS) {
      const hasInterval = item.interval_km != null || item.interval_days != null
      expect(hasInterval, `item "${item.name}" precisa ter interval_km ou interval_days`).toBe(true)
    }
  })

  it('nomes são únicos (sem duplicação com/sem acento)', () => {
    const names = SUGGESTED_PLAN_ITEMS.map((i) => i.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('nomes normalizados (lowercase + sem diacríticos) também são únicos', () => {
    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const normalized = SUGGESTED_PLAN_ITEMS.map((i) => normalize(i.name))
    expect(new Set(normalized).size).toBe(normalized.length)
  })

  it('todas as categorias pertencem ao enum aceito no schema', () => {
    const allowed: SuggestedItemCategory[] = [
      'oil', 'filter', 'brake', 'tire', 'wear_part',
      'inspection', 'fluid', 'transmission', 'other',
    ]
    for (const item of SUGGESTED_PLAN_ITEMS) {
      expect(allowed).toContain(item.category)
    }
  })

  it('itens de tipo "inspection" sempre têm intervalo (km ou dias) — D8 reservado', () => {
    const inspections = SUGGESTED_PLAN_ITEMS.filter((i) => i.type === 'inspection')
    expect(inspections.length).toBeGreaterThan(0)
    for (const i of inspections) {
      expect(i.interval_km != null || i.interval_days != null).toBe(true)
    }
  })

  it('freio/pneu/vistoria de entrega/vistoria mensal estão marcados como críticos', () => {
    const critical = SUGGESTED_PLAN_ITEMS.filter((i) => i.is_critical).map((i) => i.name)
    expect(critical).toEqual(expect.arrayContaining([
      'Pastilha de freio dianteira',
      'Pastilha de freio traseira',
      'Lona de freio dianteira',
      'Lona de freio traseira',
      'Pneu dianteiro',
      'Pneu traseiro',
      'Vistoria de entrega',
      'Vistoria mensal',
    ]))
  })
})

describe('groupSuggestionsByCategory', () => {
  it('todo item aparece exatamente uma vez em alguma categoria', () => {
    const grouped = groupSuggestionsByCategory()
    const flat = Object.values(grouped).flat()
    expect(flat.length).toBe(SUGGESTED_PLAN_ITEMS.length)
  })

  it('cada item está agrupado na própria categoria', () => {
    const grouped = groupSuggestionsByCategory()
    for (const [category, items] of Object.entries(grouped)) {
      for (const item of items) {
        expect(item.category).toBe(category)
      }
    }
  })
})
