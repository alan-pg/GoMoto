import { describe, it, expect } from 'vitest'
import {
  calculateAccruedCharges,
  calculateAmountDue,
  allocatePayment,
  applyCredits,
  type LateChargePolicy,
  type ChargeBalance,
  type AvailableCredit,
} from './allocation'

const POLICY: LateChargePolicy = {
  fee_type: 'percentage',
  fee_value: 0.02,          // 2% como FRAÇÃO (modelo novo)
  daily_interest_rate: 0.001,
  grace_period_days: 3,
  min_amount: 0,
}

/** Datas fixas: nada depende do relógio real (evita o flaky de charges.spec.ts). */
const HOJE = new Date(2026, 7, 12)      // 2026-08-12

function charge(id: string, due: string, open: number): ChargeBalance {
  return { charge_id: id, due_date: due, total_amount: open, paid_amount: 0, open_amount: open }
}

describe('calculateAccruedCharges', () => {
  it('não cobra encargo antes do vencimento', () => {
    const r = calculateAccruedCharges(POLICY, 1000, '2026-08-20', HOJE)
    expect(r.total).toBe(0)
    expect(r.days_since_due).toBe(0)
  })

  it('respeita a carência: vencida há 2 dias com carência de 3 não gera encargo', () => {
    const r = calculateAccruedCharges(POLICY, 1000, '2026-08-10', HOJE)
    expect(r.grace_period_active).toBe(true)
    expect(r.total).toBe(0)
    expect(r.days_since_due).toBe(2)
  })

  it('multa aplicada uma vez, juros por dia após a carência', () => {
    // vencida em 2026-08-02 → 10 dias; carência 3 → 7 dias de juros
    const r = calculateAccruedCharges(POLICY, 1000, '2026-08-02', HOJE)
    expect(r.days_since_due).toBe(10)
    expect(r.days_overdue).toBe(7)
    expect(r.fee).toBe(20)          // 2% de 1000
    expect(r.interest).toBe(7)      // 0.1% x 7 dias x 1000
    expect(r.total).toBe(27)
  })

  it('multa fixa não depende do principal', () => {
    const fixa: LateChargePolicy = { ...POLICY, fee_type: 'fixed', fee_value: 25 }
    const r = calculateAccruedCharges(fixa, 1000, '2026-08-02', HOJE)
    expect(r.fee).toBe(25)
  })

  it('aplica valor mínimo quando o encargo calculado fica abaixo', () => {
    const comMinimo: LateChargePolicy = { ...POLICY, min_amount: 50 }
    const r = calculateAccruedCharges(comMinimo, 1000, '2026-08-02', HOJE)
    expect(r.total).toBe(50)        // 27 calculado, elevado ao mínimo
  })

  it('sem política, não há encargo', () => {
    expect(calculateAccruedCharges(null, 1000, '2026-01-01', HOJE).total).toBe(0)
  })

  it('principal zero não gera encargo', () => {
    expect(calculateAccruedCharges(POLICY, 0, '2026-01-01', HOJE).total).toBe(0)
  })
})

