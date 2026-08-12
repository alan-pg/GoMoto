/**
 * Ledger financeiro — tradução de evento de domínio em lançamentos balanceados.
 *
 * Spec 0014 / ADR 0024. Este módulo é a fonte única de "que contas um fato
 * financeiro movimenta". Nenhuma Server Action deve montar lançamento à mão:
 * toda escrita passa por `buildLedgerEntries`.
 *
 * Princípio 1: toda transação fecha em zero. O banco garante isso via
 * `fn_assert_transaction_balanced`; aqui a garantia é antecipada, para o erro
 * aparecer no teste e não no COMMIT.
 */

// ============================================================
// Plano de contas
// ============================================================

/** Códigos do catálogo global `financial_accounts` (migration 02). */
export const ACCOUNTS = {
  CASH:                  'caixa_e_bancos',
  RECEIVABLE:            'contas_a_receber',
  FLEET:                 'frota_veiculos',
  ACCUMULATED_DEPRECIATION: 'depreciacao_acumulada',

  DEPOSITS_PAYABLE:      'caucoes_a_devolver',
  CUSTOMER_CREDITS:      'creditos_de_clientes',
  PAYABLE:               'contas_a_pagar',

  RENTAL_REVENUE:        'receita_locacao',
  LATE_CHARGE_REVENUE:   'receita_encargos_atraso',
  ASSET_SALE_REVENUE:    'receita_venda_ativo',

  MAINTENANCE_EXPENSE:   'despesa_manutencao',
  FINE_EXPENSE:          'despesa_multa',
  DOCUMENTATION_EXPENSE: 'despesa_documentacao',
  INSURANCE_EXPENSE:     'despesa_seguro',
  OPERATIONAL_EXPENSE:   'despesa_operacional',
  DEPRECIATION_EXPENSE:  'despesa_depreciacao',
  BAD_DEBT:              'perda_inadimplencia',

  MAINTENANCE_REIMBURSEMENT: 'repasse_manutencao',
  FINE_REIMBURSEMENT:        'repasse_multa',
  OPERATIONAL_REIMBURSEMENT: 'repasse_operacional',
} as const

export type AccountCode = (typeof ACCOUNTS)[keyof typeof ACCOUNTS]

export type EntryDirection = 'debit' | 'credit'

/** Dimensões analíticas do lançamento. Relatório novo é GROUP BY, não tabela nova. */
export type LedgerDimensions = {
  customer_id?: string | null
  vehicle_id?: string | null
  rental_id?: string | null
  charge_id?: string | null
  payable_id?: string | null
  cost_center_id?: string | null
}

export type LedgerEntry = LedgerDimensions & {
  account_code: AccountCode
  direction: EntryDirection
  amount: number
}

// ============================================================
// Eventos de domínio
// ============================================================

/**
 * Eventos que movimentam dinheiro. Espelha a matriz da Spec 0014 §3.3 —
 * cada variante tem um caso de teste em `ledger.spec.ts`.
 */
export type LedgerEvent =
  /** Emissão de cobrança. A conta creditada vem do item (receita ou repasse). */
  | { type: 'charge_issued'; amount: number; credit_account: AccountCode; dimensions?: LedgerDimensions }
  /** Recebimento, total ou parcial — a diferença é só o valor. */
  | { type: 'payment_received'; amount: number; dimensions?: LedgerDimensions }
  /** Estorno de pagamento: inverte o recebimento. */
  | { type: 'payment_reversed'; amount: number; dimensions?: LedgerDimensions }
  /** Caução recebida — passivo, nunca receita. */
  | { type: 'deposit_received'; amount: number; dimensions?: LedgerDimensions }
  /** Caução retida para quitar dívida do cliente. */
  | { type: 'deposit_retained'; amount: number; dimensions?: LedgerDimensions }
  /** Devolução do saldo da caução. */
  | { type: 'deposit_returned'; amount: number; dimensions?: LedgerDimensions }
  /** Conta a pagar da empresa. */
  | { type: 'payable_created'; amount: number; expense_account: AccountCode; dimensions?: LedgerDimensions }
  /** Pagamento de conta da empresa. */
  | { type: 'payable_paid'; amount: number; dimensions?: LedgerDimensions }
  /** Crédito concedido ao cliente — passivo. */
  | { type: 'credit_granted'; amount: number; expense_account: AccountCode; dimensions?: LedgerDimensions }
  /** Crédito abatido de cobrança. */
  | { type: 'credit_applied'; amount: number; dimensions?: LedgerDimensions }
  /** Encargo de atraso efetivamente cobrado. Não existe antes de ser realizado. */
  | { type: 'late_charge_realized'; amount: number; dimensions?: LedgerDimensions }
  /** Baixa por inadimplência. */
  | { type: 'charge_written_off'; amount: number; dimensions?: LedgerDimensions }
  /** Aquisição de veículo. */
  | { type: 'vehicle_acquired'; amount: number; dimensions?: LedgerDimensions }
  /** Depreciação mensal. */
  | { type: 'depreciation_posted'; amount: number; dimensions?: LedgerDimensions }
  /** Venda de veículo. */
  | { type: 'vehicle_sold'; amount: number; dimensions?: LedgerDimensions }

