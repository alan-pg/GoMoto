import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listMotorcycleCostSummary,
  getMotorcycleCostSummary,
  listMotorcycleFinancialEvents,
} from '../repositories/motorcycleCosts'

const SUMMARY_KEY = 'motorcycle_cost_summary'
const EVENTS_KEY = 'motorcycle_financial_events'

export function useMotorcycleCostSummaryList() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [SUMMARY_KEY],
    queryFn: () => listMotorcycleCostSummary(supabase),
  })
}

export function useMotorcycleCostSummary(motorcycleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [SUMMARY_KEY, motorcycleId],
    queryFn: () => getMotorcycleCostSummary(supabase, motorcycleId!),
    enabled: !!motorcycleId,
  })
}

export function useMotorcycleFinancialEvents(motorcycleId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [EVENTS_KEY, motorcycleId],
    queryFn: () => listMotorcycleFinancialEvents(supabase, motorcycleId!),
    enabled: !!motorcycleId,
  })
}
