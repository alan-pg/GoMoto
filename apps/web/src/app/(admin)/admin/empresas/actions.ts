'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { ZodError } from 'zod'
import {
  CreateTenantWithOwnerSchema,
  TenantSchema,
  TenantSuspendSchema,
} from '@gomoto/core'

import { requirePlatformAdmin, requirePlatformOwner } from '@/lib/auth/platform'
import { logPlatformAction } from '@/lib/audit'

const PG_ERROR_MAP: Record<string, string> = {
  '23505': 'Conflito de unicidade: slug, CNPJ ou email já cadastrado',
  '23514': 'Dados inválidos: verifique CNPJ, UF ou CEP',
  '42501': 'Acesso negado',
  '22023': 'Dados inválidos',
}

function translatePgError(err: { code?: string; message: string }): string {
  if (err.code && PG_ERROR_MAP[err.code]) return PG_ERROR_MAP[err.code]
  return err.message ?? 'Erro inesperado'
}

/**
 * Achata `ZodError.issues` em pares { path, message } no formato dotted
 * (ex.: "tenant.slug", "owner.email"). Mantém só o primeiro erro de cada
 * campo pra evitar listas duplicadas; a UI mostra um erro por input.
 */
type FieldIssue = { path: string; message: string }
function flattenZodIssues(error: ZodError): FieldIssue[] {
  const seen = new Set<string>()
  const out: FieldIssue[] = []
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, message: issue.message })
  }
  return out
}

/**
 * Tenta mapear violações de UNIQUE/CHECK do Postgres pro campo correto,
 * pra UI conseguir marcar o input específico (slug, cnpj, email, etc.).
 */
function pgErrorToFieldIssues(err: {
  code?: string
  message: string
  details?: string
}): FieldIssue[] {
  const msg = `${err.message} ${err.details ?? ''}`
  if (err.code === '23505') {
    if (/idx_tenants_cnpj_unique|tenants_cnpj_key|\(cnpj\)/i.test(msg)) {
      return [{ path: 'tenant.cnpj', message: 'CNPJ já cadastrado em outra empresa' }]
    }
    if (/tenants_slug_key|\(slug\)/i.test(msg)) {
      return [{ path: 'tenant.slug', message: 'Slug já em uso — escolha outro' }]
    }
    if (/auth\.users.*email|users_email_partial_key|\(email\)/i.test(msg)) {
      return [{ path: 'owner.email', message: 'Email já cadastrado em auth.users' }]
    }
  }
  if (err.code === '23514') {
    if (/chk_tenants_cnpj_digits/i.test(msg)) {
      return [{ path: 'tenant.cnpj', message: 'CNPJ precisa ter 14 dígitos' }]
    }
    if (/chk_tenants_state_uf/i.test(msg)) {
      return [{ path: 'tenant.address_state', message: 'UF inválida (use 2 letras)' }]
    }
    if (/chk_tenants_zip_digits/i.test(msg)) {
      return [{ path: 'tenant.address_zip', message: 'CEP precisa ter 8 dígitos' }]
    }
  }
  return []
}


export async function createTenant(rawData: unknown) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  const parsed = CreateTenantWithOwnerSchema.safeParse(rawData)
  if (!parsed.success) {
    return {
      error: 'Corrija os campos destacados',
      fieldErrors: flattenZodIssues(parsed.error),
    }
  }

  // RPC atômica: cria auth user + tenant + tenant_members + settings +
  // audit em uma só transação. Se qualquer passo falhar, nada fica órfão.
  // O próprio RPC loga em platform_audit_logs (tenant.create_with_owner).
  const { data: newTenantId, error } = await ctx.supabase.rpc('create_tenant_with_owner', {
    p_tenant: parsed.data.tenant,
    p_owner_email: parsed.data.owner.email,
    p_owner_password: parsed.data.owner.password,
    p_owner_name: parsed.data.owner.name,
  })

  if (error) {
    const fieldErrors = pgErrorToFieldIssues(error)
    if (fieldErrors.length > 0) {
      return { error: 'Corrija os campos destacados', fieldErrors }
    }
    return { error: translatePgError(error) }
  }

  // Re-busca o tenant já criado para devolver pra UI (Server Action não
  // tem como retornar o row direto do RPC sem segunda chamada).
  const { data: tenantRow } = await ctx.supabase
    .from('tenants')
    .select()
    .eq('id', newTenantId as string)
    .single()

  revalidatePath('/admin/empresas')
  revalidatePath(`/admin/empresas/${newTenantId}`)
  return { data: tenantRow }
}

