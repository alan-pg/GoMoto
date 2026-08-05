import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listMaintenancePlans,
  getMaintenancePlanWithItems,
} from '../repositories/maintenancePlans'

const KEY = 'maintenance_plans'

export function useMaintenancePlans() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listMaintenancePlans(supabase) })
}

export function useMaintenancePlan(planId: string | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, planId],
    queryFn: () => getMaintenancePlanWithItems(supabase, planId as string),
    enabled: !!planId,
  })
}
