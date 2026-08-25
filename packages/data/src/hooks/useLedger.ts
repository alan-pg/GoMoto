/**
 * Hooks de leitura do domínio financeiro (Spec 0014).
 *
 * Toda agregação vem de view. O único cálculo feito aqui é `calculateAmountDue`,
 * de @gomoto/core — a MESMA função consumida pelo Route Handler do mobile e
 * pela criação de intent no gateway. É o que impede a divergência de F-05, em
 * que a mesma cobrança tinha três valores devidos diferentes.
 */

import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  calculateAmountDue,
  classifyCustomerDelinquency,
  contractedBacklog,
  DEFAULT_DELINQUENCY_POLICY,
  type DelinquencyStatus,
  type LateChargePolicy,
} from '@gomoto/core'
import {
  listOpenCharges,
  listChargesForCockpit,
  listPayables,
  listProviderAccounts,
  listLateChargePolicies,
  listOpenChargesByRental,
  getChargeBalance,
  listChargeItems,
  listReceivables,
  listOverdueCharges,
  getCustomerDelinquency,
  listDelinquentCustomers,
  getDepositBalance,
  getCustomerCreditBalance,
  getVehiclePosition,
  listVehiclePositions,
  getRentalResult,
  listIncomeStatement,
  listRentalSchedule,
  getActiveDelinquencyPolicy,
  type ChargeBalanceRow,
} from '../repositories/ledger'

const KEY = {
  charges: 'charges',
  chargeItems: 'charge-items',
  receivables: 'receivables',
  overdue: 'overdue-charges',
  delinquency: 'delinquency',
  deposit: 'deposit-balance',
  credit: 'credit-balance',
  vehicle: 'vehicle-position',
  rental: 'rental-result',
  dre: 'income-statement',
  schedule: 'rental-schedule',
  policy: 'financial-policy',
  monthlySummary: 'monthly-summary',
} as const

function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ============================================================
// Cobranças
// ============================================================

/** Linha do app do cliente: saldo + o que a tela precisa exibir. */
export type MyChargeRow = ChargeWithDue & {
  description: string
  item_count: number
  vehicle_plate: string | null
}

export type ChargeWithDue = ChargeBalanceRow & {
  accrued_total: number
  amount_due: number
}

/**
 * Políticas do tenant indexadas por id.
 *
 * As três listagens resolviam a política vigente HOJE e aplicavam a MESMA a
 * todas as linhas. Enquanto existiu uma versão só, ninguém percebeu; bastou a
 * segunda para a mesma cobrança mostrar multa fixa de R$ 35 na lista e 2% na
 * tela de detalhe — que é a única que lia `late_charge_policy_id`.
 *
 * São poucas linhas por tenant (uma por mudança de política na história da
 * empresa), então buscar todas e indexar sai mais barato que juntar a política
 * em cada consulta de cobrança.
 */
async function policyIndex(
  supabase: Parameters<typeof listLateChargePolicies>[0],
): Promise<Map<string, LateChargePolicy>> {
  const versoes = await listLateChargePolicies(supabase)
  return new Map(versoes.map((v) => [v.id, {
    fee_type:            v.fee_type,
    fee_value:           v.fee_value,
    daily_interest_rate: v.daily_interest_rate,
    grace_period_days:   v.grace_period_days,
    min_amount:          v.min_amount,
  }]))
}

/** A política que ESTA cobrança congelou — nunca a vigente hoje. */
function policyOf(
  index: Map<string, LateChargePolicy>,
  row: { late_charge_policy_id: string | null },
): LateChargePolicy | null {
  return row.late_charge_policy_id ? index.get(row.late_charge_policy_id) ?? null : null
}

/**
 * Cobranças em aberto do cliente, já com encargo aplicado.
 *
 * `amount_due` é o valor a apresentar e a cobrar — não `open_amount`.
 */
export function useOpenCharges(customerId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery<ChargeWithDue[]>({
    queryKey: [KEY.charges, 'open', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const [charges, index] = await Promise.all([
        listOpenCharges(supabase, customerId!),
        policyIndex(supabase),
      ])

      return charges.map((c) => {
        const { accrued, amount_due } = calculateAmountDue(c, policyOf(index, c))
        return { ...c, accrued_total: accrued.total, amount_due }
      })
    },
  })
}

