import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { RentalForm } from '../_components/RentalForm'

export default async function NovaLocacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  const { customer_id } = await searchParams

  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  const { data: tenant } = tenantId
    ? await supabase.from('tenants').select('name, legal_name').eq('id', tenantId).single()
    : { data: null }
  const tenantName = tenant?.legal_name ?? tenant?.name ?? ''

  return <RentalForm defaultCustomerId={customer_id} tenantName={tenantName} />
}
