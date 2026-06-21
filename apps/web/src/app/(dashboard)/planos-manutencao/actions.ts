/**
 * @file src/app/(dashboard)/planos-manutencao/actions.ts
 * @description Server Actions de mutação de planos de manutenção (PRD 0003 F2.2a).
 *
 * Padrão da casa (ADR 0002): actions co-localizadas com a tela, validação Zod
 * no servidor, `logAction()` em toda mutação, `revalidatePath` no fim.
 *
 * Trocar plano default é transacional via RPC `set_default_maintenance_plan` —
 * o índice parcial único impede dois defaults ativos coexistirem, então a
 * troca tem que zerar o anterior na mesma transação.
 */

'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { MaintenancePlanSchema, MaintenancePlanItemSchema } from '@gomoto/core'
import { z } from 'zod'

async function getAuthenticatedUser() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// ── Plans ──────────────────────────────────────────────────────────────────

export async function createMaintenancePlan(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = MaintenancePlanSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const wantsDefault = parsed.data.is_default === true

  const { data, error } = await supabase
    .from('maintenance_plans')
    .insert({
      tenant_id: tenantId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      // is_default só sai true depois — primeiro inserimos sem ele, depois usamos
      // setDefaultMaintenancePlan que limpa o anterior na mesma transação.
      is_default: false,
    })
    .select()
    .single()

  if (error) return { error: 'Erro ao criar plano' }

  await logAction({ action: 'create', table: 'maintenance_plans', recordId: data.id, newData: data })

  if (wantsDefault) {
    const res = await setDefaultMaintenancePlan(data.id)
    if (res.error) {
      revalidatePath('/planos-manutencao')
      return { data, warning: res.error }
    }
  }

  revalidatePath('/planos-manutencao')
  return { data }
}

export async function updateMaintenancePlan(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = MaintenancePlanSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('maintenance_plans').select().eq('id', id).single()
  if (!before) return { error: 'Plano não encontrado' }

  const wantsDefault = parsed.data.is_default === true && before.is_default !== true
  const payload: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) payload.name = parsed.data.name
  if (parsed.data.description !== undefined) payload.description = parsed.data.description ?? null
  // is_default tratado separadamente abaixo (mesma razão do create).

  let updated = before
  if (Object.keys(payload).length > 0) {
    const { data, error } = await supabase
      .from('maintenance_plans')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) return { error: 'Erro ao atualizar plano' }
    updated = data
    await logAction({ action: 'update', table: 'maintenance_plans', recordId: id, oldData: before, newData: data })
  }

  if (wantsDefault) {
    const res = await setDefaultMaintenancePlan(id)
    if (res.error) {
      revalidatePath('/planos-manutencao')
      return { data: updated, warning: res.error }
    }
  }

  revalidatePath('/planos-manutencao')
  return { data: updated }
}

/**
 * Marca um plano como default e zera o default anterior do tenant na mesma
 * sequência. Como o índice parcial único só permite 1 default ativo, fazemos
 * o `is_default=false` no anterior PRIMEIRO, depois `is_default=true` no novo.
 *
 * Idealmente isso seria uma RPC SQL para garantir atomicidade — F2.2b ou F3
 * pode migrar pra função do banco se houver corrida observada.
 */
export async function setDefaultMaintenancePlan(planId: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const { data: target } = await supabase
    .from('maintenance_plans')
    .select('id, tenant_id, archived_at, is_default')
    .eq('id', planId)
    .single()
  if (!target) return { error: 'Plano não encontrado' }
  if (target.archived_at) return { error: 'Não é possível tornar default um plano arquivado' }
  if (target.is_default) return { data: target }

  // Zera default anterior (se houver) no mesmo tenant.
  const { error: clearErr } = await supabase
    .from('maintenance_plans')
    .update({ is_default: false })
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .is('archived_at', null)
  if (clearErr) return { error: 'Erro ao zerar default anterior' }

  const { data, error } = await supabase
    .from('maintenance_plans')
    .update({ is_default: true })
    .eq('id', planId)
    .select()
    .single()
  if (error) return { error: 'Erro ao marcar como default' }

  await logAction({ action: 'update', table: 'maintenance_plans', recordId: planId, newData: { is_default: true } })
  revalidatePath('/planos-manutencao')
  return { data }
}

