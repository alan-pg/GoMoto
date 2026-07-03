import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { VehiclePhotoSlot } from '@gomoto/core'
import { VehicleForm } from '../../_components/VehicleForm'

export default async function VehicleEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [motoResult, photosResult, obligationsResult, crvDocResult] = await Promise.all([
    supabase.from('vehicles').select('*').eq('id', id).single(),
    supabase.from('vehicle_photos').select('*').eq('vehicle_id', id),
    supabase
      .from('vehicle_obligations')
      .select('*')
      .eq('vehicle_id', id)
      .order('due_date', { ascending: false }),
    supabase
      .from('vehicle_documents')
      .select('*')
      .eq('vehicle_id', id)
      .eq('type', 'crv')
      .eq('is_current', true)
      .maybeSingle(),
  ])

  if (motoResult.error || !motoResult.data) notFound()

  const moto = motoResult.data
  const photos = photosResult.data ?? []
  const obligations = obligationsResult.data ?? []
  const crvDoc = crvDocResult.data ?? null

  const initialPhotoUrls: Partial<Record<VehiclePhotoSlot, string>> = {}
  await Promise.all(
    photos.map(async (photo) => {
      const { data } = await supabase.storage
        .from('vehicle-photos')
        .createSignedUrl(photo.url, 3600)
      if (data?.signedUrl) {
        initialPhotoUrls[photo.slot as VehiclePhotoSlot] = data.signedUrl
      }
    }),
  )

  // Montar mapa de obrigações indexado por tipo (pega a mais recente de cada)
  type ObligationType = 'ipva' | 'licensing' | 'dpvat'
  const oblByType: Record<ObligationType, { amount: string; dueDate: string; status: string } | null> = {
    ipva: null, licensing: null, dpvat: null,
  }
  for (const obl of obligations) {
    const key = obl.type as ObligationType
    if (key in oblByType && !oblByType[key]) {
      oblByType[key] = {
        amount:  obl.amount != null ? String(obl.amount) : '',
        dueDate: obl.due_date ?? '',
        status:  obl.status ?? 'pending',
      }
    }
  }

  return (
    <VehicleForm
      vehicleId={id}
      initialData={{
        ...moto,
        // injeta campos do CRV doc para o form
        crv_number:       crvDoc?.document_number ?? '',
        crv_exercise_year: crvDoc?.exercise_year ? String(crvDoc.exercise_year) : '',
      }}
      initialPhotoUrls={initialPhotoUrls}
      initialObligations={oblByType}
    />
  )
}
