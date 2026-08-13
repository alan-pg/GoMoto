import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  calculateLateCharges,
  calculateVehicleROI,
} from '@gomoto/core'
import type {
  LateChargeConfig,
  BillingWithCharges,
  FinancialDashboard,
  OverdueBillingSummary,
  VehicleROI,
  VehicleCostsByCategory,
  RentalFinancialSummary,
  CustomerCredit,
  Deposit,
  DepositMovement,
} from '@gomoto/core'

// ============================================================
// Detalhe de cobrança com encargos calculados on-the-fly
// ============================================================

type BillingDetailRow = {
  id: string
  original_amount: number
  discount_amount: number | null
  credit_applied: number | null
  charges_waived: boolean
  late_charge_config: LateChargeConfig | null
  status: string
  due_date: string
  payments?: { id: string; amount: number; paid_at: string; payment_method: string }[] | null
  late_charges?: { fee: number; interest: number; total: number; captured_at: string }[] | null
}

export function useBillingDetail(billingId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery<BillingWithCharges>({
    queryKey: ['billing-detail', billingId],
    enabled: !!billingId,
    queryFn: async () => {
      const { data: raw, error } = await supabase
        .from('billings')
        .select(
          'id, original_amount, discount_amount, credit_applied, charges_waived, late_charge_config, status, due_date,' +
          'payments!billing_id(id, amount, paid_at, payment_method),' +
          'late_charges!billing_id(fee, interest, total, captured_at)',
        )
        .eq('id', billingId!)
        .single()

      if (error) throw error

      const data = raw as unknown as BillingDetailRow
      const baseAmount = (data.original_amount ?? 0) - (data.discount_amount ?? 0)
      const status = data.status as BillingWithCharges['status']
      const snapshot = data.late_charges

      let charges: BillingWithCharges['charges'] = null
      if (data.charges_waived) {
        charges = null
      } else if (snapshot?.[0]) {
        charges = {
          grace_period_active: false,
          fee: snapshot[0].fee,
          interest: snapshot[0].interest,
          total: snapshot[0].total,
          days_since_due: 0,
          days_overdue: 0,
        }
      } else if (status === 'pending' || status === 'overdue') {
        charges = calculateLateCharges(data.late_charge_config, baseAmount, data.due_date)
      }

      const chargesTotal = charges?.grace_period_active ? 0 : (charges?.total ?? 0)
      const amountDue = Math.max(0, baseAmount + chargesTotal - (data.credit_applied ?? 0))

      return {
        id: data.id,
        original_amount: data.original_amount ?? 0,
        discount_amount: data.discount_amount ?? 0,
        credit_applied: data.credit_applied ?? 0,
        charges_waived: data.charges_waived ?? false,
        late_charge_config: data.late_charge_config,
        status,
        due_date: data.due_date,
        charges,
        amount_due: amountDue,
      }
    },
  })
}

// ============================================================
// Painel financeiro mensal
// ============================================================

type OverdueBillingRow = {
  id: string
  original_amount: number
  discount_amount: number | null
  due_date: string
  customers?: { name: string } | null
  rentals?: { vehicles?: { license_plate: string } | null } | null
}

