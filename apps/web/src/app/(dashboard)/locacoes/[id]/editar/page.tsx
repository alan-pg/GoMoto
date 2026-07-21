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

  const [rentalResult, depositResult] = await Promise.all([
    supabase
      .from('rentals')
      .select('*, customer:customers(id,name), vehicle:vehicles(id,license_plate,make,model)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('deposits')
      .select('amount')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'received')
      .maybeSingle(),
  ])

  if (rentalResult.error || !rentalResult.data) notFound()

  const depositAmount = (depositResult.data as { amount: number } | null)?.amount ?? null

  return (
    <RentalForm
      rentalId={id}
      initialData={{ ...rentalResult.data, security_deposit: depositAmount }}
    />
  )
}