describe('calculateAmountDue — fonte única do valor devido (F-05)', () => {
  it.each(['written_off', 'cancelled', 'paid'] as const)(
    'cobrança %s não deve nada e não acumula encargo',
    (status) => {
      // Regressão: a tela de cobranças exibia baixadas de 2020 devendo R$545,18
      // (principal R$300 + R$245,18 de juros que cresciam todo dia) sobre
      // dívida já reconhecida como perda. `open_amount` continua sendo a
      // aritmética do documento — quem lê precisa considerar o status.
      const r = calculateAmountDue(
        { open_amount: 300, due_date: '2020-01-01', status },
        POLICY,
        HOJE,
      )
      expect(r.amount_due).toBe(0)
      expect(r.accrued.total).toBe(0)
      // O saldo do documento é preservado: é ele que registra o valor perdido.
      expect(r.open_amount).toBe(300)
    },
  )

  it('cobrança aberta e vencida segue devendo principal + encargo', () => {
    // Contraprova do caso acima: o status é o que muda o resultado, não a data.
    const r = calculateAmountDue(
      { open_amount: 300, due_date: '2020-01-01', status: 'open' },
      POLICY,
      HOJE,
    )
    expect(r.amount_due).toBeGreaterThan(300)
    expect(r.accrued.total).toBeGreaterThan(0)
  })

  it('cobrança em dia deve o saldo em aberto, sem encargo', () => {
    const r = calculateAmountDue({ open_amount: 500, due_date: '2026-08-20' }, POLICY, HOJE)
    expect(r.amount_due).toBe(500)
    expect(r.accrued.total).toBe(0)
  })

  it('cobrança vencida deve saldo + encargo', () => {
    const r = calculateAmountDue({ open_amount: 1000, due_date: '2026-08-02' }, POLICY, HOJE)
    expect(r.amount_due).toBe(1027)
  })

  it('saldo parcial já abatido reduz a base do encargo', () => {
    // cobrança de 1000 com 600 pagos → encargo incide sobre 400
    const r = calculateAmountDue({ open_amount: 400, due_date: '2026-08-02' }, POLICY, HOJE)
    expect(r.accrued.fee).toBe(8)     // 2% de 400
    expect(r.amount_due).toBe(410.8)  // 400 + 8 + 2.8
  })

  it('nunca devolve valor negativo', () => {
    const r = calculateAmountDue({ open_amount: 0, due_date: '2026-01-01' }, POLICY, HOJE)
    expect(r.amount_due).toBe(0)
  })
})

describe('allocatePayment', () => {
  it('quita integralmente uma cobrança', () => {
    const { allocations, unallocated } = allocatePayment(500, [charge('a', '2026-08-01', 500)])
    expect(allocations).toEqual([{ charge_id: 'a', amount: 500 }])
    expect(unallocated).toBe(0)
  })

  it('pagamento parcial aloca o que cabe e deixa saldo na cobrança', () => {
    const { allocations, unallocated } = allocatePayment(300, [charge('a', '2026-08-01', 700)])
    expect(allocations).toEqual([{ charge_id: 'a', amount: 300 }])
    expect(unallocated).toBe(0)
  })

  it('abate da MAIS ANTIGA primeiro, não da recém-criada', () => {
    const { allocations } = allocatePayment(600, [
      charge('nova',  '2026-08-10', 500),
      charge('antiga','2026-07-01', 500),
    ])
    expect(allocations[0]!.charge_id).toBe('antiga')
    expect(allocations[0]!.amount).toBe(500)
    expect(allocations[1]!.charge_id).toBe('nova')
    expect(allocations[1]!.amount).toBe(100)
  })

  it('um pagamento cobre várias cobranças', () => {
    const { allocations, unallocated } = allocatePayment(1000, [
      charge('a', '2026-07-01', 400),
      charge('b', '2026-07-15', 400),
      charge('c', '2026-08-01', 400),
    ])
    expect(allocations).toHaveLength(3)
    expect(allocations.map((a) => a.amount)).toEqual([400, 400, 200])
    expect(unallocated).toBe(0)
  })

  it('sobra é devolvida para virar crédito', () => {
    const { allocations, unallocated } = allocatePayment(800, [charge('a', '2026-08-01', 500)])
    expect(allocations).toEqual([{ charge_id: 'a', amount: 500 }])
    expect(unallocated).toBe(300)
  })

  it('a soma das alocações nunca excede o pagamento', () => {
    const { allocations } = allocatePayment(250, [
      charge('a', '2026-07-01', 400),
      charge('b', '2026-07-15', 400),
    ])
    expect(allocations.reduce((s, a) => s + a.amount, 0)).toBe(250)
  })

  it('ignora cobrança já quitada', () => {
    const { allocations } = allocatePayment(100, [
      { ...charge('quitada', '2026-07-01', 0), total_amount: 500, paid_amount: 500 },
      charge('aberta', '2026-08-01', 100),
    ])
    expect(allocations).toEqual([{ charge_id: 'aberta', amount: 100 }])
  })

  it('rejeita pagamento não positivo', () => {
    expect(() => allocatePayment(0, [])).toThrow(/positivo/)
    expect(() => allocatePayment(-5, [])).toThrow(/positivo/)
  })

  it('ordenação é determinística no empate de vencimento', () => {
    const r1 = allocatePayment(100, [charge('b', '2026-08-01', 100), charge('a', '2026-08-01', 100)])
    const r2 = allocatePayment(100, [charge('a', '2026-08-01', 100), charge('b', '2026-08-01', 100)])
    expect(r1.allocations[0]!.charge_id).toBe(r2.allocations[0]!.charge_id)
  })
})

