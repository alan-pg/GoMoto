import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { EmpresasListClient } from './_components/EmpresasListClient'

export const dynamic = 'force-dynamic'

export type TenantRow = {
  id: string
  name: string
  slug: string
  legal_name: string | null
  cnpj: string | null
  contact_email: string | null
  contact_phone: string | null
  address_zip: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_district: string | null
  address_city: string | null
  address_state: string | null
  suspended_at: string | null
  suspended_reason: string | null
  created_at: string
}

export default async function EmpresasPage() {
  await requirePlatformAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('name', { ascending: true })

  const tenants: TenantRow[] = (data ?? []) as unknown as TenantRow[]

  return <EmpresasListClient tenants={tenants} loadError={error?.message ?? null} />
}
