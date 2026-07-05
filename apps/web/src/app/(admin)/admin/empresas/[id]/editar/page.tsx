import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { TenantForm } from '../../_components/TenantForm'

export default async function EmpresaEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase } = await requirePlatformAdmin()

  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) notFound()

  return (
    <TenantForm
      mode="edit"
      tenantId={id}
      initialData={{
        id: data.id,
        name: data.name ?? '',
        slug: data.slug ?? '',
        legal_name: data.legal_name ?? '',
        cnpj: data.cnpj ?? '',
        contact_email: data.contact_email ?? '',
        contact_phone: data.contact_phone ?? '',
        address_zip: data.address_zip ?? '',
        address_street: data.address_street ?? '',
        address_number: data.address_number ?? '',
        address_complement: data.address_complement ?? '',
        address_district: data.address_district ?? '',
        address_city: data.address_city ?? '',
        address_state: data.address_state ?? '',
      }}
    />
  )
}