export function useFinancialDashboard(month: string) {
  const supabase = useSupabaseContext()
  return useQuery<FinancialDashboard>({
    queryKey: ['financial-dashboard', month],
    queryFn: async () => {
      // Índices explícitos: sob `noUncheckedIndexedAccess`, desestruturar
      // produz `number | undefined`.
      const parts = month.split('-')
      const year = Number(parts[0])
      const mon = Number(parts[1])
      const firstDay = `${month}-01`
      const lastDay = new Date(year, mon, 0).toISOString().split('T')[0]!

      const [overdueRes, receivableRes, receivedRes, expensesRes] = await Promise.all([
        supabase
          .from('billings')
          .select(
            'id, original_amount, discount_amount, due_date,' +
            'customers!customer_id(name),' +
            'rentals!lease_id(vehicles!vehicle_id(license_plate))',
          )
          .eq('status', 'overdue')
          .order('due_date', { ascending: true }),
        supabase
          .from('billings')
          .select('original_amount, discount_amount')
          .gte('due_date', firstDay)
          .lte('due_date', lastDay)
          .in('status', ['pending', 'overdue']),
        supabase
          .from('payments')
          .select('amount')
          .gte('paid_at', `${firstDay}T00:00:00.000Z`)
          .lte('paid_at', `${lastDay}T23:59:59.999Z`),
        supabase
          .from('expenses')
          .select('amount')
          .gte('date', firstDay)
          .lte('date', lastDay)
          .eq('payment_status', 'paid'),
      ])

      const today = new Date()
      const overdueBillings: OverdueBillingSummary[] = (
        (overdueRes.data ?? []) as unknown as OverdueBillingRow[]
      ).map((b) => {
        const due = new Date(b.due_date)
        const daysSince = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000))
        return {
          billing_id: b.id,
          customer_name: b.customers?.name ?? '',
          vehicle_license_plate: b.rentals?.vehicles?.license_plate ?? '',
          amount: (b.original_amount ?? 0) - (b.discount_amount ?? 0),
          days_overdue: daysSince,
          due_date: b.due_date,
        }
      })

      const receivable = (receivableRes.data ?? []) as { original_amount: number; discount_amount: number | null }[]
      const monthReceivable = receivable.reduce(
        (s, b) => s + (b.original_amount ?? 0) - (b.discount_amount ?? 0),
        0,
      )
      const monthReceived = ((receivedRes.data ?? []) as { amount: number }[]).reduce(
        (s, p) => s + (p.amount ?? 0),
        0,
      )
      const monthExpenses = ((expensesRes.data ?? []) as { amount: number }[]).reduce(
        (s, e) => s + (e.amount ?? 0),
        0,
      )

      return {
        overdue_billings: overdueBillings,
        month_receivable: monthReceivable,
        month_received: monthReceived,
        month_revenue: monthReceived,
        month_expenses: monthExpenses,
        month_result: monthReceived - monthExpenses,
      }
    },
  })
}

// ============================================================
// Histórico financeiro e ROI do veículo
// ============================================================

export function useVehicleFinancialHistory(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery<VehicleROI>({
    queryKey: ['vehicle-financial-history', vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const [vehicleRes, rentalsRes, costSummaryRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, acquisition_value, sold_at, sale_value')
          .eq('id', vehicleId!)
          .single(),
        supabase.from('rentals').select('id').eq('vehicle_id', vehicleId!),
        supabase
          .from('vehicle_cost_summary')
          .select('maintenance_cost, fines_company_paid, expenses_paid, obligations_paid')
          .eq('vehicle_id', vehicleId!)
          .maybeSingle(),
      ])

      if (vehicleRes.error) throw vehicleRes.error

      const vehicle = vehicleRes.data as unknown as {
        id: string
        acquisition_value: number | null
        sold_at: string | null
        sale_value: number | null
      }

      const rentalIds = ((rentalsRes.data ?? []) as { id: string }[]).map((r) => r.id)
      let revenues = 0
      if (rentalIds.length > 0) {
        const { data: billings } = await supabase
          .from('billings')
          .select('original_amount, discount_amount, credit_applied')
          .in('lease_id', rentalIds)
          .eq('status', 'paid')
        revenues = (
          (billings ?? []) as { original_amount: number; discount_amount: number | null; credit_applied: number | null }[]
        ).reduce(
          (s, b) => s + (b.original_amount ?? 0) - (b.discount_amount ?? 0) - (b.credit_applied ?? 0),
          0,
        )
      }

      const cs = costSummaryRes.data as unknown as {
        maintenance_cost: number
        fines_company_paid: number
        expenses_paid: number
        obligations_paid: number
      } | null

      const costsByCategory: VehicleCostsByCategory = {
        maintenance: cs?.maintenance_cost ?? 0,
        insurance: 0,
        documentation: cs?.obligations_paid ?? 0,
        other: (cs?.expenses_paid ?? 0) + (cs?.fines_company_paid ?? 0),
      }

      const { net_result, roi, total_costs } = calculateVehicleROI(
        vehicle.acquisition_value,
        revenues,
        costsByCategory,
        vehicle.sale_value,
      )

      return {
        vehicle_id: vehicleId!,
        acquisition_value: vehicle.acquisition_value,
        revenues,
        costs_by_category: costsByCategory,
        total_costs,
        sale_value: vehicle.sale_value,
        net_result,
        roi,
      }
    },
  })
}

