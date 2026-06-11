import { describe, expect, it } from 'vitest'
import {
  CONTRACT_MINIMUM_DURATION,
  CONTRACT_TERMINATION_FINE_BRL,
  addMonths,
  addYears,
  calculateExpectedEndDate,
  calculateMinimumEndDate,
  getContractValidityLevel,
  isTerminationWithinMinimum,
  parseIsoDate,
} from './contracts'

describe('addMonths / addYears', () => {
  it('soma meses preservando o dia', () => {
    expect(addMonths(new Date('2026-01-15T00:00:00'), 3)).toEqual(new Date('2026-04-15T00:00:00'))
  })

  it('soma anos preservando o dia', () => {
    expect(addYears(new Date('2026-01-15T00:00:00'), 2)).toEqual(new Date('2028-01-15T00:00:00'))
  })
})

describe('parseIsoDate', () => {
  it('cria Date local sem deslocamento de fuso', () => {
    const d = parseIsoDate('2026-06-10')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(10)
  })
})

describe('CONTRACT_MINIMUM_DURATION', () => {
  it('expõe constantes alinhadas com o produto', () => {
    expect(CONTRACT_MINIMUM_DURATION.rental.months).toBe(3)
    expect(CONTRACT_MINIMUM_DURATION.loyalty.years).toBe(2)
    expect(CONTRACT_TERMINATION_FINE_BRL).toBe(1000)
  })
})

describe('calculateMinimumEndDate', () => {
  it('rental → start + 3 meses', () => {
    expect(calculateMinimumEndDate('2026-01-15', 'rental')).toEqual(new Date('2026-04-15T00:00:00'))
  })

  it('loyalty → start + 2 anos', () => {
    expect(calculateMinimumEndDate('2026-01-15', 'loyalty')).toEqual(new Date('2028-01-15T00:00:00'))
  })

  it('default é rental quando contract_type não é informado', () => {
    expect(calculateMinimumEndDate('2026-01-15')).toEqual(new Date('2026-04-15T00:00:00'))
  })
})

describe('calculateExpectedEndDate', () => {
  it('loyalty ignora end_date manual e usa start + 2 anos', () => {
    expect(calculateExpectedEndDate({
      status: 'active',
      start_date: '2026-01-15',
      end_date: '2027-12-31',
      contract_type: 'loyalty',
    })).toEqual(new Date('2028-01-15T00:00:00'))
  })

  it('rental usa o end_date informado', () => {
    expect(calculateExpectedEndDate({
      status: 'active',
      start_date: '2026-01-15',
      end_date: '2026-09-30',
      contract_type: 'rental',
    })).toEqual(new Date('2026-09-30T00:00:00'))
  })

  it('rental sem end_date retorna null', () => {
    expect(calculateExpectedEndDate({
      status: 'active',
      start_date: '2026-01-15',
      contract_type: 'rental',
    })).toBeNull()
  })
})

describe('getContractValidityLevel', () => {
  it('retorna null quando o contrato não está ativo', () => {
    expect(getContractValidityLevel({
      status: 'closed',
      start_date: '2026-01-15',
      end_date: '2026-12-31',
    })).toBeNull()
  })

  it('red quando hoje passou da end_date do contrato', () => {
    expect(getContractValidityLevel({
      status: 'active',
      start_date: '2025-01-15',
      end_date: '2026-01-01',
    }, new Date('2026-06-10T12:00:00'))).toBe('red')
  })

  it('orange quando hoje ainda está dentro da vigência mínima (rental)', () => {
    expect(getContractValidityLevel({
      status: 'active',
      start_date: '2026-05-01',
      contract_type: 'rental',
    }, new Date('2026-06-10T12:00:00'))).toBe('orange')
  })

  it('green após cumprir a vigência mínima (rental)', () => {
    expect(getContractValidityLevel({
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      contract_type: 'rental',
    }, new Date('2026-06-10T12:00:00'))).toBe('green')
  })

  it('orange em contrato loyalty antes dos 2 anos', () => {
    expect(getContractValidityLevel({
      status: 'active',
      start_date: '2025-01-15',
      contract_type: 'loyalty',
    }, new Date('2026-06-10T12:00:00'))).toBe('orange')
  })
})

describe('isTerminationWithinMinimum', () => {
  it('true quando hoje está antes da data mínima', () => {
    expect(isTerminationWithinMinimum(
      { start_date: '2026-05-01', contract_type: 'rental' },
      new Date('2026-06-10T12:00:00'),
    )).toBe(true)
  })

  it('false quando vigência mínima já foi cumprida', () => {
    expect(isTerminationWithinMinimum(
      { start_date: '2026-01-01', contract_type: 'rental' },
      new Date('2026-06-10T12:00:00'),
    )).toBe(false)
  })
})
