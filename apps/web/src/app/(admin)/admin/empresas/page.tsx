import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { EmpresasClient, type TenantRow } from './EmpresasClient'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  await requirePlatformAdmin()
  const supabase = await createClient()

  // platform_admin_read_all_tenants policy: vê TODOS, ativos e suspensos.
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('name', { ascending: true })

  const tenants: TenantRow[] = (data ?? []) as unknown as TenantRow[]

  return <EmpresasClient initialTenants={tenants} loadError={error?.message ?? null} />
}