export function useChargeDetail(chargeId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.charges, chargeId],
    enabled: !!chargeId,
    queryFn: async () => {
      const [balance, items, index] = await Promise.all([
        getChargeBalance(supabase, chargeId!),
        listChargeItems(supabase, chargeId!),
        policyIndex(supabase),
      ])

      if (!balance) return null

      const { accrued, amount_due } = calculateAmountDue(balance, policyOf(index, balance))
      return { ...balance, items, accrued, amount_due }
    },
  })
}

/**
 * Listagem do cockpit, com encargo aplicado a cada linha.
 *
 * `amount_due` é o valor a apresentar e a cobrar; `open_amount` é só o
 * principal em aberto.
 */
export function useChargesList() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.charges, 'cockpit'],
    queryFn: async () => {
      const [rows, index] = await Promise.all([
        listChargesForCockpit(supabase),
        policyIndex(supabase),
      ])

      return rows.map((r) => {
        const p = policyOf(index, r)
        const { accrued, amount_due } = calculateAmountDue(r, p)
        // A política vai junto: a tela precisa dela para RECALCULAR o valor
        // quando o operador informa uma data de pagamento retroativa. Sem isso
        // o modal ofereceria o valor de hoje para um recebimento de ontem, e o
        // encargo cobrado seria de dias que não correram.
        return { ...r, accrued_total: accrued.total, amount_due, late_charge_policy: p }
      })
    },
  })
}

/**
 * Resumo do mês corrente para a tela de Relatórios.
 *
 * Aquela tela exibia `monthlyStats` — um objeto LITERAL no código, com
 * R$ 3.850 de receita e 2 contratos ativos — sob o rótulo "Resumo — Agosto de
 * 2026", sem nenhuma marca de que era invenção. Os cards de relatório abaixo
 * dizem "em desenvolvimento" honestamente, o que fazia o resumo parecer
 * justamente a parte pronta.
 *
 * Os números vêm das views agregadas: corretos por construção e sem trazer
 * milhares de linhas para somar no cliente.
 */
export function useMonthlySummary() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.monthlySummary],
    queryFn: async () => {
      const d = new Date()
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

      const [flow, receivables, contracts, fines] = await Promise.all([
        supabase.from('cash_flow_by_month')
          .select('revenue, expense').eq('month', monthStart).maybeSingle(),
        supabase.from('receivables_summary')
          .select('open_count').maybeSingle(),
        supabase.from('rentals')
          .select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('fines')
          .select('amount').gte('infraction_date', monthStart),
      ])

      const revenue  = Number((flow.data as { revenue: number } | null)?.revenue ?? 0)
      const expenses = Number((flow.data as { expense: number } | null)?.expense ?? 0)

      return {
        revenue,
        expenses,
        balance: Number((revenue - expenses).toFixed(2)),
        activeContracts: contracts.count ?? 0,
        pendingCharges: Number(
          (receivables.data as { open_count: number } | null)?.open_count ?? 0,
        ),
        totalFines: ((fines.data ?? []) as { amount: number }[])
          .reduce((s, f) => s + Number(f.amount ?? 0), 0),
      }
    },
  })
}

/** Contas a receber: emitido e não pago. Não inclui cronograma futuro. */
export function useReceivables() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.receivables],
    queryFn: () => listReceivables(supabase),
  })
}

export function useOverdueCharges() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.overdue],
    queryFn: () => listOverdueCharges(supabase),
  })
}

// ============================================================
// Inadimplência
// ============================================================

export type CustomerDelinquencyResult = {
  status: DelinquencyStatus
  overdue_count: number
  max_days_overdue: number
  overdue_amount: number
}

/**
 * Situação do cliente, derivada na leitura.
 *
 * @param manualBlock Bloqueio explícito em `delinquency_blocks` — decisão
 *                    humana, vence a derivação.
 */