// ============================================================
// Tradução
// ============================================================

/**
 * Traduz um evento de domínio nas pernas de débito e crédito correspondentes.
 *
 * @throws Se o valor não for positivo ou se as pernas não fecharem em zero.
 */
export function buildLedgerEntries(event: LedgerEvent): LedgerEntry[] {
  if (!(event.amount > 0)) {
    throw new Error(`Evento ${event.type}: valor deve ser positivo, recebido ${event.amount}`)
  }

  const d = event.dimensions ?? {}
  const entries = translate(event, d)

  assertBalanced(entries, event.type)
  return entries
}

function translate(event: LedgerEvent, d: LedgerDimensions): LedgerEntry[] {
  const { amount } = event

  switch (event.type) {
    // Cobrança sobe o recebível e credita a conta do item. Quando o item é
    // repasse, a conta creditada é de `reimbursement` — reduz custo em vez de
    // virar receita, e a linha de DRE é política do tenant (ADR 0024).
    case 'charge_issued':
      return pair(ACCOUNTS.RECEIVABLE, event.credit_account, amount, d)

    case 'payment_received':
      return pair(ACCOUNTS.CASH, ACCOUNTS.RECEIVABLE, amount, d)

    case 'payment_reversed':
      return pair(ACCOUNTS.RECEIVABLE, ACCOUNTS.CASH, amount, d)

    // Caução é dinheiro de terceiro: entra no caixa contra passivo.
    // É estrutural e não configurável — nunca aparece como receita.
    case 'deposit_received':
      return pair(ACCOUNTS.CASH, ACCOUNTS.DEPOSITS_PAYABLE, amount, d)

    case 'deposit_retained':
      return pair(ACCOUNTS.DEPOSITS_PAYABLE, ACCOUNTS.RECEIVABLE, amount, d)

    case 'deposit_returned':
      return pair(ACCOUNTS.DEPOSITS_PAYABLE, ACCOUNTS.CASH, amount, d)

    case 'payable_created':
      return pair(event.expense_account, ACCOUNTS.PAYABLE, amount, d)

    case 'payable_paid':
      return pair(ACCOUNTS.PAYABLE, ACCOUNTS.CASH, amount, d)

    // Cliente executou serviço que cabia à empresa: a despesa é da empresa e a
    // contrapartida é dívida com o cliente.
    case 'credit_granted':
      return pair(event.expense_account, ACCOUNTS.CUSTOMER_CREDITS, amount, d)

    case 'credit_applied':
      return pair(ACCOUNTS.CUSTOMER_CREDITS, ACCOUNTS.RECEIVABLE, amount, d)

    case 'late_charge_realized':
      return pair(ACCOUNTS.RECEIVABLE, ACCOUNTS.LATE_CHARGE_REVENUE, amount, d)

    case 'charge_written_off':
      return pair(ACCOUNTS.BAD_DEBT, ACCOUNTS.RECEIVABLE, amount, d)

    case 'vehicle_acquired':
      return pair(ACCOUNTS.FLEET, ACCOUNTS.PAYABLE, amount, d)

    case 'depreciation_posted':
      return pair(ACCOUNTS.DEPRECIATION_EXPENSE, ACCOUNTS.ACCUMULATED_DEPRECIATION, amount, d)

    case 'vehicle_sold':
      return pair(ACCOUNTS.CASH, ACCOUNTS.ASSET_SALE_REVENUE, amount, d)
  }
}

function pair(
  debitAccount: AccountCode,
  creditAccount: AccountCode,
  amount: number,
  dimensions: LedgerDimensions,
): LedgerEntry[] {
  return [
    { ...dimensions, account_code: debitAccount,  direction: 'debit',  amount },
    { ...dimensions, account_code: creditAccount, direction: 'credit', amount },
  ]
}

// ============================================================
// Invariante
// ============================================================

/** Valor sinalizado: débito positivo, crédito negativo. Espelha a coluna gerada. */
export function signedAmount(entry: Pick<LedgerEntry, 'direction' | 'amount'>): number {
  return entry.direction === 'debit' ? entry.amount : -entry.amount
}

/**
 * Verifica o Princípio 1 antes de tocar o banco.
 *
 * O `CONSTRAINT TRIGGER` da migration 06 é a barreira final; esta checagem
 * existe para o desequilíbrio falhar no teste unitário, com contexto, em vez
 * de aparecer como erro de COMMIT.
 */
export function assertBalanced(entries: LedgerEntry[], context = 'transação'): void {
  if (entries.length < 2) {
    throw new Error(`${context}: lançamento exige contrapartida, recebido ${entries.length} perna(s)`)
  }

  const balance = round2(entries.reduce((sum, e) => sum + signedAmount(e), 0))

  if (balance !== 0) {
    throw new Error(`${context}: não fecha, soma dos lançamentos = ${balance} (esperado 0)`)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
