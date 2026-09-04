import { describe, it, expect } from 'vitest'
import {
  generateSchedule,
  selectIssuableLines,
  selectAdjustableLines,
  contractedBacklog,
  type ScheduleStatus,
} from './schedule'

const HOJE = new Date(2026, 7, 12) // 2026-08-12 local

function line(period_start: string, status: ScheduleStatus, amount = 250) {
  return { period_start, status, amount }
}

describe('generateSchedule', () => {
  const base = {
    start_date: '2026-08-01',
    end_date: '2026-08-29',
    cycle: 'weekly' as const,
    due_day: 6, // sábado
    cycle_amount: 250,
    use_pro_rata: false,
  }

  it('numera as linhas a partir de 1, em sequência', () => {
    const linhas = generateSchedule(base)
    expect(linhas.length).toBeGreaterThan(0)
    expect(linhas.map((l) => l.sequence_number)).toEqual(
      linhas.map((_, i) => i + 1),
    )
  })

  it('cada linha tem período coerente: fim não antecede o início', () => {
    for (const l of generateSchedule(base)) {
      expect(l.period_end >= l.period_start).toBe(true)
    }
  })

  it('os períodos não se sobrepõem e avançam no tempo', () => {
    const linhas = generateSchedule(base)
    for (let i = 1; i < linhas.length; i++) {
      expect(linhas[i]!.period_start >= linhas[i - 1]!.period_start).toBe(true)
      expect(linhas[i]!.due_date > linhas[i - 1]!.due_date).toBe(true)
    }
  })

  it('sem pro rata, todas as parcelas têm o valor do ciclo', () => {
    for (const l of generateSchedule(base)) {
      expect(l.amount).toBe(250)
    }
  })

  it('com pro rata, a primeira parcela pode ser proporcional', () => {
    const linhas = generateSchedule({ ...base, use_pro_rata: true })
    expect(linhas[0]!.amount).toBeLessThanOrEqual(250)
  })

  it('cobre o ciclo mensal', () => {
    const linhas = generateSchedule({
      ...base,
      cycle: 'monthly',
      due_day: 10,
      start_date: '2026-01-01',
      end_date: '2026-06-30',
    })
    expect(linhas.length).toBeGreaterThanOrEqual(5)
  })

  it('fim anterior ao início não gera cronograma', () => {
    expect(generateSchedule({ ...base, start_date: '2026-08-29', end_date: '2026-08-01' })).toEqual([])
  })

  it('é determinístico: mesma entrada, mesma saída', () => {
    expect(generateSchedule(base)).toEqual(generateSchedule(base))
  })
})

describe('selectIssuableLines', () => {
  it('emite apenas o que já começou', () => {
    const linhas = [
      line('2026-08-01', 'scheduled'),
      line('2026-08-08', 'scheduled'),
      line('2026-08-12', 'scheduled'),  // começa hoje: entra
      line('2026-08-19', 'scheduled'),  // futuro: fica
    ]
    const emitir = selectIssuableLines(linhas, HOJE)
    expect(emitir).toHaveLength(3)
    expect(emitir.every((l) => l.period_start <= '2026-08-12')).toBe(true)
  })

  it('ignora linha já emitida — é o que torna o job idempotente', () => {
    const linhas = [
      line('2026-08-01', 'issued'),
      line('2026-08-08', 'scheduled'),
    ]
    expect(selectIssuableLines(linhas, HOJE)).toHaveLength(1)
  })

  it('ignora linha cancelada ou substituída', () => {
    const linhas = [
      line('2026-08-01', 'cancelled'),
      line('2026-08-01', 'superseded'),
    ]
    expect(selectIssuableLines(linhas, HOJE)).toHaveLength(0)
  })

  it('lead time antecipa a emissão', () => {
    const linhas = [line('2026-08-19', 'scheduled')]
    expect(selectIssuableLines(linhas, HOJE, 0)).toHaveLength(0)
    expect(selectIssuableLines(linhas, HOJE, 7)).toHaveLength(1)
  })

  it('rodar duas vezes seguidas não muda o conjunto', () => {
    const linhas = [line('2026-08-01', 'scheduled'), line('2026-09-01', 'scheduled')]
    expect(selectIssuableLines(linhas, HOJE)).toEqual(selectIssuableLines(linhas, HOJE))
  })
})

