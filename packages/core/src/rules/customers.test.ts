import { describe, expect, it } from 'vitest'
import { identifyCustomersWithMultipleOverdueCharges } from './customers'

describe('identifyCustomersWithMultipleOverdueCharges', () => {
  it('retorna apenas clientes com 2+ cobranças vencidas', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a' },
      { customer_id: 'a' },
      { customer_id: 'b' },
      { customer_id: 'c' },
      { customer_id: 'c' },
      { customer_id: 'c' },
    ])
    expect(result.sort()).toEqual(['a', 'c'])
  })

  it('cliente com uma única cobrança vencida não entra no alerta', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a' },
      { customer_id: 'b' },
    ])
    expect(result).toEqual([])
  })

  it('lista vazia não quebra', () => {
    expect(identifyCustomersWithMultipleOverdueCharges([])).toEqual([])
  })

  it('threshold customizado', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a' },
      { customer_id: 'b' },
      { customer_id: 'b' },
      { customer_id: 'b' },
    ], 3)
    expect(result).toEqual(['b'])
  })
})
