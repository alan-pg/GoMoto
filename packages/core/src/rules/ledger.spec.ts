import { describe, it, expect } from 'vitest'
import {
  ACCOUNTS,
  buildLedgerEntries,
  assertBalanced,
  signedAmount,
  type LedgerEvent,
  type LedgerEntry,
} from './ledger'

/**
 * Spec 0014 §3.3 — a matriz de eventos é a especificação executável do domínio.
 * Cada linha da tabela da Spec é um caso aqui.
 */

/** Extrai o par (conta debitada, conta creditada) de um evento. */
function pairOf(event: LedgerEvent): [string, string] {
  const entries = buildLedgerEntries(event)
  const debit = entries.find((e) => e.direction === 'debit')!
  const credit = entries.find((e) => e.direction === 'credit')!
  return [debit.account_code, credit.account_code]
}

describe('buildLedgerEntries — matriz de eventos (Spec 0014 §3.3)', () => {
  it('charge_issued de aluguel: recebível contra receita de locação', () => {
    expect(pairOf({ type: 'charge_issued', amount: 500, credit_account: ACCOUNTS.RENTAL_REVENUE }))
      .toEqual([ACCOUNTS.RECEIVABLE, ACCOUNTS.RENTAL_REVENUE])
  })

  it('charge_issuance_reversed inverte exatamente a emissão', () => {
    const emitido = buildLedgerEntries({
      type: 'charge_issued', amount: 500, credit_account: ACCOUNTS.RENTAL_REVENUE,
    })
    const estornado = buildLedgerEntries({
      type: 'charge_issuance_reversed', amount: 500, debit_account: ACCOUNTS.RENTAL_REVENUE,
    })

    const porConta = new Map<string, number>()
    for (const e of [...emitido, ...estornado]) {
      porConta.set(e.account_code, (porConta.get(e.account_code) ?? 0) + signedAmount(e))
    }
    for (const saldo of porConta.values()) expect(saldo).toBe(0)
  })

  it('cancelamento credita RECEBÍVEL, não contas a pagar', () => {
    // Regressão: a primeira versão do cancelamento reaproveitou payable_created,
    // que credita contas_a_pagar — transformava dívida do cliente em dívida da
    // empresa com fornecedor.
    const [debito, credito] = pairOf({
      type: 'charge_issuance_reversed', amount: 200, debit_account: ACCOUNTS.FINE_REIMBURSEMENT,
    })
    expect(debito).toBe(ACCOUNTS.FINE_REIMBURSEMENT)
    expect(credito).toBe(ACCOUNTS.RECEIVABLE)
    expect(credito).not.toBe(ACCOUNTS.PAYABLE)
  })

  it('payment_received: caixa contra recebível', () => {
    expect(pairOf({ type: 'payment_received', amount: 500 }))
      .toEqual([ACCOUNTS.CASH, ACCOUNTS.RECEIVABLE])
  })

  it('payment_received parcial move as mesmas contas, só o valor muda', () => {
    const parcial = buildLedgerEntries({ type: 'payment_received', amount: 200 })
    expect(pairOf({ type: 'payment_received', amount: 200 }))
      .toEqual([ACCOUNTS.CASH, ACCOUNTS.RECEIVABLE])
    expect(parcial[0]!.amount).toBe(200)
  })

  it('payment_reversed inverte exatamente o recebimento', () => {
    const recebido = buildLedgerEntries({ type: 'payment_received', amount: 500 })
    const estornado = buildLedgerEntries({ type: 'payment_reversed', amount: 500 })

    // A soma das duas transações se anula conta a conta.
    const porConta = new Map<string, number>()
    for (const e of [...recebido, ...estornado]) {
      porConta.set(e.account_code, (porConta.get(e.account_code) ?? 0) + signedAmount(e))
    }
    for (const saldo of porConta.values()) expect(saldo).toBe(0)
  })

  it('deposit_received credita PASSIVO, nunca receita', () => {
    const [debito, credito] = pairOf({ type: 'deposit_received', amount: 800 })
    expect(debito).toBe(ACCOUNTS.CASH)
    expect(credito).toBe(ACCOUNTS.DEPOSITS_PAYABLE)
    expect(credito).not.toBe(ACCOUNTS.RENTAL_REVENUE)
  })

  it('deposit_retained: passivo de caução contra recebível', () => {
    expect(pairOf({ type: 'deposit_retained', amount: 300 }))
      .toEqual([ACCOUNTS.DEPOSITS_PAYABLE, ACCOUNTS.RECEIVABLE])
  })

  it('deposit_returned: passivo de caução contra caixa', () => {
    expect(pairOf({ type: 'deposit_returned', amount: 500 }))
      .toEqual([ACCOUNTS.DEPOSITS_PAYABLE, ACCOUNTS.CASH])
  })

  it('payable_created de multa: despesa contra contas a pagar', () => {
    expect(pairOf({ type: 'payable_created', amount: 200, expense_account: ACCOUNTS.FINE_EXPENSE }))
      .toEqual([ACCOUNTS.FINE_EXPENSE, ACCOUNTS.PAYABLE])
  })

  it('payable_paid: contas a pagar contra caixa', () => {
    expect(pairOf({ type: 'payable_paid', amount: 200 }))
      .toEqual([ACCOUNTS.PAYABLE, ACCOUNTS.CASH])
  })

  it('repasse de multa credita conta de REPASSE, não de receita', () => {
    const [debito, credito] = pairOf({
      type: 'charge_issued', amount: 200, credit_account: ACCOUNTS.FINE_REIMBURSEMENT,
    })
    expect(debito).toBe(ACCOUNTS.RECEIVABLE)
    expect(credito).toBe(ACCOUNTS.FINE_REIMBURSEMENT)
    expect(credito).not.toBe(ACCOUNTS.RENTAL_REVENUE)
  })

  it('repasse de manutenção credita conta de repasse de manutenção', () => {
    expect(pairOf({ type: 'charge_issued', amount: 400, credit_account: ACCOUNTS.MAINTENANCE_REIMBURSEMENT }))
      .toEqual([ACCOUNTS.RECEIVABLE, ACCOUNTS.MAINTENANCE_REIMBURSEMENT])
  })

  it('credit_granted: despesa contra passivo de crédito do cliente', () => {
    expect(pairOf({ type: 'credit_granted', amount: 300, expense_account: ACCOUNTS.MAINTENANCE_EXPENSE }))
      .toEqual([ACCOUNTS.MAINTENANCE_EXPENSE, ACCOUNTS.CUSTOMER_CREDITS])
  })

  it('credit_applied: passivo de crédito contra recebível', () => {
    expect(pairOf({ type: 'credit_applied', amount: 300 }))
      .toEqual([ACCOUNTS.CUSTOMER_CREDITS, ACCOUNTS.RECEIVABLE])
  })

  it('late_charge_realized: recebível contra receita de encargos', () => {
    expect(pairOf({ type: 'late_charge_realized', amount: 37.5 }))
      .toEqual([ACCOUNTS.RECEIVABLE, ACCOUNTS.LATE_CHARGE_REVENUE])
  })

  it('charge_written_off: perda contra recebível', () => {
    expect(pairOf({ type: 'charge_written_off', amount: 500 }))
      .toEqual([ACCOUNTS.BAD_DEBT, ACCOUNTS.RECEIVABLE])
  })

  it('vehicle_acquired: frota contra contas a pagar', () => {
    expect(pairOf({ type: 'vehicle_acquired', amount: 14000 }))
      .toEqual([ACCOUNTS.FLEET, ACCOUNTS.PAYABLE])
  })

  it('depreciation_posted: despesa contra depreciação acumulada', () => {
    expect(pairOf({ type: 'depreciation_posted', amount: 195 }))
      .toEqual([ACCOUNTS.DEPRECIATION_EXPENSE, ACCOUNTS.ACCUMULATED_DEPRECIATION])
  })

  it('vehicle_sold: caixa contra receita de venda de ativo', () => {
    expect(pairOf({ type: 'vehicle_sold', amount: 9500 }))
      .toEqual([ACCOUNTS.CASH, ACCOUNTS.ASSET_SALE_REVENUE])
  })
})

