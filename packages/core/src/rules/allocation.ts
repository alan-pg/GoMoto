/**
 * Alocação de pagamento e aplicação de crédito.
 *
 * Spec 0014 / ADR 0024. Substitui `fn_auto_apply_credit`, que aplicava um único
 * crédito (`LIMIT 1`), sobrescrevia o acumulado em vez de somar e engolia
 * qualquer falha com `EXCEPTION WHEN OTHERS` — perdendo dinheiro em silêncio
 * (F-06).
 *
 * Regras de ordenação (R-09): abate-se sempre a cobrança de VENCIMENTO MAIS
 * ANTIGO, não a recém-criada. Crédito expirado é ignorado.
 */

// ============================================================
// Tipos
// ============================================================

export type LateChargePolicy = {
  /** 'fixed': valor em reais. 'percentage': fração (0.02 = 2%). */
  fee_type: 'fixed' | 'percentage'
  fee_value: number
  daily_interest_rate: number
  grace_period_days: number
  min_amount: number
}

export type AccruedCharges = {
  grace_period_active: boolean
  fee: number
  interest: number
  total: number
  days_since_due: number
  days_overdue: number
}

/** Linha de `charge_balances`. */
export type ChargeBalance = {
  charge_id: string
  due_date: string
  total_amount: number
  paid_amount: number
  open_amount: number
}

export type AvailableCredit = {
  id: string
  amount: number
  /** Saldo disponível, vindo de `customer_credit_balances`. */
  available: number
  expires_at?: string | null
}

export type Allocation = {
  charge_id: string
  amount: number
}

export type CreditApplicationPlan = {
  credit_id: string
  charge_id: string
  amount: number
}

// ============================================================
// Encargos
// ============================================================

/**
 * Encargo acumulado até `asOf`. É valor PROJETADO — não vira lançamento nem
 * linha de tabela enquanto não for efetivamente cobrado (R-06). Quando é
 * realizado, vira `charge_item` e emite `late_charge_realized`.
 *
 * @param policy   Política fixada na emissão da cobrança (`late_charge_policy_id`).
 * @param principal Valor em aberto da cobrança.
 * @param dueDate  Vencimento no formato YYYY-MM-DD.
 * @param asOf     Data de referência (injetada para teste).
 */
export function calculateAccruedCharges(
  policy: LateChargePolicy | null | undefined,
  principal: number,
  dueDate: string,
  asOf: Date = new Date(),
): AccruedCharges {
  const zero: AccruedCharges = {
    grace_period_active: false,
    fee: 0,
    interest: 0,
    total: 0,
    days_since_due: 0,
    days_overdue: 0,
  }

  if (!policy || principal <= 0) return zero

  const due = parseDateLocal(dueDate)
  const today = toDateOnly(asOf)
  const days_since_due = Math.floor((today.getTime() - due.getTime()) / MS_PER_DAY)

  if (days_since_due <= 0) return zero

  const days_overdue = Math.max(0, days_since_due - policy.grace_period_days)
  if (days_overdue === 0) {
    return { ...zero, grace_period_active: true, days_since_due }
  }

  // Multa: uma única vez. fee_value é FRAÇÃO no modelo novo (0.02 = 2%),
  // diferente do `late_charge_config` legado, que guardava 2 para 2%.
  const fee = policy.fee_type === 'percentage'
    ? round2(principal * policy.fee_value)
    : round2(policy.fee_value)

  // Juros: acumulam por dia.
  const interest = round2(principal * policy.daily_interest_rate * days_overdue)

  let total = round2(fee + interest)
  if (total < policy.min_amount) total = round2(policy.min_amount)

  return { grace_period_active: false, fee, interest, total, days_since_due, days_overdue }
}

/**
 * Valor devido de uma cobrança: saldo em aberto + encargo acumulado.
 *
 * FONTE ÚNICA. Hoje existem três contas diferentes para a mesma cobrança —
 * o gateway usa `original − desconto` (`pix.ts:54`), o hook web soma encargo e
 * abate crédito, e o app mobile repete a conta do gateway. O resultado é
 * cliente com crédito pagando a mais e cobrança vencida quitando a menos (F-05).
 *
 * Esta função deve ser a única consumida pelo cockpit, pelo Route Handler do
 * mobile e pela criação de intent no gateway.
 */