describe('applyCredits — corrige F-06', () => {
  it('usa TODOS os créditos, não apenas o primeiro', () => {
    // O bug antigo: LIMIT 1 abateria só 50 de uma dívida de 120.
    const credits: AvailableCredit[] = [
      { id: 'c1', amount: 50, available: 50 },
      { id: 'c2', amount: 50, available: 50 },
      { id: 'c3', amount: 50, available: 50 },
    ]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 120)], HOJE)

    expect(applications.reduce((s, a) => s + a.amount, 0)).toBe(120)
    expect(applications).toHaveLength(3)
    expect(applications[2]!.amount).toBe(20)   // o terceiro entra só com o resto
  })

  it('abate a cobrança de vencimento mais antigo', () => {
    const credits: AvailableCredit[] = [{ id: 'c1', amount: 300, available: 300 }]
    const { applications } = applyCredits(credits, [
      charge('nova',   '2026-08-10', 200),
      charge('antiga', '2026-07-01', 200),
    ], HOJE)

    expect(applications[0]!.charge_id).toBe('antiga')
  })

  it('ignora crédito expirado', () => {
    const credits: AvailableCredit[] = [
      { id: 'vencido', amount: 100, available: 100, expires_at: '2026-08-11' },
      { id: 'valido',  amount: 100, available: 100, expires_at: '2026-12-31' },
    ]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 150)], HOJE)

    expect(applications.every((a) => a.credit_id === 'valido')).toBe(true)
    expect(applications.reduce((s, a) => s + a.amount, 0)).toBe(100)
  })

  it('crédito que expira hoje ainda é usável', () => {
    const credits: AvailableCredit[] = [{ id: 'c', amount: 100, available: 100, expires_at: '2026-08-12' }]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 100)], HOJE)
    expect(applications).toHaveLength(1)
  })

  it('consome o crédito que expira antes primeiro', () => {
    const credits: AvailableCredit[] = [
      { id: 'longe', amount: 100, available: 100, expires_at: '2026-12-31' },
      { id: 'perto', amount: 100, available: 100, expires_at: '2026-09-01' },
    ]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 50)], HOJE)
    expect(applications[0]!.credit_id).toBe('perto')
  })

  it('crédito sem expiração é usado por último', () => {
    const credits: AvailableCredit[] = [
      { id: 'eterno', amount: 100, available: 100 },
      { id: 'expira', amount: 100, available: 100, expires_at: '2026-09-01' },
    ]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 50)], HOJE)
    expect(applications[0]!.credit_id).toBe('expira')
  })

  it('devolve o saldo de crédito não consumido', () => {
    const credits: AvailableCredit[] = [{ id: 'c', amount: 500, available: 500 }]
    const { applications, remainingCredit } = applyCredits(credits, [charge('x', '2026-08-01', 200)], HOJE)
    expect(applications[0]!.amount).toBe(200)
    expect(remainingCredit).toBe(300)
  })

  it('sem cobrança em aberto, nada é aplicado e o saldo permanece', () => {
    const credits: AvailableCredit[] = [{ id: 'c', amount: 500, available: 500 }]
    const { applications, remainingCredit } = applyCredits(credits, [], HOJE)
    expect(applications).toHaveLength(0)
    expect(remainingCredit).toBe(500)
  })

  it('nunca aplica mais do que o crédito disponível', () => {
    const credits: AvailableCredit[] = [{ id: 'c', amount: 100, available: 40 }]
    const { applications } = applyCredits(credits, [charge('x', '2026-08-01', 500)], HOJE)
    expect(applications.reduce((s, a) => s + a.amount, 0)).toBe(40)
  })
})