export function useCustomerDelinquency(customerId: string | undefined, manualBlock = false) {
  const supabase = useSupabaseContext()

  return useQuery<CustomerDelinquencyResult>({
    queryKey: [KEY.delinquency, customerId, manualBlock],
    enabled: !!customerId,
    queryFn: async () => {
      const [facts, policy] = await Promise.all([
        getCustomerDelinquency(supabase, customerId!),
        getActiveDelinquencyPolicy(supabase, today()),
      ])

      const status = classifyCustomerDelinquency(
        facts,
        policy ?? DEFAULT_DELINQUENCY_POLICY,
        manualBlock,
      )

      return {
        status,
        overdue_count: facts?.overdue_count ?? 0,
        max_days_overdue: facts?.max_days_overdue ?? 0,
        overdue_amount: facts?.overdue_amount ?? 0,
      }
    },
  })
}

export function useDelinquentCustomers() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.delinquency, 'list'],
    queryFn: () => listDelinquentCustomers(supabase),
  })
}

// ============================================================
// Saldos
// ============================================================

export function useDepositBalance(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.deposit, rentalId],
    enabled: !!rentalId,
    queryFn: () => getDepositBalance(supabase, rentalId!),
  })
}

export function useCustomerCreditBalance(customerId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.credit, customerId],
    enabled: !!customerId,
    queryFn: () => getCustomerCreditBalance(supabase, customerId!),
  })
}

// ============================================================
// Veículo, locação e DRE
// ============================================================

export function useVehiclePosition(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.vehicle, vehicleId],
    enabled: !!vehicleId,
    queryFn: () => getVehiclePosition(supabase, vehicleId!),
  })
}

export function useVehiclePositions() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.vehicle, 'list'],
    queryFn: () => listVehiclePositions(supabase),
  })
}

export function useRentalResult(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.rental, rentalId],
    enabled: !!rentalId,
    queryFn: () => getRentalResult(supabase, rentalId!),
  })
}

export function useIncomeStatement(fromPeriod: string, toPeriod: string) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY.dre, fromPeriod, toPeriod],
    queryFn: () => listIncomeStatement(supabase, fromPeriod, toPeriod),
  })
}

// ============================================================
// Cronograma
// ============================================================

/**
 * Cronograma da locação, com a carteira contratada calculada.
 *
 * `contracted_backlog` é o que ainda não virou documento. Métrica legítima —
 * e distinta de contas a receber, que é `useReceivables` (F-10).
 */
/**
 * Previsão do cronograma para um mês, somando os contratos ativos.
 *
 * A soma vem da view: um tenant com 100 contratos semanais tem mais de 5.000
 * linhas de cronograma, e o PostgREST corta em 1.000 sem avisar (ADR 0025).
 * Somar no cliente daria um número menor com cara de número certo.
 *
 * @param month `YYYY-MM`. Ausente, usa o mês corrente.
 */
export function useScheduledForMonth(month?: string) {
  const supabase = useSupabaseContext()
  const alvo = month ?? new Date().toISOString().slice(0, 7)

  return useQuery({
    queryKey: [KEY.schedule, 'month', alvo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_by_month')
        .select('scheduled_amount, scheduled_lines')
        .eq('month', `${alvo}-01`)
        .maybeSingle()

      if (error) throw new Error(`Falha ao ler previsão do cronograma: ${error.message}`)
      const row = data as { scheduled_amount: number; scheduled_lines: number } | null
      return {
        amount: Number(row?.scheduled_amount ?? 0),
        lines:  Number(row?.scheduled_lines ?? 0),
      }
    },
  })
}

export function useRentalSchedule(rentalId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.schedule, rentalId],
    enabled: !!rentalId,
    queryFn: async () => {
      const lines = await listRentalSchedule(supabase, rentalId!)
      return { lines, contracted_backlog: contractedBacklog(lines) }
    },
  })
}

// ============================================================
// Contas a pagar
// ============================================================

/**
 * Despesas da empresa.
 *
 * `company_amount` é derivado do rateio: o que sobra depois da parte do
 * cliente. Guardar os dois seria a mesma denormalização que o redesenho
 * eliminou.
 */
export function usePayables() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: ['payables'],
    queryFn: async () => {
      const rows = await listPayables(supabase)
      return rows.map((p) => ({
        ...p,
        company_amount: Math.round((p.amount - p.customer_amount) * 100) / 100,
      }))
    },
  })
}

// ============================================================
// Gateway
// ============================================================

/**
 * Política de encargo por atraso — todas as versões.
 *
 * A tela de Configurações precisa da vigente para preencher o formulário e das
 * futuras para avisar que há uma agendada. São poucas linhas por tenant: uma
 * por mudança de política na história da empresa.
 */