export async function updateTenant(id: string, rawData: unknown) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  const parsed = TenantSchema.partial().safeParse(rawData)
  if (!parsed.success) {
    return {
      error: 'Corrija os campos destacados',
      fieldErrors: flattenZodIssues(parsed.error),
    }
  }

  // Zod aceita CNPJ vazio (campo opcional); o CHECK do banco rejeita
  // string vazia. Normalizamos pra null antes do UPDATE.
  const update: Record<string, unknown> = { ...parsed.data }
  if (update.cnpj === '') update.cnpj = null

  const { data: before } = await ctx.supabase.from('tenants').select().eq('id', id).single()

  const { data, error } = await ctx.supabase
    .from('tenants')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    // updateTenant lida só com a parte `tenant`; ajustamos o prefixo
    // pro shape esperado pelo updateTenant flow (sem `tenant.`).
    const fieldErrors = pgErrorToFieldIssues(error).map((fe) => ({
      ...fe,
      path: fe.path.replace(/^tenant\./, ''),
    }))
    if (fieldErrors.length > 0) {
      return { error: 'Corrija os campos destacados', fieldErrors }
    }
    return { error: translatePgError(error) }
  }

  await logPlatformAction(ctx.supabase, ctx.userId, 'tenant.update', 'tenant', id, {
    before: before
      ? { name: before.name, slug: before.slug }
      : null,
    after: { name: data.name, slug: data.slug },
  })

  revalidatePath('/admin/empresas')
  revalidatePath(`/admin/empresas/${id}`)
  return { data }
}

export async function suspendTenant(id: string, rawData: unknown) {
  let ctx
  try {
    ctx = await requirePlatformOwner()
  } catch {
    return { error: 'Acesso negado' }
  }

  const parsed = TenantSuspendSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { error } = await ctx.supabase
    .from('tenants')
    .update({
      suspended_at: new Date().toISOString(),
      suspended_reason: parsed.data.reason,
      suspended_by: ctx.userId,
    })
    .eq('id', id)

  if (error) return { error: `Erro ao suspender empresa: ${error.message}` }

  await logPlatformAction(ctx.supabase, ctx.userId, 'tenant.suspend', 'tenant', id, {
    reason: parsed.data.reason,
  })

  revalidatePath('/admin/empresas')
  revalidatePath(`/admin/empresas/${id}`)
  return { success: true }
}

export async function reactivateTenant(id: string) {
  let ctx
  try {
    ctx = await requirePlatformOwner()
  } catch {
    return { error: 'Acesso negado' }
  }

  const { error } = await ctx.supabase
    .from('tenants')
    .update({
      suspended_at: null,
      suspended_reason: null,
      suspended_by: null,
    })
    .eq('id', id)

  if (error) return { error: `Erro ao reativar empresa: ${error.message}` }

  await logPlatformAction(ctx.supabase, ctx.userId, 'tenant.reactivate', 'tenant', id, {})

  revalidatePath('/admin/empresas')
  revalidatePath(`/admin/empresas/${id}`)
  return { success: true }
}

export async function regenerateOwnerLink(tenantId: string) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'Configuração do servidor incompleta' }

  const { data: member, error: memberErr } = await ctx.supabase
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (memberErr || !member) return { error: 'Owner do tenant não encontrado' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })

  const { data: authUser, error: userErr } = await supabaseAdmin.auth.admin.getUserById(member.user_id)
  if (userErr || !authUser.user?.email) return { error: 'Usuário do owner não encontrado' }

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.user.email,
    // expiresIn não está nos tipos do SDK 2.x mas é suportado pela API
    options: { expiresIn: 259200 } as { redirectTo?: string },
  })

  if (linkErr) return { error: `Falha ao gerar link: ${linkErr.message}` }

  await logPlatformAction(ctx.supabase, ctx.userId, 'regenerate_owner_link', 'tenant', tenantId, {})

  return { link: linkData.properties?.action_link ?? null }
}

export async function changeOwnerPassword(tenantId: string, newPassword: string) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  if (!newPassword || newPassword.length < 8) {
    return { error: 'A senha precisa ter no mínimo 8 caracteres' }
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'Configuração do servidor incompleta' }

  const { data: member, error: memberErr } = await ctx.supabase
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (memberErr || !member) return { error: 'Owner do tenant não encontrado' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
    member.user_id,
    { password: newPassword },
  )

  if (updateErr) return { error: `Falha ao alterar senha: ${updateErr.message}` }

  await logPlatformAction(ctx.supabase, ctx.userId, 'owner.change_password', 'tenant', tenantId, {})

  return { success: true }
}