export function calculateAmountDue(
  balance: Pick<ChargeBalance, 'open_amount' | 'due_date'>,
  policy: LateChargePolicy | null | undefined,
  asOf: Date = new Date(),
): { open_amount: number; accrued: AccruedCharges; amount_due: number } {
  const accrued = calculateAccruedCharges(policy, balance.open_amount, balance.due_date, asOf)
  const amount_due = Math.max(0, round2(balance.open_amount + accrued.total))
  return { open_amount: balance.open_amount, accrued, amount_due }
}

// ============================================================
// Alocação de pagamento
// ============================================================

/**
 * Distribui um pagamento entre cobranças em aberto, da mais antiga para a mais
 * nova. Sobra é devolvida em `unallocated` — cabe à Server Action transformá-la
 * em crédito do cliente.
 *
 * A soma das alocações nunca excede o pagamento; o banco reforça isso em
 * `fn_assert_allocation_within_payment`.
 */
export function allocatePayment(
  paymentAmount: number,
  openCharges: ChargeBalance[],
): { allocations: Allocation[]; unallocated: number } {
  if (!(paymentAmount > 0)) {
    throw new Error(`Pagamento deve ser positivo, recebido ${paymentAmount}`)
  }

  const allocations: Allocation[] = []
  let remaining = round2(paymentAmount)

  for (const charge of sortByDueDate(openCharges)) {
    if (remaining <= 0) break
    if (charge.open_amount <= 0) continue

    const amount = round2(Math.min(remaining, charge.open_amount))
    allocations.push({ charge_id: charge.charge_id, amount })
    remaining = round2(remaining - amount)
  }

  return { allocations, unallocated: remaining }
}

// ============================================================
// Aplicação de crédito
// ============================================================

/**
 * Aplica créditos disponíveis às cobranças em aberto.
 *
 * Diferenças em relação a `fn_auto_apply_credit` (F-06, R-09):
 * - percorre TODOS os créditos, não só o mais antigo
 * - abate a cobrança de vencimento mais antigo, não a recém-inserida
 * - ignora crédito expirado
 * - não engole erro: entrada inválida lança
 *
 * Elegibilidade de cobrança (caução não recebe crédito) é responsabilidade de
 * quem monta `openCharges` — a caução tem conta de passivo própria e não entra
 * na lista de recebíveis operacionais.
 */
export function applyCredits(
  credits: AvailableCredit[],
  openCharges: ChargeBalance[],
  asOf: Date = new Date(),
): { applications: CreditApplicationPlan[]; remainingCredit: number } {
  const today = toDateOnly(asOf)

  const usable = credits
    .filter((c) => c.available > 0)
    .filter((c) => !c.expires_at || parseDateLocal(c.expires_at) >= today)
    .sort((a, b) => (a.expires_at ?? '9999-12-31').localeCompare(b.expires_at ?? '9999-12-31'))

  const applications: CreditApplicationPlan[] = []
  const balances = new Map(usable.map((c) => [c.id, round2(c.available)]))

  for (const charge of sortByDueDate(openCharges)) {
    let owed = round2(charge.open_amount)
    if (owed <= 0) continue

    for (const credit of usable) {
      if (owed <= 0) break
      const available = balances.get(credit.id) ?? 0
      if (available <= 0) continue

      const amount = round2(Math.min(available, owed))
      applications.push({ credit_id: credit.id, charge_id: charge.charge_id, amount })
      balances.set(credit.id, round2(available - amount))
      owed = round2(owed - amount)
    }
  }

  const remainingCredit = round2([...balances.values()].reduce((s, v) => s + v, 0))
  return { applications, remainingCredit }
}

// ============================================================
// Helpers
// ============================================================

/** Vencimento mais antigo primeiro; empate desempatado pelo id, para ser determinístico. */
function sortByDueDate(charges: ChargeBalance[]): ChargeBalance[] {
  return [...charges].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.charge_id.localeCompare(b.charge_id),
  )
}

const MS_PER_DAY = 86_400_000

function parseDateLocal(yyyymmdd: string): Date {
  // Índices explícitos em vez de desestruturar: sob `noUncheckedIndexedAccess`,
  // o destructuring produz `number | undefined`.
  const parts = yyyymmdd.split('-')
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
