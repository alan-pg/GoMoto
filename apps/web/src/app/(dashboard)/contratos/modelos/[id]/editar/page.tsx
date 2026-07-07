import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { ContractTemplate } from '@gomoto/core'
import { EditTemplateForm } from './_components/EditTemplateForm'

export default async function EditarModeloPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const { data, error } = await supabase
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) notFound()

  return <EditTemplateForm template={data as ContractTemplate} />
}
