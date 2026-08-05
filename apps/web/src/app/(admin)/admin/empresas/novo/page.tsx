import { requirePlatformAdmin } from '@/lib/auth/platform'
import { TenantForm } from '../_components/TenantForm'

export default async function NovaEmpresaPage() {
  await requirePlatformAdmin()
  return <TenantForm mode="create" />
}
