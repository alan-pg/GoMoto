import { describe, expect, it } from 'vitest'
import {
  KM_POR_DIA,
  DEFAULT_WARN_THRESHOLD_PCT,
  calculateMaintenanceStatus,
  calculateNextMaintenance,
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
