import { describe, expect, it } from 'vitest'
import { identifyCustomersWithMultipleOverdueCharges } from './customers'

describe('identifyCustomersWithMultipleOverdueCharges', () => {
  it('retorna apenas clientes com 2+ cobranças vencidas', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a', status: 'overdue' },
      { customer_id: 'a', status: 'overdue' },
      { customer_id: 'b', status: 'overdue' },
      { customer_id: 'c', status: 'overdue' },
      { customer_id: 'c', status: 'overdue' },
      { customer_id: 'c', status: 'overdue' },
    ])
    expect(result.sort()).toEqual(['a', 'c'])
  })

  it('ignora charges com status diferente de overdue', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a', status: 'paid' },
      { customer_id: 'a', status: 'pending' },
    ])
    expect(result).toEqual([])
  })

  it('threshold customizado', () => {
    const result = identifyCustomersWithMultipleOverdueCharges([
      { customer_id: 'a', status: 'overdue' },
      { customer_id: 'b', status: 'overdue' },
      { customer_id: 'b', status: 'overdue' },
      { customer_id: 'b', status: 'overdue' },
    ], 3)
    expect(result).toEqual(['b'])
  })
})
