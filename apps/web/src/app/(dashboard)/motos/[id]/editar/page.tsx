import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { VehiclePhotoSlot, VehicleStatus } from '@gomoto/core'
import VehicleEditForm from './_components/VehicleEditForm'

export default async function VehicleEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [motoResult, photosResult] = await Promise.all([
    supabase.from('motorcycles').select('*').eq('id', id).single(),
    supabase.from('vehicle_photos').select('*').eq('motorcycle_id', id),
  ])

  if (motoResult.error || !motoResult.data) notFound()

  const moto = motoResult.data
  const photos = photosResult.data ?? []

  // Gerar URLs assinadas em paralelo
  const photoUrls: Partial<Record<VehiclePhotoSlot, string>> = {}
  await Promise.all(
    photos.map(async (photo) => {
      const { data } = await supabase.storage
        .from('vehicle-photos')
        .createSignedUrl(photo.url, 3600)
      if (data?.signedUrl) {
        photoUrls[photo.slot as VehiclePhotoSlot] = data.signedUrl
      }
    }),
  )

  return (
    <VehicleEditForm
      motorcycleId={id}
      moto={moto}
      initialPhotoUrls={photoUrls}
      currentStatus={moto.status as VehicleStatus}
    />
  )
}
