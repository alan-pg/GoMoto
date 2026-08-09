import { describe, expect, it } from 'vitest'
import {
  KM_POR_DIA,
  DEFAULT_WARN_THRESHOLD_PCT,
  calculateMaintenanceStatus,
  calculateNextMaintenance,
  filterMaintenancesInRentalPeriod,
  buildMaintenanceBootstrapRows,
} from './maintenance'

describe('KM_POR_DIA', () => {
  it('é 1000/7 — média de km/dia de uma moto de aluguel', () => {
    expect(KM_POR_DIA).toBeCloseTo(142.857, 2)
  })
})

describe('DEFAULT_WARN_THRESHOLD_PCT', () => {
  it('vale 10 — alinhado com settings.maintenance.default_warn_threshold_pct', () => {
    expect(DEFAULT_WARN_THRESHOLD_PCT).toBe(10)
  })
})

describe('calculateMaintenanceStatus — completed', () => {
  it('completed=true retorna "completed" sem olhar mais nada', () => {
    expect(
      calculateMaintenanceStatus({
        completed: true,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 5000,
        interval_km: 1000,
      }),
    ).toBe('completed')
  })
})

describe('calculateMaintenanceStatus — controle por KM', () => {
  it('current_km >= predicted_km → "overdue"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 1000,
        interval_km: 1000,
      }),
    ).toBe('overdue')
  })

  it('dentro do threshold de 10% (interval 1000 km → 100 km antes) → "upcoming"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 950,
        interval_km: 1000,
      }),
    ).toBe('upcoming')
  })

  it('warn_threshold_pct customizado (5%) reduz a janela de upcoming', () => {
    // 5% de 1000 = 50 km. current_km 950 = 50 km antes do predicted → bate.
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 950,
        interval_km: 1000,
        warn_threshold_pct: 5,
      }),
    ).toBe('upcoming')
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 949,
        interval_km: 1000,
        warn_threshold_pct: 5,
      }),
    ).toBe('scheduled')
  })

  it('current_km longe do predicted_km → "scheduled"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 500,
        interval_km: 1000,
      }),
    ).toBe('scheduled')
  })

  it('sem interval_km informado, dentro da janela ainda assim resolve como "scheduled" (corretiva)', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 990,
      }),
    ).toBe('scheduled')
  })

  it('sem interval_km, mas current >= predicted ainda dispara "overdue"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: 1000,
        scheduled_date: null,
        current_km: 1500,
      }),
    ).toBe('overdue')
  })
})

describe('calculateMaintenanceStatus — controle por data', () => {
  const today = new Date('2026-06-12T12:00:00')

  it('hoje >= scheduled_date → "overdue"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: null,
          scheduled_date: '2026-06-10',
          current_km: 0,
          interval_days: 30,
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
          predicted_km: null,
          scheduled_date: '2026-06-14',
          current_km: 0,
          interval_days: 30,
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
          predicted_km: null,
          scheduled_date: '2026-07-30',
          current_km: 0,
          interval_days: 30,
        },
        today,
      ),
    ).toBe('scheduled')
  })

  it('sem interval_days, ainda assim cai pra "scheduled" até cruzar a data', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: null,
          scheduled_date: '2026-06-25',
          current_km: 0,
        },
        today,
      ),
    ).toBe('scheduled')
  })
})

