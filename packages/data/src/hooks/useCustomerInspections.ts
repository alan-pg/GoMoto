import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listPendingInspectionSchedulesForCustomer } from '../repositories/inspectionSchedules'
import { listPeriodicInspectionsForCustomer } from '../repositories/inspections'

const KEY = 'inspections-customer'

/**
 * Agendamentos de vistoria periódica pendentes/atrasados/rejeitados do
 * cliente autenticado (RLS já escopa às próprias locações). Alimenta a tela
 * de vistoria periódica do app mobile (RF-016, RF-021).
 */
export function usePendingInspectionSchedulesForCustomer() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'pending-schedules'],
    queryFn: () => listPendingInspectionSchedulesForCustomer(supabase),
    staleTime: 60 * 1000,
  })
}

/** Histórico de vistorias periódicas (todos os status) do cliente autenticado — RF-021/RN-010. */
export function usePeriodicInspectionsForCustomer() {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'history'],
    queryFn: () => listPeriodicInspectionsForCustomer(supabase),
    staleTime: 60 * 1000,
  })
}