describe('selectAdjustableLines — Princípio 5', () => {
  it('reajusta apenas linhas ainda não emitidas', () => {
    const linhas = [
      line('2026-07-01', 'issued'),
      line('2026-08-01', 'issued'),
      line('2026-09-01', 'scheduled'),
      line('2026-10-01', 'scheduled'),
    ]
    const ajustaveis = selectAdjustableLines(linhas, '2026-01-01')
    expect(ajustaveis).toHaveLength(2)
    expect(ajustaveis.every((l) => l.status === 'scheduled')).toBe(true)
  })

  it('respeita a data de vigência do reajuste', () => {
    const linhas = [
      line('2026-09-01', 'scheduled'),
      line('2026-10-01', 'scheduled'),
    ]
    expect(selectAdjustableLines(linhas, '2026-10-01')).toHaveLength(1)
  })

  it('período já emitido NUNCA é ajustável, mesmo dentro da vigência', () => {
    const linhas = [line('2026-12-01', 'issued')]
    expect(selectAdjustableLines(linhas, '2026-01-01')).toHaveLength(0)
  })
})

describe('contractedBacklog — separa carteira de contas a receber (F-10)', () => {
  it('soma apenas o que ainda não virou documento', () => {
    const linhas = [
      line('2026-07-01', 'issued', 250),
      line('2026-08-01', 'issued', 250),
      line('2026-09-01', 'scheduled', 250),
      line('2026-10-01', 'scheduled', 250),
    ]
    // Carteira contratada = 500. Contas a receber vem de charge_balances,
    // e olha só as duas emitidas.
    expect(contractedBacklog(linhas)).toBe(500)
  })

  it('cronograma inteiramente emitido tem carteira zero', () => {
    expect(contractedBacklog([line('2026-07-01', 'issued', 250)])).toBe(0)
  })

  it('ignora linhas canceladas', () => {
    const linhas = [line('2026-09-01', 'cancelled', 250), line('2026-10-01', 'scheduled', 250)]
    expect(contractedBacklog(linhas)).toBe(250)
  })

  it('contrato de 2 anos semanal: a carteira é grande, mas não é recebível', () => {
    const linhas = Array.from({ length: 104 }, (_, i) =>
      line(`2026-${String((i % 12) + 1).padStart(2, '0')}-01`, 'scheduled', 250),
    )
    // No modelo antigo, esses R$ 26.000 entravam em "Total a receber" no dia
    // da assinatura.
    expect(contractedBacklog(linhas)).toBe(26_000)
  })
})

describe('data impossível não vira cronograma', () => {
  // `<input type="date">` aceita ano de cinco dígitos, e digitar no segmento do
  // ano com algo já preenchido produz esse estado sem esforço. `parseIsoDate`
  // devolvia Invalid Date em silêncio; como comparação com NaN é sempre falsa,
  // o `if (end <= start) return []` não barrava, e saía uma linha com
  // `due_date: "NaN-NaN-NaN"`.
  //
  // Na tela isso derrubava a página inteira (o formatador lança RangeError);
  // na gravação, iria para uma coluna `date`. E como a função RETORNA lixo em
  // vez de lançar, o `try/catch` de quem chama não protegia de nada.
  const base = {
    cycle: 'monthly' as const, due_day: 10, cycle_amount: 750, use_pro_rata: true,
  }

  it('ano de cinco dígitos no início devolve lista vazia', () => {
    expect(generateSchedule({ ...base, start_date: '82026-12-16', end_date: '82027-03-16' })).toEqual([])
  })

  it('ano de cinco dígitos no fim devolve lista vazia', () => {
    expect(generateSchedule({ ...base, start_date: '2026-08-16', end_date: '82026-11-16' })).toEqual([])
  })

  it('data vazia ou sem sentido devolve lista vazia', () => {
    expect(generateSchedule({ ...base, start_date: '', end_date: '2026-11-16' })).toEqual([])
    expect(generateSchedule({ ...base, start_date: '2026-08-16', end_date: 'abc' })).toEqual([])
    expect(generateSchedule({ ...base, start_date: '2026-02-30', end_date: '2026-11-16' })).toEqual([])
  })

  it('nenhuma linha válida carrega data não parseável', () => {
    const linhas = generateSchedule({ ...base, start_date: '2026-08-16', end_date: '2026-11-16' })
    expect(linhas.length).toBeGreaterThan(0)
    for (const l of linhas) {
      expect(l.due_date, 'due_date fora do formato ISO').toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(new Date(`${l.due_date}T00:00:00`).getTime())).toBe(false)
    }
  })
})
