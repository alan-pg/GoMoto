import { describe, expect, it } from 'vitest'
import { effectiveStatus, nextObligationDue, summarizeDocumentation, suggestDueDate } from './documentation'

const TODAY = new Date('2026-06-17T12:00:00')

function obligation(over: { id?: string; status: 'pending' | 'paid' | 'overdue' | 'exempt' | 'cancelled'; due_date: string; amount?: number }) {
  return {
    id: over.id ?? 'o1',
    status: over.status,
    due_date: over.due_date,
    amount: over.amount ?? 100,
  }
}

describe('effectiveStatus', () => {
  it('mantém paid intocado', () => {
    expect(effectiveStatus({ status: 'paid', due_date: '2026-01-01' }, TODAY)).toBe('paid')
  })

  it('mantém exempt e cancelled intocados mesmo com due_date no passado', () => {
    expect(effectiveStatus({ status: 'exempt', due_date: '2024-01-01' }, TODAY)).toBe('exempt')
    expect(effectiveStatus({ status: 'cancelled', due_date: '2024-01-01' }, TODAY)).toBe('cancelled')
  })

  it('pending com due_date futuro continua pending', () => {
    expect(effectiveStatus({ status: 'pending', due_date: '2026-12-31' }, TODAY)).toBe('pending')
  })

  it('pending com due_date no passado vira overdue', () => {
    expect(effectiveStatus({ status: 'pending', due_date: '2026-04-10' }, TODAY)).toBe('overdue')
  })

  it('pending vencendo hoje ainda é pending (today === due)', () => {
    expect(effectiveStatus({ status: 'pending', due_date: '2026-06-17' }, TODAY)).toBe('pending')
  })
})

describe('summarizeDocumentation', () => {
  it('lista vazia → ok, zerado', () => {
    const s = summarizeDocumentation([], TODAY)
    expect(s.status).toBe('ok')
    expect(s.totalDue).toBe(0)
    expect(s.nextDueDate).toBeNull()
  })

  it('tudo pago → ok', () => {
    const s = summarizeDocumentation(
      [obligation({ status: 'paid', due_date: '2026-04-10' })],
      TODAY,
    )
    expect(s.status).toBe('ok')
    expect(s.totalDue).toBe(0)
  })

  it('1 overdue + 1 paid → overdue', () => {
    const s = summarizeDocumentation(
      [
        obligation({ id: 'a', status: 'pending', due_date: '2026-04-10', amount: 115 }),
        obligation({ id: 'b', status: 'paid', due_date: '2026-04-10', amount: 200 }),
      ],
      TODAY,
    )
    expect(s.status).toBe('overdue')
    expect(s.overdueCount).toBe(1)
    expect(s.totalDue).toBe(115)
  })

  it('1 due_soon (dentro de 30 dias) → due_soon', () => {
    const s = summarizeDocumentation(
      [obligation({ status: 'pending', due_date: '2026-07-01', amount: 98.91 })],
      TODAY,
    )
    expect(s.status).toBe('due_soon')
    expect(s.dueSoonCount).toBe(1)
    expect(s.totalDue).toBeCloseTo(98.91)
  })

  it('1 pending distante (>30 dias) → pending', () => {
    const s = summarizeDocumentation(
      [obligation({ status: 'pending', due_date: '2026-09-30' })],
      TODAY,
    )
    expect(s.status).toBe('pending')
    expect(s.pendingCount).toBe(1)
  })

  it('overdue ofusca due_soon e pending', () => {
    const s = summarizeDocumentation(
      [
        obligation({ id: 'past', status: 'pending', due_date: '2026-05-01' }),
        obligation({ id: 'soon', status: 'pending', due_date: '2026-07-01' }),
        obligation({ id: 'far', status: 'pending', due_date: '2026-12-30' }),
      ],
      TODAY,
    )
    expect(s.status).toBe('overdue')
    expect(s.overdueCount).toBe(1)
    expect(s.dueSoonCount).toBe(1)
    expect(s.pendingCount).toBe(1)
  })

  it('dueSoonDays customizado expande a janela', () => {
    const s = summarizeDocumentation(
      [obligation({ status: 'pending', due_date: '2026-09-30' })],
      TODAY,
      { dueSoonDays: 180 },
    )
    expect(s.status).toBe('due_soon')
  })

  it('nextDueDate aponta a obrigação aberta mais antiga', () => {
    const s = summarizeDocumentation(
      [
        obligation({ id: 'a', status: 'pending', due_date: '2026-12-30' }),
        obligation({ id: 'b', status: 'pending', due_date: '2026-07-15' }),
        obligation({ id: 'c', status: 'paid', due_date: '2026-04-01' }),
      ],
      TODAY,
    )
    expect(s.nextDueDate).toBe('2026-07-15')
    expect(s.nextDueObligationId).toBe('b')
  })
})

describe('nextObligationDue', () => {
  it('retorna null se nada está em aberto', () => {
    const result = nextObligationDue(
      [obligation({ status: 'paid', due_date: '2026-04-10' })],
      TODAY,
    )
    expect(result).toBeNull()
  })

  it('retorna a obrigação aberta com menor due_date', () => {
    const obs = [
      obligation({ id: 'a', status: 'pending', due_date: '2026-09-30' }),
      obligation({ id: 'b', status: 'pending', due_date: '2026-07-15' }),
      obligation({ id: 'c', status: 'paid', due_date: '2026-01-01' }),
    ]
    expect(nextObligationDue(obs, TODAY)?.id).toBe('b')
  })
})

describe('suggestDueDate', () => {
  it('IPVA sugere 10 de abril do ano', () => {
    expect(suggestDueDate('ipva', 2027)).toBe('2027-04-10')
  })

  it('licenciamento sugere 30 de setembro', () => {
    expect(suggestDueDate('licensing', 2027)).toBe('2027-09-30')
  })

  it('DPVAT sugere 31 de janeiro', () => {
    expect(suggestDueDate('dpvat', 2027)).toBe('2027-01-31')
  })

  it('tipos sem heurística usam 31 de dezembro', () => {
    expect(suggestDueDate('insurance', 2027)).toBe('2027-12-31')
    expect(suggestDueDate('other', 2027)).toBe('2027-12-31')
  })
})
