import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listVehicleInspectionHistory, listInspectionsByRental } from '../repositories/inspections'
import { listInspectionSchedulesByRental, getInspectionScheduleWithContext } from '../repositories/inspectionSchedules'

const KEY = 'inspections-history'

/** Histórico agregado de vistorias de um veículo, através de todas as suas locações (RF-023). */
export function useVehicleInspectionHistory(vehicleId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'vehicle', vehicleId],
    queryFn: () => listVehicleInspectionHistory(supabase, vehicleId as string),
    enabled: !!vehicleId,
  })
}

/** Vistorias de check-in/check-out + periódicas de uma locação específica. */
export function useRentalInspections(rentalId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'rental', rentalId],
    queryFn: () => listInspectionsByRental(supabase, rentalId as string),
    enabled: !!rentalId,
  })
}

/** Agendamentos de vistoria periódica de uma locação, com status derivado (pending/overdue/...). */
export function useRentalInspectionSchedules(rentalId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'rental-schedules', rentalId],
    queryFn: () => listInspectionSchedulesByRental(supabase, rentalId as string),
    enabled: !!rentalId,
  })
}

/** Um agendamento específico com contexto — usado quando ainda não há vistoria submetida para visualizar. */
export function useInspectionSchedule(scheduleId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'schedule', scheduleId],
    queryFn: () => getInspectionScheduleWithContext(supabase, scheduleId as string),
    enabled: !!scheduleId,
  })
}