export async function archiveMaintenancePlan(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('maintenance_plans').select().eq('id', id).single()
  if (!before) return { error: 'Plano não encontrado' }
  if (before.archived_at) return { data: before }

  const { data, error } = await supabase
    .from('maintenance_plans')
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq('id', id)
    .select()
    .single()
  if (error) return { error: 'Erro ao arquivar plano' }

  await logAction({ action: 'update', table: 'maintenance_plans', recordId: id, oldData: before, newData: data })
  revalidatePath('/planos-manutencao')
  return { data }
}

export async function unarchiveMaintenancePlan(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('maintenance_plans').select().eq('id', id).single()
  if (!before) return { error: 'Plano não encontrado' }
  if (!before.archived_at) return { data: before }

  const { data, error } = await supabase
    .from('maintenance_plans')
    .update({ archived_at: null })
    .eq('id', id)
    .select()
    .single()
  if (error) return { error: 'Erro ao desarquivar plano' }

  await logAction({ action: 'update', table: 'maintenance_plans', recordId: id, oldData: before, newData: data })
  revalidatePath('/planos-manutencao')
  return { data }
}

/**
 * Clona o plano + itens para um novo registro (PRD 0003 §7.1). Útil pra
 * partir de um plano existente e ajustar pontos sem refazer do zero. O clone
 * nunca herda `is_default` — o operador escolhe depois se vai promover.
 */
export async function cloneMaintenancePlan(sourceId: string, newName: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const trimmed = newName.trim()
  if (!trimmed) return { error: 'Nome do novo plano é obrigatório' }
  if (trimmed.length > 200) return { error: 'Nome muito longo' }

  const { data: source } = await supabase
    .from('maintenance_plans')
    .select('description')
    .eq('id', sourceId)
    .single()
  if (!source) return { error: 'Plano origem não encontrado' }

  const { data: items } = await supabase
    .from('maintenance_plan_items')
    .select('name, interval_km, interval_days, warn_threshold_pct, is_critical, tip, sort_order')
    .eq('plan_id', sourceId)
    .order('sort_order', { ascending: true })

  const { data: newPlan, error: planErr } = await supabase
    .from('maintenance_plans')
    .insert({
      tenant_id: tenantId,
      name: trimmed,
      description: source.description,
      is_default: false,
    })
    .select()
    .single()
  if (planErr) return { error: 'Erro ao criar plano clonado' }

  if (items && items.length > 0) {
    const payload = items.map((it) => ({ ...it, plan_id: newPlan.id, tenant_id: tenantId }))
    const { error: itemsErr } = await supabase.from('maintenance_plan_items').insert(payload)
    if (itemsErr) {
      // Rollback do plano se itens falharem — plano sem itens é inutilizável.
      await supabase.from('maintenance_plans').delete().eq('id', newPlan.id)
      return { error: 'Erro ao clonar itens do plano' }
    }
  }

  await logAction({
    action: 'create',
    table: 'maintenance_plans',
    recordId: newPlan.id,
    newData: { ...newPlan, cloned_from: sourceId, items_cloned: items?.length ?? 0 },
  })
  revalidatePath('/planos-manutencao')
  return { data: newPlan }
}

// ── Plan items ─────────────────────────────────────────────────────────────

const PlanItemCreateSchema = MaintenancePlanItemSchema