export function useLateChargePolicies() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: ['late-charge-policies'],
    queryFn: () => listLateChargePolicies(supabase),
  })
}

/**
 * Provedores conectados.
 *
 * Substitui `usePaymentConnection`, que assumia um único provedor por tenant —
 * o `UNIQUE(tenant_id)` de `payment_connections` impedia um segundo (F-13).
 */
export function useProviderAccounts() {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: ['payment-provider-accounts'],
    queryFn: async () => {
      const accounts = await listProviderAccounts(supabase)
      return {
        accounts,
        is_connected: accounts.length > 0,
        default_provider: accounts.find((a) => a.is_default)?.provider ?? null,
      }
    },
  })
}

// ============================================================
// App do cliente
// ============================================================

/**
 * Cobranças do cliente autenticado.
 *
 * Não recebe `customerId`: a RLS já resolve. A política
 * `customer_read_own_charges` filtra por `current_customer_ids()`, então uma
 * consulta simples devolve apenas as cobranças do próprio usuário.
 *
 * `amount_due` vem pronto de `calculateAmountDue`. O app NÃO calcula valor —
 * era exatamente aí que a divergência de F-05 sobrevivia: a tela repetia
 * `original − desconto`, ignorando crédito e encargo, e mostrava um número
 * diferente do cobrado.
 */
export function useMyCharges(onlyOpen = true) {
  const supabase = useSupabaseContext()

  return useQuery<MyChargeRow[]>({
    queryKey: [KEY.charges, 'mine', onlyOpen],
    queryFn: async () => {
      let query = supabase
        .from('charge_balances')
        .select('*')
        .order('due_date', { ascending: true })

      if (onlyOpen) query = query.eq('status', 'open').gt('open_amount', 0)

      const [{ data, error }, index] = await Promise.all([
        query,
        policyIndex(supabase),
      ])

      if (error) throw error

      const rows = (data ?? []) as ChargeBalanceRow[]
      if (rows.length === 0) return []

      // Descrição e placa: o app precisa disso para exibir, e `charge_balances`
      // só agrega valores. Consultas separadas, nunca join na view — juntar
      // itens ali dentro reintroduziria o fan-out de F-01.
      const [itemsRes, rentalsRes] = await Promise.all([
        supabase
          .from('charge_items')
          .select('charge_id, description, amount')
          .in('charge_id', rows.map((r) => r.charge_id)),
        supabase
          .from('rentals')
          .select('id, vehicles(license_plate)')
          .in('id', [...new Set(rows.map((r) => r.rental_id).filter(Boolean))] as string[]),
      ])

      const itemsByCharge = new Map<string, { description: string; amount: number }[]>()
      for (const i of (itemsRes.data ?? []) as { charge_id: string; description: string; amount: number }[]) {
        const list = itemsByCharge.get(i.charge_id) ?? []
        list.push(i)
        itemsByCharge.set(i.charge_id, list)
      }

      type RentalVehicle = {
        id: string
        vehicles: { license_plate: string } | { license_plate: string }[] | null
      }
      const plateByRental = new Map(
        ((rentalsRes.data ?? []) as unknown as RentalVehicle[]).map((r) => {
          const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles
          return [r.id, v?.license_plate ?? null] as const
        }),
      )

      return rows.map((c) => {
        const { accrued, amount_due } = calculateAmountDue(c, policyOf(index, c))
        const items = itemsByCharge.get(c.charge_id) ?? []
        const principal = [...items].sort((a, b) => b.amount - a.amount)[0]

        return {
          ...c,
          accrued_total: accrued.total,
          amount_due,
          description: principal?.description ?? 'Cobrança',
          item_count: items.length,
          vehicle_plate: c.rental_id ? plateByRental.get(c.rental_id) ?? null : null,
        }
      })
    },
  })
}

/** Cobranças em aberto da locação — base da apuração de encerramento (F-08). */
export function useRentalOpenCharges(rentalId: string | undefined) {
  const supabase = useSupabaseContext()

  return useQuery({
    queryKey: [KEY.charges, 'rental-open', rentalId],
    enabled: !!rentalId,
    queryFn: () => listOpenChargesByRental(supabase, rentalId!),
  })
}
