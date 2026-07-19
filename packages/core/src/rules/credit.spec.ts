import { describe, it, expect } from 'vitest'
import { validateCreditApplication } from './credit'

describe('validateCreditApplication', () => {
  // CA-030: aplicação válida
  it('CA-030: abatimento dentro do saldo e dentro do valor da cobrança → ok', () => {
    expect(validateCreditApplication(100, 300, 100)).toEqual({ ok: true })
  })

  it('abatimento parcial válido', () => {
    expect(validateCreditApplication(200, 500, 150)).toEqual({ ok: true })
  })

  // CA-031 / RN-020: abatimento > saldo
  it('CA-031: abatimento > saldo → OVER_BALANCE', () => {
    const result = validateCreditApplication(50, 300, 80)
    expect(result).toEqual({ ok: false, errorCode: 'OVER_BALANCE' })
  })

  // CA-032 / RN-021: abatimento > valor da cobrança
  it('CA-032: abatimento > valor da cobrança → OVER_BILLING', () => {
    const result = validateCreditApplication(100, 30, 50)
    expect(result).toEqual({ ok: false, errorCode: 'OVER_BILLING' })
  })

  // OVER_BALANCE tem prioridade sobre OVER_BILLING quando ambos falham
  it('OVER_BALANCE tem prioridade quando ambas as condições falham', () => {
    // saldo=10, cobrança=5, pedido=20: supera saldo E cobrança
    const result = validateCreditApplication(10, 5, 20)
    expect(result).toEqual({ ok: false, errorCode: 'OVER_BALANCE' })
  })

  // Abatimento exato no limite do saldo
  it('abatimento = saldo disponível → ok', () => {
    expect(validateCreditApplication(100, 200, 100)).toEqual({ ok: true })
  })

  // Abatimento exato no limite do valor da cobrança
  it('abatimento = valor da cobrança → ok', () => {
    expect(validateCreditApplication(500, 200, 200)).toEqual({ ok: true })
  })

  // RN-022: valor base imutável (responsabilidade da camada de persistência, não desta função)
  // A função apenas valida — não modifica nenhum valor
  it('RN-022: função não modifica os valores informados', () => {
    let balance = 100
    let amountDue = 300
    validateCreditApplication(balance, amountDue, 50)
    expect(balance).toBe(100)
    expect(amountDue).toBe(300)
  })
})
