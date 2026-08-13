import { describe, it, expect } from 'vitest'
import {
  CreateChargeSchema,
  ReceivePaymentSchema,
  CreatePayableSchema,
  SettleDepositSchema,
  GrantCreditSchema,
} from './ledger'

const UUID = '00000000-0000-4000-8000-000000000001'

const itemValido = {
  description: 'Aluguel semanal',
  credit_account_code: 'receita_locacao',
  quantity: 1,
  unit_amount: 250,
  amount: 250,
  source_module: 'rental',
}

describe('CreateChargeSchema', () => {
  it('aceita cobrança com um item', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '2026-08-20', items: [itemValido],
    })
    expect(r.success).toBe(true)
  })

  it('aceita cobrança composta de origens diferentes', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '2026-08-20',
      items: [
        itemValido,
        { ...itemValido, description: 'Multa', credit_account_code: 'repasse_multa',
          unit_amount: 200, amount: 200, source_module: 'fine' },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('recusa cobrança sem item', () => {
    const r = CreateChargeSchema.safeParse({ customer_id: UUID, due_date: '2026-08-20', items: [] })
    expect(r.success).toBe(false)
  })

  it('recusa item cujo total não bate com quantidade x unitário', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '2026-08-20',
      items: [{ ...itemValido, quantity: 2, unit_amount: 250, amount: 250 }],
    })
    expect(r.success).toBe(false)
  })

  it('aceita quantidade fracionária que fecha', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '2026-08-20',
      items: [{ ...itemValido, quantity: 2, unit_amount: 125, amount: 250 }],
    })
    expect(r.success).toBe(true)
  })

  it('recusa valor com mais de duas casas decimais', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '2026-08-20',
      items: [{ ...itemValido, unit_amount: 250.005, amount: 250.005 }],
    })
    expect(r.success).toBe(false)
  })

  it('recusa data fora do formato ISO', () => {
    const r = CreateChargeSchema.safeParse({
      customer_id: UUID, due_date: '20/08/2026', items: [itemValido],
    })
    expect(r.success).toBe(false)
  })
})

describe('ReceivePaymentSchema', () => {
  it('aceita pagamento sem alocação explícita', () => {
    const r = ReceivePaymentSchema.safeParse({
      customer_id: UUID, amount: 500, method: 'pix', paid_at: '2026-08-12T10:00:00Z',
    })
    expect(r.success).toBe(true)
  })

  it('aceita alocação que cabe no pagamento', () => {
    const r = ReceivePaymentSchema.safeParse({
      customer_id: UUID, amount: 500, method: 'pix', paid_at: '2026-08-12T10:00:00Z',
      allocations: [{ charge_id: UUID, amount: 300 }],
    })
    expect(r.success).toBe(true)
  })

  it('recusa alocação que excede o pagamento', () => {
    const r = ReceivePaymentSchema.safeParse({
      customer_id: UUID, amount: 500, method: 'pix', paid_at: '2026-08-12T10:00:00Z',
      allocations: [{ charge_id: UUID, amount: 600 }],
    })
    expect(r.success).toBe(false)
  })

  it('recusa valor zero ou negativo', () => {
    for (const amount of [0, -100]) {
      const r = ReceivePaymentSchema.safeParse({
        customer_id: UUID, amount, method: 'pix', paid_at: '2026-08-12T10:00:00Z',
      })
      expect(r.success).toBe(false)
    }
  })

  it('recusa método desconhecido', () => {
    const r = ReceivePaymentSchema.safeParse({
      customer_id: UUID, amount: 500, method: 'bitcoin', paid_at: '2026-08-12T10:00:00Z',
    })
    expect(r.success).toBe(false)
  })
})

describe('CreatePayableSchema — espelha as CHECK de payables', () => {
  const base = {
    description: 'Manutenção', expense_account_code: 'despesa_manutencao',
    competence_date: '2026-08-01', due_date: '2026-08-10',
    amount: 1000, source_module: 'maintenance',
  }

  it('aceita despesa integral da empresa', () => {
    expect(CreatePayableSchema.safeParse({ ...base, responsibility: 'company' }).success).toBe(true)
  })

  it('aceita rateio coerente', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'shared', customer_id: UUID,
      customer_amount: 400, reimbursement: 'charge',
    })
    expect(r.success).toBe(true)
  })

  it('recusa empresa com parte do cliente', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'company', customer_id: UUID,
      customer_amount: 400, reimbursement: 'charge',
    })
    expect(r.success).toBe(false)
  })

  it('recusa cliente com parte menor que o total', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'customer', customer_id: UUID,
      customer_amount: 400, reimbursement: 'charge',
    })
    expect(r.success).toBe(false)
  })

  it('recusa parte do cliente maior que o total', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'shared', customer_id: UUID,
      customer_amount: 1500, reimbursement: 'charge',
    })
    expect(r.success).toBe(false)
  })

  it('recusa rateio sem cliente informado', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'shared', customer_amount: 400, reimbursement: 'charge',
    })
    expect(r.success).toBe(false)
  })

  it('recusa rateio sem definir a forma de retorno', () => {
    const r = CreatePayableSchema.safeParse({
      ...base, responsibility: 'shared', customer_id: UUID,
      customer_amount: 400, reimbursement: 'none',
    })
    expect(r.success).toBe(false)
  })
})

describe('SettleDepositSchema', () => {
  it('aceita devolução integral', () => {
    const r = SettleDepositSchema.safeParse({
      deposit_id: UUID, retained_amount: 0, returned_amount: 800,
    })
    expect(r.success).toBe(true)
  })

  it('retenção exige justificativa', () => {
    const semMotivo = SettleDepositSchema.safeParse({
      deposit_id: UUID, retained_amount: 300, returned_amount: 500,
    })
    expect(semMotivo.success).toBe(false)

    const comMotivo = SettleDepositSchema.safeParse({
      deposit_id: UUID, retained_amount: 300, returned_amount: 500, reason: 'Dano no para-lama',
    })
    expect(comMotivo.success).toBe(true)
  })

  it('recusa apuração que não movimenta nada', () => {
    const r = SettleDepositSchema.safeParse({
      deposit_id: UUID, retained_amount: 0, returned_amount: 0,
    })
    expect(r.success).toBe(false)
  })
})

describe('GrantCreditSchema', () => {
  it('aceita crédito com motivo', () => {
    const r = GrantCreditSchema.safeParse({
      customer_id: UUID, amount: 300, origin: 'maintenance_refund', reason: 'Cliente pagou revisão',
    })
    expect(r.success).toBe(true)
  })

  it('recusa crédito sem motivo suficiente', () => {
    const r = GrantCreditSchema.safeParse({
      customer_id: UUID, amount: 300, origin: 'manual', reason: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('aceita expiração opcional', () => {
    const r = GrantCreditSchema.safeParse({
      customer_id: UUID, amount: 300, origin: 'manual', reason: 'Ajuste combinado',
      expires_at: '2026-12-31',
    })
    expect(r.success).toBe(true)
  })
})
