import { describe, it, expect } from 'vitest'
import {
  applyPlateMask, stripPlate,
  applyRenavamMask, formatRenavam,
  applyCpfMask, applyCnpjMask,
  formatDocument, stripDocument,
  formatIMEI, stripIMEI,
  applyCurrencyMask, stripCurrencyInput, formatCurrencyInput,
} from './masks'

// ── Plate ────────────────────────────────────────────────────────────────────

describe('applyPlateMask', () => {
  it('old format: 3 letters + 4 digits → adds dash', () => {
    expect(applyPlateMask('ABC1234')).toBe('ABC-1234')
  })
  it('Mercosul: 3 letters + digit + letter + 2 digits → no dash', () => {
    expect(applyPlateMask('ABC1D23')).toBe('ABC1D23')
  })
  it('lowercases are accepted and uppercased', () => {
    expect(applyPlateMask('abc1234')).toBe('ABC-1234')
    expect(applyPlateMask('abc1d23')).toBe('ABC1D23')
  })
  it('partial input: fewer than 7 chars', () => {
    expect(applyPlateMask('AB')).toBe('AB')
    expect(applyPlateMask('ABC')).toBe('ABC')
    expect(applyPlateMask('ABC1')).toBe('ABC1')
  })
  it('skips digit in letter positions', () => {
    expect(applyPlateMask('1BC1234')).toBe('BC')  // 1 skipped, then BC allowed
  })
  it('skips letter in digit positions 5-6', () => {
    expect(applyPlateMask('ABC1D2X')).toBe('ABC1D2')  // X skipped
  })
  it('strips dash from existing plate and re-formats', () => {
    expect(applyPlateMask('ABC-1234')).toBe('ABC-1234')
  })
})

describe('stripPlate', () => {
  it('removes dash and uppercases', () => {
    expect(stripPlate('ABC-1234')).toBe('ABC1234')
    expect(stripPlate('abc1d23')).toBe('ABC1D23')
  })
})

// ── RENAVAM ───────────────────────────────────────────────────────────────────

describe('applyRenavamMask', () => {
  it('allows only digits up to 11', () => {
    expect(applyRenavamMask('01234567890')).toBe('01234567890')
    expect(applyRenavamMask('abc01234567890xyz')).toBe('01234567890')
  })
  it('truncates to 11 digits', () => {
    expect(applyRenavamMask('012345678901234')).toBe('01234567890')
  })
})

describe('formatRenavam', () => {
  it('formats 11-digit RENAVAM for display', () => {
    expect(formatRenavam('01234567890')).toBe('012.345.678-90')
  })
  it('formats 9-digit RENAVAM for display', () => {
    expect(formatRenavam('012345678')).toBe('0.123.456-78')
  })
  it('returns partial input unchanged', () => {
    expect(formatRenavam('1234')).toBe('1234')
  })
})

// ── CPF ─���────────────���─────────────────────────────���──────────────────────────

describe('applyCpfMask', () => {
  it('builds mask progressively', () => {
    expect(applyCpfMask('1')).toBe('1')
    expect(applyCpfMask('123')).toBe('123')
    expect(applyCpfMask('1234')).toBe('123.4')
    expect(applyCpfMask('123456')).toBe('123.456')
    expect(applyCpfMask('1234567')).toBe('123.456.7')
    expect(applyCpfMask('123456789')).toBe('123.456.789')
    expect(applyCpfMask('1234567890')).toBe('123.456.789-0')
    expect(applyCpfMask('12345678901')).toBe('123.456.789-01')
  })
  it('strips non-digit input', () => {
    expect(applyCpfMask('abc123def')).toBe('123')
  })
  it('ignores digits beyond 11', () => {
    expect(applyCpfMask('123456789012')).toBe('123.456.789-01')
  })
  it('re-masks already-masked input correctly', () => {
    expect(applyCpfMask('123.456.789-01')).toBe('123.456.789-01')
  })
})

