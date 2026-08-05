import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listVehicleCostSummary,
  getVehicleCostSummary,
  listVehicleFinancialEvents,
} from '../repositories/vehicleCosts'

const SUMMARY_KEY = 'vehicle_cost_summary'
const EVENTS_KEY = 'vehicle_financial_events'

export function useVehicleCostSummaryList() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [SUMMARY_KEY],
    queryFn: () => listVehicleCostSummary(supabase),
  })
}

export function useVehicleCostSummary(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [SUMMARY_KEY, vehicleId],
    queryFn: () => getVehicleCostSummary(supabase, vehicleId!),
    enabled: !!vehicleId,
  })
}

export function useVehicleFinancialEvents(vehicleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [EVENTS_KEY, vehicleId],
    queryFn: () => listVehicleFinancialEvents(supabase, vehicleId!),
    enabled: !!vehicleId,
  })
}