export async function createMaintenancePlanItem(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = PlanItemCreateSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('maintenance_plan_items')
    .insert({
      tenant_id: tenantId,
      plan_id: parsed.data.plan_id,
      name: parsed.data.name,
      interval_km: parsed.data.interval_km ?? null,
      interval_days: parsed.data.interval_days ?? null,
      warn_threshold_pct: parsed.data.warn_threshold_pct ?? null,
      is_critical: parsed.data.is_critical ?? false,
      tip: parsed.data.tip ?? null,
      sort_order: parsed.data.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return { error: 'Erro ao adicionar item' }

  await logAction({ action: 'create', table: 'maintenance_plan_items', recordId: data.id, newData: data })

  // Propaga para motos já atribuídas ao plano: cria 1 maintenance preventiva
  // por moto usando KM 0 como referência (predicted_km = interval_km) e/ou
  // data atual + interval_days. O operador reagenda manualmente na flat list
  // de /manutencao quando souber a última realizada — daí o aviso explícito
  // na observation. Dedup por (motorcycle_id, description, completed=false)
  // garante idempotência se a action for chamada duas vezes.
  const propagated = await propagateNewItemToMotorcycles(supabase, tenantId, {
    plan_id: parsed.data.plan_id,
    name: parsed.data.name,
    interval_km: parsed.data.interval_km ?? null,
    interval_days: parsed.data.interval_days ?? null,
  })

  revalidatePath('/planos-manutencao')
  revalidatePath('/manutencao')
  return { data, propagated }
}

type PropagateInput = {
  plan_id: string
  name: string
  interval_km: number | null
  interval_days: number | null
}

async function propagateNewItemToMotorcycles(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  tenantId: string,
  item: PropagateInput,
): Promise<number> {
  const { data: motos } = await supabase
    .from('motorcycles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('maintenance_plan_id', item.plan_id)

  if (!motos || motos.length === 0) return 0

  const motoIds = motos.map((m) => m.id)

  // Dedup: ignora motos que já têm uma manutenção aberta com a mesma
  // description (gerada por bootstrap anterior ou por execução prévia desta
  // mesma propagação).
  const { data: existing } = await supabase
    .from('maintenances')
    .select('motorcycle_id')
    .in('motorcycle_id', motoIds)
    .eq('description', item.name)
    .eq('completed', false)

  const skip = new Set((existing ?? []).map((m) => m.motorcycle_id))
  const targets = motoIds.filter((id) => !skip.has(id))
  if (targets.length === 0) return 0

  const todayBR = new Date().toLocaleDateString('pt-BR')
  const scheduled = item.interval_days
    ? new Date(Date.now() + item.interval_days * 86400000).toISOString().slice(0, 10)
    : null

  const observation = `Item adicionado ao plano em ${todayBR} — sem histórico. Reagende com a última KM/data real.`

  const rows = targets.map((motoId) => ({
    tenant_id: tenantId,
    motorcycle_id: motoId,
    type: 'preventive' as const,
    description: item.name,
    predicted_km: item.interval_km ?? null,
    scheduled_date: scheduled,
    completed: false,
    observations: observation,
  }))

  const { error } = await supabase.from('maintenances').insert(rows)
  if (error) return 0

  return rows.length
}

const PlanItemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  interval_km: z.number().int().positive().nullable().optional(),
  interval_days: z.number().int().positive().nullable().optional(),
  warn_threshold_pct: z.number().int().min(1).max(100).nullable().optional(),
  is_critical: z.boolean().optional(),
  tip: z.string().trim().max(2000).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
})

export async function updateMaintenancePlanItem(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = PlanItemUpdateSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('maintenance_plan_items').select().eq('id', id).single()
  if (!before) return { error: 'Item não encontrado' }

  const merged = { ...before, ...parsed.data }
  if (merged.interval_km == null && merged.interval_days == null) {
    return { error: 'Item precisa ter pelo menos um intervalo (km ou dias)' }
  }

  const { data, error } = await supabase
    .from('maintenance_plan_items')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()
  if (error) return { error: 'Erro ao atualizar item' }

  await logAction({ action: 'update', table: 'maintenance_plan_items', recordId: id, oldData: before, newData: data })
  revalidatePath('/planos-manutencao')
  return { data }
}

export async function deleteMaintenancePlanItem(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('maintenance_plan_items').select().eq('id', id).single()
  if (!before) return { error: 'Item não encontrado' }

  const { error } = await supabase.from('maintenance_plan_items').delete().eq('id', id)
  if (error) return { error: 'Erro ao excluir item' }

  await logAction({ action: 'delete', table: 'maintenance_plan_items', recordId: id, oldData: before })
  revalidatePath('/planos-manutencao')
  return { success: true }
}
