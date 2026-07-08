import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { RentalForm } from '../../_components/RentalForm'

export default async function EditRentalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase  = await createClient()
  const tenantId  = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const { data, error } = await supabase
    .from('rentals')
    .select('*, customer:customers(id,name), vehicle:vehicles(id,license_plate,make,model)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !data) notFound()

  return <RentalForm rentalId={id} initialData={data} />
}
