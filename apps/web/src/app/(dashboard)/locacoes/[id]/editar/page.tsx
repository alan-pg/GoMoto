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

  const [rentalResult, depositResult, downPaymentResult] = await Promise.all([
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
      .in('status', ['pending', 'received'])
      .maybeSingle(),
    supabase
      .from('billings')
      .select('original_amount, status, due_date')
      .eq('lease_id', id)
      .eq('tenant_id', tenantId)
      .eq('billing_type', 'down_payment')
      .maybeSingle(),
  ])

  if (rentalResult.error || !rentalResult.data) notFound()

  const depositAmount = (depositResult.data as { amount: number } | null)?.amount ?? null
  const downPayment = downPaymentResult.data as { original_amount: number; status: string; due_date: string } | null

  return (
    <RentalForm
      rentalId={id}
      initialData={{
        ...rentalResult.data,
        security_deposit:      depositAmount,
        down_payment:          downPayment?.original_amount ?? null,
        down_payment_status:   downPayment?.status ?? null,
        down_payment_due_date: downPayment?.due_date ?? null,
      }}
    />
  )
}
