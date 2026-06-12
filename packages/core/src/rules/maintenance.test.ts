import { describe, expect, it } from 'vitest'
import {
  KM_POR_DIA,
  calculateMaintenanceStatus,
  calculateNextMaintenance,
  getInterval,
} from './maintenance'

describe('KM_POR_DIA', () => {
  it('é 1000/7 — média de km/dia de uma moto de aluguel', () => {
    expect(KM_POR_DIA).toBeCloseTo(142.857, 2)
  })
})

describe('getInterval', () => {
  it('match exato retorna o intervalo da tabela', () => {
    expect(getInterval('Troca de óleo')).toEqual({ interval_km: 1000 })
  })

  it('match case-insensitive funciona ("TROCA DE ÓLEO")', () => {
    expect(getInterval('TROCA DE ÓLEO')).toEqual({ interval_km: 1000 })
  })

  it('match sem acento funciona ("troca de oleo")', () => {
    expect(getInterval('troca de oleo')).toEqual({ interval_km: 1000 })
  })

  it('match com espaços extras funciona ("  Vela de ignição  ")', () => {
    expect(getInterval('  Vela de ignição  ')).toEqual({ interval_km: 4000 })
  })

  it('descrição desconhecida retorna undefined', () => {
    expect(getInterval('Manutenção customizada inexistente')).toBeUndefined()
  })

  it('vistorias retornam interval_days, não interval_km', () => {
    expect(getInterval('Vistoria mensal')).toEqual({ interval_days: 30 })
    expect(getInterval('Vistoria periódica')).toEqual({ interval_days: 180 })
  })
})

describe('calculateMaintenanceStatus — completed', () => {
  it('completed=true retorna "completed" sem olhar mais nada', () => {
    expect(
      calculateMaintenanceStatus({
        completed: true,
        description: 'Troca de óleo',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 5000,
      }),
    ).toBe('completed')
  })
})

describe('calculateMaintenanceStatus — controle por KM', () => {
  it('current_km >= predicted_km → "overdue"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Troca de óleo',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 1000,
      }),
    ).toBe('overdue')
  })

  it('current_km dentro do threshold de 10% (Troca de óleo = 100 km antes) → "upcoming"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Troca de óleo',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 950,
      }),
    ).toBe('upcoming')
  })

  it('current_km longe do predicted_km → "scheduled"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Troca de óleo',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 500,
      }),
    ).toBe('scheduled')
  })

  it('descrição desconhecida cai no fallback de 100km de threshold', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Item customizado sem mapping',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 950,
      }),
    ).toBe('upcoming')
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Item customizado sem mapping',
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 899,
      }),
    ).toBe('scheduled')
  })
})

describe('calculateMaintenanceStatus — controle por data', () => {
  const today = new Date('2026-06-12T12:00:00')

  it('hoje >= scheduled_date → "overdue"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          description: 'Vistoria mensal',
          predicted_km: null,
          scheduled_date: '2026-06-10',
          current_km: 0,
        },
        today,
      ),
    ).toBe('overdue')
  })

  it('dentro do threshold (10% de 30 dias = 3 dias antes) → "upcoming"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          description: 'Vistoria mensal',
          predicted_km: null,
          scheduled_date: '2026-06-14',
          current_km: 0,
        },
        today,
      ),
    ).toBe('upcoming')
  })

  it('fora do threshold → "scheduled"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          description: 'Vistoria mensal',
          predicted_km: null,
          scheduled_date: '2026-07-30',
          current_km: 0,
        },
        today,
      ),
    ).toBe('scheduled')
  })

  it('descrição desconhecida cai no fallback de 18 dias', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          description: 'Item sem mapping',
          predicted_km: null,
          scheduled_date: '2026-06-25',
          current_km: 0,
        },
        today,
      ),
    ).toBe('upcoming')
  })
})

describe('calculateMaintenanceStatus — sem KM nem data', () => {
  it('cai no fallback defensivo "scheduled"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        description: 'Item solto',
        predicted_km: null,
        scheduled_date: null,
        current_km: 5000,
      }),
    ).toBe('scheduled')
  })
})

describe('calculateNextMaintenance', () => {
  it('item com interval_km projeta predicted_km = completionKm + interval_km', () => {
    expect(
      calculateNextMaintenance({
        description: 'Troca de óleo',
        completionKm: 5000,
        completionDate: '2026-06-12',
      }),
    ).toEqual({ predicted_km: 6000 })
  })

  it('item com interval_days projeta scheduled_date corretamente', () => {
    expect(
      calculateNextMaintenance({
        description: 'Vistoria mensal',
        completionKm: 5000,
        completionDate: '2026-06-12',
      }),
    ).toEqual({ scheduled_date: '2026-07-12' })
  })

  it('descrição desconhecida retorna null', () => {
    expect(
      calculateNextMaintenance({
        description: 'Item sem mapping',
        completionKm: 5000,
        completionDate: '2026-06-12',
      }),
    ).toBeNull()
  })

  it('parsea data com T12:00:00 para evitar drift de fuso em soma de dias', () => {
    // 'Vistoria periódica' = 180 dias. 2026-01-01 + 180 = 2026-06-30
    expect(
      calculateNextMaintenance({
        description: 'Vistoria periódica',
        completionKm: 0,
        completionDate: '2026-01-01',
      }),
    ).toEqual({ scheduled_date: '2026-06-30' })
  })
})
