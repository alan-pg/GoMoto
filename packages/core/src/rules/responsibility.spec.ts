import { describe, it, expect } from 'vitest'
import {
  splitResponsibility,
  splitByPercentage,
  resolveReimbursementMode,
} from './responsibility'

describe('splitResponsibility', () => {
  it('empresa assume tudo', () => {
    expect(splitResponsibility(1000, 'company')).toEqual({
      responsibility: 'company', company_amount: 1000, customer_amount: 0,
    })
  })

  it('cliente assume tudo', () => {
    expect(splitResponsibility(1000, 'customer', 1000)).toEqual({
      responsibility: 'customer', company_amount: 0, customer_amount: 1000,
    })
  })

  it('rateio 60/40 fecha exatamente', () => {
    const s = splitResponsibility(1000, 'shared', 400)
    expect(s.company_amount).toBe(600)
    expect(s.customer_amount).toBe(400)
    expect(s.company_amount + s.customer_amount).toBe(1000)
  })

  it('empresa com parte do cliente é rejeitado', () => {
    expect(() => splitResponsibility(1000, 'company', 400)).toThrow(/não admite parte do cliente/)
  })

  it('cliente com parte menor que o total é rejeitado', () => {
    expect(() => splitResponsibility(1000, 'customer', 400)).toThrow(/exige parte igual ao total/)
  })

  it('compartilhado com zero ou com o total é rejeitado', () => {
    expect(() => splitResponsibility(1000, 'shared', 0)).toThrow(/entre zero e o total/)
    expect(() => splitResponsibility(1000, 'shared', 1000)).toThrow(/entre zero e o total/)
  })

  it('parte do cliente maior que o total é rejeitada', () => {
    expect(() => splitResponsibility(1000, 'shared', 1500)).toThrow(/excede o total/)
  })

  it('parte negativa é rejeitada', () => {
    expect(() => splitResponsibility(1000, 'shared', -100)).toThrow(/não pode ser negativa/)
  })

  it('valor não positivo é rejeitado', () => {
    expect(() => splitResponsibility(0, 'company')).toThrow(/positivo/)
  })
})

describe('splitByPercentage — o caso que o percentual inteiro não resolvia (F-17)', () => {
  it('1/3 de 1000 fecha exatamente, sem centavo perdido', () => {
    const s = splitByPercentage(1000, 1 / 3)
    expect(s.customer_amount).toBe(333.33)
    expect(s.company_amount).toBe(666.67)
    expect(s.company_amount + s.customer_amount).toBe(1000)
  })

  it('o resto de arredondamento fica com a EMPRESA, nunca com o cliente', () => {
    const s = splitByPercentage(1000, 1 / 3)
    // 1000/3 = 333.333... → cliente paga 333.33 (para baixo), empresa absorve o resto
    expect(s.customer_amount).toBeLessThan(1000 / 3)
    expect(s.company_amount).toBeGreaterThan(1000 / 3)
  })

  it('meio a meio', () => {
    const s = splitByPercentage(1000, 0.5)
    expect(s.customer_amount).toBe(500)
    expect(s.company_amount).toBe(500)
  })

  it('0% vira responsabilidade da empresa', () => {
    expect(splitByPercentage(1000, 0).responsibility).toBe('company')
  })

  it('100% vira responsabilidade do cliente', () => {
    expect(splitByPercentage(1000, 1).responsibility).toBe('customer')
  })

  it('valor com centavo ímpar continua fechando', () => {
    const s = splitByPercentage(333.33, 0.5)
    expect(s.company_amount + s.customer_amount).toBe(333.33)
  })

  it('percentual fora de 0..1 é rejeitado', () => {
    expect(() => splitByPercentage(1000, 1.5)).toThrow(/entre 0 e 1/)
    expect(() => splitByPercentage(1000, -0.1)).toThrow(/entre 0 e 1/)
  })

  it.each([
    [1000, 1 / 3],
    [1000, 2 / 3],
    [999.99, 0.5],
    [100, 0.07],
    [1234.56, 0.37],
  ])('soma fecha para %s com %s do cliente', (total, pct) => {
    const s = splitByPercentage(total, pct)
    expect(s.company_amount + s.customer_amount).toBeCloseTo(total, 2)
  })
})

describe('resolveReimbursementMode', () => {
  it('empresa executa e cliente participa: vira cobrança', () => {
    const split = splitResponsibility(1000, 'shared', 400)
    expect(resolveReimbursementMode(split, 'company')).toBe('charge')
  })

  it('cliente executa e empresa participa: vira crédito', () => {
    const split = splitResponsibility(1000, 'shared', 400)
    expect(resolveReimbursementMode(split, 'customer')).toBe('credit')
  })

  it('sem parte do cliente, não há reembolso', () => {
    const split = splitResponsibility(1000, 'company')
    expect(resolveReimbursementMode(split, 'company')).toBe('none')
    expect(resolveReimbursementMode(split, 'customer')).toBe('none')
  })
})
