import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaintenancePlan, MaintenancePlanItem } from '@gomoto/core'

/**
 * Lista planos do tenant atual (filtro automático por RLS) ordenados por
 * default primeiro, depois alfabético. Inclui arquivados — chamador filtra
 * se quiser. F2.1 usa esta listagem como visão "todos os planos".
 */
export async function listMaintenancePlans(client: SupabaseClient): Promise<MaintenancePlan[]> {
  const { data, error } = await client
    .from('maintenance_plans')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as MaintenancePlan[]
}

/**
 * Carrega um plano com seus itens. Itens vêm ordenados por `sort_order` para
 * preservar a sequência que o operador definiu na criação.
 */
export async function getMaintenancePlanWithItems(
  client: SupabaseClient,
  planId: string,
): Promise<MaintenancePlan | null> {
  const { data: plan, error: planErr } = await client
    .from('maintenance_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()
  if (planErr) throw planErr
  if (!plan) return null

  const { data: items, error: itemsErr } = await client
    .from('maintenance_plan_items')
    .select('*')
    .eq('plan_id', planId)
    .order('sort_order', { ascending: true })
  if (itemsErr) throw itemsErr

  return { ...(plan as MaintenancePlan), items: (items ?? []) as MaintenancePlanItem[] }
}
