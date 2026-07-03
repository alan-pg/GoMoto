import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { MaintenancePlan, MaintenancePlanItem } from '@gomoto/core'
import { PlanForm } from '../../_components/PlanForm'

export default async function EditMaintenancePlanPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [planResult, itemsResult] = await Promise.all([
    supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('maintenance_plan_items')
      .select('*')
      .eq('plan_id', id)
      .order('sort_order', { ascending: true }),
  ])

  if (!planResult.data) notFound()

  const plan  = planResult.data as MaintenancePlan
  const items = (itemsResult.data ?? []) as MaintenancePlanItem[]

  return (
    <PlanForm
      planId={id}
      initialPlan={{
        name:        plan.name,
        description: plan.description ?? null,
        is_default:  plan.is_default,
        archived_at: plan.archived_at ?? null,
      }}
      initialItems={items}
    />
  )
}
