import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InspectionProfile,
  InspectionProfileChecklistItem,
  InspectionProfilePhotoItem,
} from '@gomoto/core'

/**
 * Lista perfis do tenant atual (filtro automático por RLS), ativos primeiro,
 * depois alfabético. Inclui arquivados — chamador filtra se quiser (mesmo
 * padrão de `listMaintenancePlans`).
 */
export async function listInspectionProfiles(client: SupabaseClient): Promise<InspectionProfile[]> {
  const { data, error } = await client
    .from('inspection_profiles')
    .select('*')
    .order('archived_at', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as InspectionProfile[]
}

/** Carrega um perfil com seus itens de checklist e de imagem, ordenados por sort_order. */
export async function getInspectionProfileWithItems(
  client: SupabaseClient,
  profileId: string,
): Promise<InspectionProfile | null> {
  const { data: profile, error: profileErr } = await client
    .from('inspection_profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle()
  if (profileErr) throw profileErr
  if (!profile) return null

  const [checklistResult, photoResult] = await Promise.all([
    client
      .from('inspection_profile_checklist_items')
      .select('*')
      .eq('profile_id', profileId)
      .order('sort_order', { ascending: true }),
    client
      .from('inspection_profile_photo_items')
      .select('*')
      .eq('profile_id', profileId)
      .order('sort_order', { ascending: true }),
  ])
  if (checklistResult.error) throw checklistResult.error
  if (photoResult.error) throw photoResult.error

  return {
    ...(profile as InspectionProfile),
    checklist_items: (checklistResult.data ?? []) as InspectionProfileChecklistItem[],
    photo_items: (photoResult.data ?? []) as InspectionProfilePhotoItem[],
  }
}

/**
 * Perfil de Vistoria Periódica vinculado a uma locação — usado pelo app do
 * cliente para montar o formulário de execução (RF-016). RLS
 * (`customer_self_select_inspection_profiles*`) já restringe a leitura ao
 * perfil da própria locação do cliente autenticado.
 */
export async function getPeriodicInspectionProfileForRental(
  client: SupabaseClient,
  rentalId: string,
): Promise<InspectionProfile | null> {
  const { data: rental, error } = await client
    .from('rentals')
    .select('periodic_inspection_profile_id')
    .eq('id', rentalId)
    .maybeSingle()
  if (error) throw error
  if (!rental?.periodic_inspection_profile_id) return null
  return getInspectionProfileWithItems(client, rental.periodic_inspection_profile_id)
}