describe('calculateMaintenanceStatus — combo KM + data (OR, pior vence)', () => {
  const today = new Date('2026-06-12T12:00:00')

  it('KM ainda agendado mas data já passou → "overdue" (data manda)', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 18000,
          scheduled_date: '2026-06-10',
          current_km: 17500,
          interval_km: 5000,
          interval_days: 180,
        },
        today,
      ),
    ).toBe('overdue')
  })

  it('data ainda agendada mas KM passou → "overdue" (KM manda)', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 18000,
          scheduled_date: '2026-12-15',
          current_km: 18500,
          interval_km: 5000,
          interval_days: 180,
        },
        today,
      ),
    ).toBe('overdue')
  })

  it('KM próximo, data agendada → "upcoming" (pior dos dois)', () => {
    // current 17900, predicted 18000, interval 5000, threshold 10% = 500 → próximo
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 18000,
          scheduled_date: '2026-12-15',
          current_km: 17900,
          interval_km: 5000,
          interval_days: 180,
        },
        today,
      ),
    ).toBe('upcoming')
  })

  it('KM agendado, data próxima → "upcoming" (pior dos dois)', () => {
    // due 2026-06-25, today 2026-06-12, interval 30, threshold 3 dias → próximo
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 30000,
          scheduled_date: '2026-06-14',
          current_km: 10000,
          interval_km: 5000,
          interval_days: 30,
        },
        today,
      ),
    ).toBe('upcoming')
  })

  it('ambos longe → "scheduled"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 30000,
          scheduled_date: '2027-01-01',
          current_km: 10000,
          interval_km: 5000,
          interval_days: 180,
        },
        today,
      ),
    ).toBe('scheduled')
  })

  it('ambos vencidos → "overdue"', () => {
    expect(
      calculateMaintenanceStatus(
        {
          completed: false,
          predicted_km: 18000,
          scheduled_date: '2026-06-10',
          current_km: 18500,
          interval_km: 5000,
          interval_days: 180,
        },
        today,
      ),
    ).toBe('overdue')
  })
})

describe('calculateMaintenanceStatus — sem KM nem data', () => {
  it('cai no fallback defensivo "scheduled"', () => {
    expect(
      calculateMaintenanceStatus({
        completed: false,
        predicted_km: null,
        scheduled_date: null,
        current_km: 5000,
      }),
    ).toBe('scheduled')
  })
})

describe('calculateNextMaintenance', () => {
  it('interval_km projeta predicted_km = completionKm + interval_km', () => {
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
        interval_km: 1000,
      }),
    ).toEqual({ predicted_km: 6000 })
  })

  it('interval_days projeta scheduled_date corretamente', () => {
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
        interval_days: 30,
      }),
    ).toEqual({ scheduled_date: '2026-07-12' })
  })

  it('sem nenhum intervalo retorna null (manutenção avulsa)', () => {
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
      }),
    ).toBeNull()
  })

  it('intervalo zero ou negativo é ignorado', () => {
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
        interval_km: 0,
      }),
    ).toBeNull()
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
        interval_days: -5,
      }),
    ).toBeNull()
  })

  it('com ambos intervalos retorna predicted_km e scheduled_date', () => {
    expect(
      calculateNextMaintenance({
        completionKm: 5000,
        completionDate: '2026-06-12',
        interval_km: 1000,
        interval_days: 30,
      }),
    ).toEqual({ predicted_km: 6000, scheduled_date: '2026-07-12' })
  })

  it('parsea data com T12:00:00 para evitar drift de fuso em soma de dias', () => {
    // 180 dias depois de 2026-01-01 = 2026-06-30
    expect(
      calculateNextMaintenance({
        completionKm: 0,
        completionDate: '2026-01-01',
        interval_days: 180,
      }),
    ).toEqual({ scheduled_date: '2026-06-30' })
  })
})

