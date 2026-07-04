import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { FineForm } from '../../_components/FineForm'

export default async function FineEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase  = await createClient()
  const tenantId  = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const { data, error } = await supabase
    .from('fines')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) notFound()

  return <FineForm fineId={id} initialData={data} />
}
