import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listInspectionProfiles,
  getInspectionProfileWithItems,
  getPeriodicInspectionProfileForRental,
} from '../repositories/inspectionProfiles'

const KEY = 'inspection-profiles'

/** Perfis de Vistoria do tenant atual (RLS já escopa). Inclui arquivados. */
export function useInspectionProfiles() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listInspectionProfiles(supabase) })
}

/** Um perfil com seus itens de checklist e de imagem — usado no formulário de edição. */
export function useInspectionProfile(profileId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: () => getInspectionProfileWithItems(supabase, profileId as string),
    enabled: !!profileId,
  })
}

/** Perfil de Vistoria Periódica de uma locação — usado no formulário do app do cliente. */
export function usePeriodicInspectionProfileForRental(rentalId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: [KEY, 'rental', rentalId],
    queryFn: () => getPeriodicInspectionProfileForRental(supabase, rentalId as string),
    enabled: !!rentalId,
  })
}