// ============================================================
// Resumo financeiro da locação
// ============================================================

type BillingSummaryRow = {
  id: string
  original_amount: number
  discount_amount: number | null
  credit_applied: number | null
  status: string
}

export function useRentalFinancialSummary(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery<RentalFinancialSummary>({
    queryKey: ['rental-financial-summary', rentalId],
    enabled: !!rentalId,
    queryFn: async () => {
      const [billingsRes, depositRes, adjustmentsRes] = await Promise.all([
        supabase
          .from('billings')
          .select('id, original_amount, discount_amount, credit_applied, status')
          .eq('lease_id', rentalId!),
        supabase
          .from('deposits')
          .select('id, amount, balance, status, received_at, closed_at, deposit_movements(*)')
          .eq('rental_id', rentalId!)
          .neq('status', 'fully_returned')
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('rental_adjustments')
          .select('*')
          .eq('rental_id', rentalId!)
          .order('adjusted_at', { ascending: false }),
      ])

      const billings = ((billingsRes.data ?? []) as unknown as BillingSummaryRow[])
      const active = billings.filter((b) => b.status !== 'cancelled')
      const paid = active.filter((b) => b.status === 'paid')
      const pending = active.filter((b) => b.status === 'pending' || b.status === 'overdue')

      const net = (b: BillingSummaryRow) =>
        (b.original_amount ?? 0) - (b.discount_amount ?? 0) - (b.credit_applied ?? 0)

      const totalBilled = active.reduce((s, b) => s + net(b), 0)
      const totalReceived = paid.reduce((s, b) => s + net(b), 0)
      const pendingBalance = pending.reduce((s, b) => s + net(b), 0)
      const creditsApplied = active.reduce((s, b) => s + (b.credit_applied ?? 0), 0)

      const dep = depositRes.data as unknown as (Deposit & { deposit_movements: DepositMovement[] }) | null

      return {
        rental_id: rentalId!,
        total_billed: totalBilled,
        total_received: totalReceived,
        pending_balance: pendingBalance,
        accumulated_charges: 0,
        deposit: dep
          ? { amount: dep.amount, balance: dep.balance, status: dep.status }
          : null,
        credits_applied: creditsApplied,
        adjustments: ((adjustmentsRes.data ?? []) as unknown as RentalFinancialSummary['adjustments']),
      }
    },
  })
}

// ============================================================
// Créditos do cliente
// ============================================================

export function useCustomerCredits(customerId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery<CustomerCredit[]>({
    queryKey: ['customer-credits', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_credits')
        .select('*, credit_applications(*)')
        .eq('customer_id', customerId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return ((data ?? []) as unknown as CustomerCredit[])
    },
  })
}

// ============================================================
// Histórico de caução da locação
// ============================================================

export function useDepositHistory(rentalId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery<(Deposit & { movements: DepositMovement[] }) | null>({
    queryKey: ['deposit-history', rentalId],
    enabled: !!rentalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits')
        .select('*, deposit_movements(*)')
        .eq('rental_id', rentalId!)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      if (!data) return null

      const row = data as unknown as Deposit & { deposit_movements: DepositMovement[] }
      return { ...row, movements: row.deposit_movements ?? [] }
    },
  })
}
