import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listActionablePendingInspections,
  listInspectionSchedulesAwaitingCustomer,
} from '../repositories/inspections'

const KEY = 'inspections-pending'

/**
 * Lista central de pendências (RF-017): vistorias de check-in/check-out
 * pendentes + periódicas submetidas aguardando análise (`actionable` — o
 * administrativo pode agir), e agendamentos periódicos ainda não submetidos
 * pelo cliente (`awaitingClient` — apenas visibilidade, RN-011).
 */
export function usePendingInspections() {
  const supabase = useSupabaseContext()

  const actionable = useQuery({
    queryKey: [KEY, 'actionable'],
    queryFn: () => listActionablePendingInspections(supabase),
  })

  const awaitingClient = useQuery({
    queryKey: [KEY, 'awaiting-client'],
    queryFn: () => listInspectionSchedulesAwaitingCustomer(supabase),
  })

  return { actionable, awaitingClient }
}
