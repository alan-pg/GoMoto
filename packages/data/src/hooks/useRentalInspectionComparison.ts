import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listInspectionsByRental } from '../repositories/inspections'
import type { Inspection } from '@gomoto/core'

/** Comparação lado a lado check-in × check-out de uma locação encerrada (RF-022). */
export function useRentalInspectionComparison(rentalId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: ['inspections-comparison', rentalId],
    queryFn: async (): Promise<{ checkin: Inspection | null; checkout: Inspection | null }> => {
      const all = await listInspectionsByRental(supabase, rentalId as string)
      return {
        checkin: all.find((i) => i.kind === 'checkin') ?? null,
        checkout: all.find((i) => i.kind === 'checkout') ?? null,
      }
    },
    enabled: !!rentalId,
  })
}
