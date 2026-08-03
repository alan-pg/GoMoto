import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { InspectionProfile, InspectionProfileChecklistItem, InspectionProfilePhotoItem } from '@gomoto/core'
import { InspectionProfileForm } from '../../_components/InspectionProfileForm'

export default async function EditInspectionProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [profileResult, checklistResult, photoResult] = await Promise.all([
    supabase.from('inspection_profiles').select('*').eq('id', id).maybeSingle(),
    supabase.from('inspection_profile_checklist_items').select('*').eq('profile_id', id).order('sort_order', { ascending: true }),
    supabase.from('inspection_profile_photo_items').select('*').eq('profile_id', id).order('sort_order', { ascending: true }),
  ])
  if (!profileResult.data) notFound()

  const profile: InspectionProfile = {
    ...(profileResult.data as InspectionProfile),
    checklist_items: (checklistResult.data ?? []) as InspectionProfileChecklistItem[],
    photo_items: (photoResult.data ?? []) as InspectionProfilePhotoItem[],
  }

  return <InspectionProfileForm profileId={id} initialProfile={profile} />
}
