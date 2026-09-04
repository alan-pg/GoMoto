import { describe, it, expect } from 'vitest'
import {
  splitResponsibility,
  splitByPercentage,
  resolveReimbursement,
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

describe('resolveReimbursement', () => {
  /**
   * Quem executou desembolsou o total. O reembolso é sempre a parte do OUTRO:
   *
   *   - empresa executou → cobra do cliente a parte DELE
   *   - cliente executou → a empresa lhe deve a parte DELA
   *
   * A versão anterior devolvia só o modo e usava `customer_amount` nos dois
   * casos, o que invertia o segundo.
   */
  it('empresa executa e cliente participa: cobra a parte do cliente', () => {
    const split = splitResponsibility(1000, 'shared', 400)
    expect(resolveReimbursement(split, 'company')).toEqual({ mode: 'charge', amount: 400 })
  })

  it('cliente executa e empresa participa: credita a parte da EMPRESA', () => {
    const split = splitResponsibility(1000, 'shared', 400)
    // 600, não 400: o cliente pagou os 1000 e devia só 400.
    expect(resolveReimbursement(split, 'customer')).toEqual({ mode: 'credit', amount: 600 })
  })

  it('cliente executa custo 100% da empresa: credita o total', () => {
    // O caso mais comum, e o que quebrava em silêncio: `customer_amount` é
    // zero, a regra antiga devolvia 'none' e ninguém era ressarcido.
    const split = splitResponsibility(300, 'company')
    expect(resolveReimbursement(split, 'customer')).toEqual({ mode: 'credit', amount: 300 })
  })

  it('empresa executa custo 100% dela: nada a reembolsar', () => {
    const split = splitResponsibility(300, 'company')
    expect(resolveReimbursement(split, 'company')).toEqual({ mode: 'none', amount: 0 })
  })

  it('cliente executa custo 100% dele: nada a reembolsar', () => {
    // Ele pagou o que devia. Creditar aqui seria devolver dinheiro do nada.
    const split = splitResponsibility(300, 'customer', 300)
    expect(resolveReimbursement(split, 'customer')).toEqual({ mode: 'none', amount: 0 })
  })

  it('empresa executa custo 100% do cliente: cobra o total', () => {
    const split = splitResponsibility(300, 'customer', 300)
    expect(resolveReimbursement(split, 'company')).toEqual({ mode: 'charge', amount: 300 })
  })
})