describe('filterMaintenancesInRentalPeriod', () => {
  const rental = { vehicle_id: 'v1', start_date: '2026-06-01', end_date: '2026-06-30' }

  it('mantém manutenção do mesmo veículo com scheduled_date dentro do período', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v1', scheduled_date: '2026-06-15', completed_date: null },
    ]
    expect(filterMaintenancesInRentalPeriod(maintenances, rental)).toHaveLength(1)
  })

  it('mantém manutenção com completed_date dentro do período mesmo sem scheduled_date', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v1', scheduled_date: null, completed_date: '2026-06-20' },
    ]
    expect(filterMaintenancesInRentalPeriod(maintenances, rental)).toHaveLength(1)
  })

  it('descarta manutenção de outro veículo, mesmo com data dentro do período', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v2', scheduled_date: '2026-06-15', completed_date: null },
    ]
    expect(filterMaintenancesInRentalPeriod(maintenances, rental)).toEqual([])
  })

  it('descarta manutenção do mesmo veículo com datas fora do período', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v1', scheduled_date: '2026-05-31', completed_date: null },
      { id: 'm2', vehicle_id: 'v1', scheduled_date: '2026-07-01', completed_date: null },
    ]
    expect(filterMaintenancesInRentalPeriod(maintenances, rental)).toEqual([])
  })

  it('inclui os limites [start_date, end_date]', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v1', scheduled_date: '2026-06-01', completed_date: null },
      { id: 'm2', vehicle_id: 'v1', scheduled_date: null, completed_date: '2026-06-30' },
    ]
    expect(filterMaintenancesInRentalPeriod(maintenances, rental)).toHaveLength(2)
  })

  it('sem start_date/end_date na locação, retorna lista vazia', () => {
    const maintenances = [
      { id: 'm1', vehicle_id: 'v1', scheduled_date: '2026-06-15', completed_date: null },
    ]
    expect(
      filterMaintenancesInRentalPeriod(maintenances, { vehicle_id: 'v1', start_date: null, end_date: '2026-06-30' }),
    ).toEqual([])
  })
})

describe('buildMaintenanceBootstrapRows', () => {
  const itemKm = { id: 'i1', name: 'Troca de óleo', interval_km: 1000, interval_days: null }
  const itemDays = { id: 'i2', name: 'Revisão de freios', interval_km: null, interval_days: 180 }

  it('item por KM sem histórico informado — vence a partir de 0 e usa currentKm para status', () => {
    const [row] = buildMaintenanceBootstrapRows([itemKm], {}, 500, '2026-08-01')
    expect(row).toMatchObject({
      type: 'preventive',
      description: 'Troca de óleo',
      predicted_km: 1000,
      completed: false,
      observations: 'Sem histórico anterior',
    })
  })

  it('item por KM com histórico vencido antes do currentKm — marca como vencida', () => {
    const [row] = buildMaintenanceBootstrapRows([itemKm], { i1: '200' }, 1500, '2026-08-01')
    expect(row.predicted_km).toBe(1200)
    expect(row.observations).toContain('Vencida')
  })

  it('item por KM com histórico ainda não vencido — mostra a última troca', () => {
    const [row] = buildMaintenanceBootstrapRows([itemKm], { i1: '800' }, 900, '2026-08-01')
    expect(row.predicted_km).toBe(1800)
    expect(row.observations).toBe('Última aos 800 km')
  })

  it('item por dias sem histórico — agenda a partir de hoje', () => {
    const [row] = buildMaintenanceBootstrapRows([itemDays], {}, 0, '2026-08-01')
    expect(row).toMatchObject({
      type: 'inspection',
      description: 'Revisão de freios',
      scheduled_date: '2027-01-28',
      completed: false,
      observations: 'Última em data não informada',
    })
  })

  it('item por dias com histórico informado — soma o intervalo a partir da última data', () => {
    const [row] = buildMaintenanceBootstrapRows([itemDays], { i2: '2026-06-01' }, 0, '2026-08-01')
    expect(row.scheduled_date).toBe('2026-11-28')
    expect(row.observations).toBe('Última em 2026-06-01')
  })

  it('mistura itens de KM e dias, preservando a ordem', () => {
    const rows = buildMaintenanceBootstrapRows([itemKm, itemDays], {}, 0, '2026-08-01')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.type).toBe('preventive')
    expect(rows[1]?.type).toBe('inspection')
  })

  it('lista de itens vazia retorna array vazio', () => {
    expect(buildMaintenanceBootstrapRows([], {}, 0, '2026-08-01')).toEqual([])
  })
})
