import { describe, it, expect } from 'vitest'
import { calcFineUrgency, isDriverUnidentified } from './fines'

describe('calcFineUrgency', () => {
  const today = new Date(2026, 7, 10) // 2026-08-10

  it('multa paga sempre retorna paid, independente dos prazos', () => {
    expect(calcFineUrgency({ status: 'paid', due_date: '2020-01-01' }, today)).toBe('paid')
  })

  it('sem nenhum prazo informado retorna pending', () => {
    expect(calcFineUrgency({ status: 'pending' }, today)).toBe('pending')
  })

  it('prazo mais próximo já vencido retorna overdue, mesmo com due_date distante', () => {
    expect(calcFineUrgency({
      status: 'pending',
      due_date: '2026-12-01',
      driver_identification_deadline: '2026-08-01',
    }, today)).toBe('overdue')
  })

  it('prazo mais próximo dentro de 7 dias retorna due_soon', () => {
    expect(calcFineUrgency({
      status: 'pending',
      appeal_deadline: '2026-08-15',
    }, today)).toBe('due_soon')
  })

  it('prazo mais próximo além de 7 dias retorna pending', () => {
    expect(calcFineUrgency({
      status: 'pending',
      discounted_payment_deadline: '2026-09-01',
    }, today)).toBe('pending')
  })

  it('usa o prazo mais próximo entre vários informados', () => {
    expect(calcFineUrgency({
      status: 'pending',
      due_date: '2026-11-01',
      prior_defense_deadline: '2026-10-01',
      appeal_deadline: '2026-08-12',
    }, today)).toBe('due_soon')
  })
})

describe('isDriverUnidentified', () => {
  it('sem prazo de identificação de condutor, nunca é considerado não identificado', () => {
    expect(isDriverUnidentified({}, [])).toBe(false)
  })

  it('com prazo e sem nenhum sinal de condutor, retorna true', () => {
    expect(isDriverUnidentified({ driver_identification_deadline: '2026-09-01' }, [])).toBe(true)
  })

  it('com prazo e condutor já documentado na NA/NP, retorna false', () => {
    expect(isDriverUnidentified({
      driver_identification_deadline: '2026-09-01',
      driver_cpf: '12345678901',
    }, [])).toBe(false)
  })

  it('com prazo e anexo de indicação de condutor já registrado, retorna false', () => {
    expect(isDriverUnidentified(
      { driver_identification_deadline: '2026-09-01' },
      [{ type: 'driver_indication' }],
    )).toBe(false)
  })

  it('anexo de outro tipo não resolve a pendência', () => {
    expect(isDriverUnidentified(
      { driver_identification_deadline: '2026-09-01' },
      [{ type: 'ait' }, { type: 'payment_receipt' }],
    )).toBe(true)
  })
})