describe('buildLedgerEntries — invariante de balanço (Princípio 1)', () => {
  const eventos: LedgerEvent[] = [
    { type: 'charge_issued', amount: 500, credit_account: ACCOUNTS.RENTAL_REVENUE },
    { type: 'charge_issuance_reversed', amount: 500, debit_account: ACCOUNTS.RENTAL_REVENUE },
    { type: 'payment_received', amount: 500 },
    { type: 'payment_reversed', amount: 500 },
    { type: 'deposit_received', amount: 800 },
    { type: 'deposit_retained', amount: 300 },
    { type: 'deposit_returned', amount: 500 },
    { type: 'payable_created', amount: 200, expense_account: ACCOUNTS.FINE_EXPENSE },
    { type: 'payable_paid', amount: 200 },
    { type: 'credit_granted', amount: 300, expense_account: ACCOUNTS.MAINTENANCE_EXPENSE },
    { type: 'credit_applied', amount: 300 },
    { type: 'late_charge_realized', amount: 37.5 },
    { type: 'charge_written_off', amount: 500 },
    { type: 'vehicle_acquired', amount: 14000 },
    { type: 'depreciation_posted', amount: 195 },
    { type: 'vehicle_sold', amount: 9500 },
  ]

  it.each(eventos.map((e) => [e.type, e] as const))(
    '%s fecha em zero e tem exatamente duas pernas',
    (_type, event) => {
      const entries = buildLedgerEntries(event)
      expect(entries).toHaveLength(2)
      expect(entries.reduce((s, e) => s + signedAmount(e), 0)).toBe(0)
    },
  )

  it('cobre todas as variantes de LedgerEvent', () => {
    // Se um evento novo entrar no union sem teste, este número quebra e obriga
    // a atualizar a matriz.
    expect(new Set(eventos.map((e) => e.type)).size).toBe(16)
  })

  it('valor zero ou negativo é rejeitado', () => {
    expect(() => buildLedgerEntries({ type: 'payment_received', amount: 0 }))
      .toThrow(/valor deve ser positivo/)
    expect(() => buildLedgerEntries({ type: 'payment_received', amount: -10 }))
      .toThrow(/valor deve ser positivo/)
  })

  it('centavos não acumulam erro de ponto flutuante', () => {
    const entries = buildLedgerEntries({ type: 'payment_received', amount: 0.1 })
    expect(entries.reduce((s, e) => s + signedAmount(e), 0)).toBe(0)
  })
})