// ── CNPJ ──────────────────────────────────────────────────────────────────────

describe('applyCnpjMask', () => {
  it('builds mask progressively', () => {
    expect(applyCnpjMask('12')).toBe('12')
    expect(applyCnpjMask('123')).toBe('12.3')
    expect(applyCnpjMask('12345678')).toBe('12.345.678')
    expect(applyCnpjMask('123456780001')).toBe('12.345.678/0001')
    expect(applyCnpjMask('12345678000195')).toBe('12.345.678/0001-95')
  })
  it('re-masks already-masked CNPJ', () => {
    expect(applyCnpjMask('12.345.678/0001-95')).toBe('12.345.678/0001-95')
  })
})

describe('formatDocument', () => {
  it('formats 11-digit stored value as CPF', () => {
    expect(formatDocument('12345678901')).toBe('123.456.789-01')
  })
  it('formats 14-digit stored value as CNPJ', () => {
    expect(formatDocument('12345678000195')).toBe('12.345.678/0001-95')
  })
  it('returns partial as-is', () => {
    expect(formatDocument('1234')).toBe('1234')
  })
})

describe('stripDocument', () => {
  it('strips CPF mask', () => {
    expect(stripDocument('123.456.789-01')).toBe('12345678901')
  })
  it('strips CNPJ mask', () => {
    expect(stripDocument('12.345.678/0001-95')).toBe('12345678000195')
  })
})

// ── IMEI ──────────────────────────────────────────────────────────────────────

describe('formatIMEI', () => {
  it('formats 15 digits as 999999-99-999999-9', () => {
    expect(formatIMEI('123456789012345')).toBe('123456-78-901234-5')
  })
  it('returns non-15-digit input unchanged', () => {
    expect(formatIMEI('12345')).toBe('12345')
  })
})

describe('stripIMEI', () => {
  it('removes dashes', () => {
    expect(stripIMEI('123456-78-901234-5')).toBe('123456789012345')
  })
})

// ── Currency ──────────────────────────────────────────────────────────────────

describe('applyCurrencyMask', () => {
  it('formats integer with thousand separator', () => {
    expect(applyCurrencyMask('1500')).toBe('1.500')
  })
  it('preserves comma and decimal digits', () => {
    expect(applyCurrencyMask('1500,')).toBe('1.500,')
    expect(applyCurrencyMask('1500,5')).toBe('1.500,5')
    expect(applyCurrencyMask('1500,50')).toBe('1.500,50')
  })
  it('strips non-digit/comma chars', () => {
    expect(applyCurrencyMask('R$ 1.500,50')).toBe('1.500,50')
  })
  it('limits decimal to 2 digits', () => {
    expect(applyCurrencyMask('100,999')).toBe('100,99')
  })
  it('returns empty for empty input', () => {
    expect(applyCurrencyMask('')).toBe('')
  })
  it('handles already-masked value (editing scenario)', () => {
    expect(applyCurrencyMask('1.500,50')).toBe('1.500,50')
  })
})

describe('stripCurrencyInput', () => {
  it('converts masked value to parseable decimal', () => {
    expect(stripCurrencyInput('1.500,50')).toBe('1500.50')
    expect(stripCurrencyInput('1500')).toBe('1500')
    expect(stripCurrencyInput('')).toBe('')
  })
})

describe('formatCurrencyInput', () => {
  it('converts JS float string to pt-BR display format', () => {
    expect(formatCurrencyInput('1500.5')).toBe('1.500,50')
    expect(formatCurrencyInput('1500.50')).toBe('1.500,50')
  })
  it('converts comma-decimal string', () => {
    expect(formatCurrencyInput('1500,50')).toBe('1.500,50')
  })
  it('re-formats already-masked value', () => {
    expect(formatCurrencyInput('1.500,50')).toBe('1.500,50')
  })
  it('returns empty for empty input', () => {
    expect(formatCurrencyInput('')).toBe('')
  })
})
