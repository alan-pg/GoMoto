import { describe, it, expect } from 'vitest'
import {
  SUGGESTED_PLAN_ITEMS,
  findSuggestedItemByDescription,
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

  it('freio/pneu/revisão de entrega/revisão mensal estão marcados como críticos', () => {
    const critical = SUGGESTED_PLAN_ITEMS.filter((i) => i.is_critical).map((i) => i.name)
    expect(critical).toEqual(expect.arrayContaining([
      'Pastilha de freio dianteira',
      'Pastilha de freio traseira',
      'Lona de freio dianteira',
      'Lona de freio traseira',
      'Pneu dianteiro',
      'Pneu traseiro',
      'Revisão de entrega',
      'Revisão mensal',
    ]))
  })
})

describe('findSuggestedItemByDescription', () => {
  it('encontra match exato pelo nome', () => {
    const item = findSuggestedItemByDescription('Troca de óleo')
    expect(item?.name).toBe('Troca de óleo')
  })

  it('é tolerante a caixa e acentuação', () => {
    expect(findSuggestedItemByDescription('troca de oleo')?.name).toBe('Troca de óleo')
    expect(findSuggestedItemByDescription('TROCA DE ÓLEO')?.name).toBe('Troca de óleo')
  })

  it('retorna undefined para descrição vazia ou sem match', () => {
    expect(findSuggestedItemByDescription('')).toBeUndefined()
    expect(findSuggestedItemByDescription('item inexistente xyz')).toBeUndefined()
  })
})