describe('assertBalanced', () => {
  const d = { account_code: ACCOUNTS.CASH, direction: 'debit', amount: 100 } as LedgerEntry
  const c = { account_code: ACCOUNTS.RECEIVABLE, direction: 'credit', amount: 100 } as LedgerEntry

  it('aceita transação balanceada', () => {
    expect(() => assertBalanced([d, c])).not.toThrow()
  })

  it('rejeita perna solta', () => {
    expect(() => assertBalanced([d])).toThrow(/exige contrapartida/)
  })

  it('rejeita transação que não fecha', () => {
    const menor = { ...c, amount: 90 }
    expect(() => assertBalanced([d, menor])).toThrow(/não fecha/)
  })

  it('aceita transação com mais de duas pernas, desde que feche', () => {
    const c1 = { ...c, amount: 60 }
    const c2 = { ...c, account_code: ACCOUNTS.RENTAL_REVENUE, amount: 40 }
    expect(() => assertBalanced([d, c1, c2])).not.toThrow()
  })

  it('mensagem de erro informa o contexto', () => {
    expect(() => assertBalanced([d], 'payment_received')).toThrow(/payment_received/)
  })
})

describe('signedAmount', () => {
  it('débito é positivo e crédito é negativo, espelhando a coluna gerada', () => {
    expect(signedAmount({ direction: 'debit',  amount: 100 })).toBe(100)
    expect(signedAmount({ direction: 'credit', amount: 100 })).toBe(-100)
  })
})
