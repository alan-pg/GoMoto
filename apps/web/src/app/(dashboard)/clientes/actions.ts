'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import {
  CustomerSchema, cpfShellEmail,
  ExtractDocumentFileSchema,
  type ActionResult, type ExtractionResult, type CnhFields,
} from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { extractFields } from '@/lib/document-extraction/extract'

function getAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return null
  return createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
}

const MOBILE_REDIRECT = 'gomoto://auth-callback'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function createCustomer(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não encontrado' }

  const parsed = CustomerSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data, error } = await supabase
    .from('customers')
    .insert({ ...parsed.data, tenant_id: tenantId, in_queue: false })
    .select()
    .single()

  if (error) return { error: `Erro ao criar cliente: ${error.message}` }

  // RF-023: auto-link cross-tenant — vincula auth.user existente sem criar novo login
  let alreadyLinked = false
  const supabaseAdmin = getAdminClient()
  if (supabaseAdmin && !data.user_id && parsed.data.cpf) {
    try {
      const cpfEmail = cpfShellEmail(parsed.data.cpf)
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list?.users.find((u) => u.email?.toLowerCase() === cpfEmail)
      if (existing) {
        await supabase.from('customers').update({ user_id: existing.id }).eq('id', data.id)
        data.user_id = existing.id
        alreadyLinked = true
      }
    } catch {
      console.warn('[createCustomer] cross-tenant lookup falhou', { customerId: data.id })
    }
  }

  await logAction({ action: 'create', table: 'customers', recordId: data.id, newData: data })
  revalidatePath('/clientes')
  return { data, alreadyLinked }
}

export async function updateCustomer(id: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = CustomerSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('customers').select().eq('id', id).single()

  const { data, error } = await supabase
    .from('customers')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar cliente' }

  await logAction({ action: 'update', table: 'customers', recordId: id, oldData: before, newData: data })
  revalidatePath('/clientes')
  return { data }
}

export async function setCustomerPassword(id: string, password: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  if (password.length < 8) return { error: 'A senha precisa ter ao menos 8 caracteres' }

  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, cpf, user_id, name')
    .eq('id', id)
    .single()

  if (fetchErr || !customer) return { error: 'Cliente não encontrado' }
  if (!customer.cpf) return { error: 'Cliente sem CPF cadastrado' }

  const supabaseAdmin = getAdminClient()
  if (!supabaseAdmin) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  // O app faz login com cpfShellEmail(cpf) — o auth.users DEVE ter esse email como identificador.
  const cpfEmail = cpfShellEmail(customer.cpf)

  let authUserId: string

  if (customer.user_id) {
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(customer.user_id, {
      password,
      user_metadata: { password_set: true },
    })
    if (updateErr) return { error: `Falha ao atualizar senha: ${updateErr.message}` }
    authUserId = customer.user_id
  } else {
    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) return { error: `Falha ao consultar usuários: ${listErr.message}` }

    const existing = list.users.find((u) => u.email?.toLowerCase() === cpfEmail)

    if (existing) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: { password_set: true },
      })
      if (updateErr) return { error: `Falha ao atualizar senha: ${updateErr.message}` }
      authUserId = existing.id
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cpfEmail,
        password,
        email_confirm: true,
        user_metadata: { password_set: true },
      })
      if (createErr || !created.user) return { error: `Falha ao criar usuário: ${createErr?.message ?? 'erro desconhecido'}` }
      authUserId = created.user.id
    }

    const { error: linkErr } = await supabase
      .from('customers')
      .update({ user_id: authUserId })
      .eq('id', id)

    if (linkErr) return { error: `Falha ao vincular conta: ${linkErr.message}` }
  }

  await logAction({
    action: 'update',
    table: 'customers',
    recordId: id,
    newData: { user_id: authUserId, access_action: 'password_set_by_operator' },
  })
  revalidatePath('/clientes')
  return { success: true }
}

export async function inviteCustomerToApp(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, cpf, user_id, name')
    .eq('id', id)
    .single()

  if (fetchErr || !customer) return { error: 'Cliente não encontrado' }
  if (!customer.cpf) return { error: 'Cliente sem CPF cadastrado' }

  const supabaseAdmin = getAdminClient()
  if (!supabaseAdmin) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  // O app faz login com cpfShellEmail(cpf) — o auth.users DEVE ter esse email como identificador.
  // O link gerado é retornado para o operador compartilhar (ex: WhatsApp), pois o cpfEmail não tem caixa real.
  const cpfEmail = cpfShellEmail(customer.cpf)

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) return { error: `Falha ao consultar usuários: ${listErr.message}` }

  const existing = list.users.find((u) => u.email?.toLowerCase() === cpfEmail)
  let authUserId: string
  let link: string | null = null

  if (existing) {
    authUserId = existing.id
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: cpfEmail,
      // expiresIn não está nos tipos do SDK 2.x mas é suportado pela API
      options: { redirectTo: MOBILE_REDIRECT, expiresIn: 259200 } as { redirectTo: string },
    })
    if (linkErr) return { error: `Falha ao gerar link: ${linkErr.message}` }
    link = linkData.properties?.action_link ?? null
  } else {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: cpfEmail,
      // expiresIn não está nos tipos do SDK 2.x mas é suportado pela API
      options: { redirectTo: MOBILE_REDIRECT, expiresIn: 259200 } as { redirectTo: string },
    })
    if (linkErr || !linkData.user) {
      return { error: `Falha ao gerar link de acesso: ${linkErr?.message ?? 'erro desconhecido'}` }
    }
    authUserId = linkData.user.id
    link = linkData.properties?.action_link ?? null
  }

  const { error: linkCustomerErr } = await supabase
    .from('customers')
    .update({ user_id: authUserId })
    .eq('id', id)

  if (linkCustomerErr) return { error: `Falha ao vincular conta: ${linkCustomerErr.message}` }

  await logAction({
    action: 'update',
    table: 'customers',
    recordId: id,
    newData: { user_id: authUserId, invite_action: existing ? 'link_regenerated' : 'invite_generated' },
  })
  revalidatePath('/clientes')

  return { success: true, link, alreadyExisted: !!existing }
}

export async function resetCustomerPassword(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: customer, error: fetchErr } = await supabase
    .from('customers')
    .select('id, cpf, name')
    .eq('id', id)
    .single()

  if (fetchErr || !customer) return { error: 'Cliente não encontrado' }
  if (!customer.cpf) return { error: 'Cliente sem CPF cadastrado' }

  const supabaseAdmin = getAdminClient()
  if (!supabaseAdmin) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const cpfEmail = cpfShellEmail(customer.cpf)

  const { data: linkData, error: resetErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: cpfEmail,
    // expiresIn não está nos tipos do SDK 2.x mas é suportado pela API
    options: { redirectTo: MOBILE_REDIRECT, expiresIn: 3600 } as { redirectTo: string },
  })

  if (resetErr) return { error: `Falha ao gerar link de recuperação: ${resetErr.message}` }

  const link = linkData.properties?.action_link ?? null

  await logAction({
    action: 'update',
    table: 'customers',
    recordId: id,
    newData: { access_action: 'password_recovery_link_generated' },
  })
  return { success: true, link }
}

export async function deleteCustomer(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('customers').select().eq('id', id).single()
  const { error } = await supabase.from('customers').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir cliente' }

  await logAction({ action: 'delete', table: 'customers', recordId: id, oldData: before })
  revalidatePath('/clientes')
  return { success: true }
}

/**
 * PRD 0012/Spec 0012 §5.1 — extrai campos de uma CNH (PDF/imagem) via IA pra
 * pré-preencher o CustomerForm. Não persiste nada (RN-001) — o client decide
 * o que fazer com o resultado.
 */
export async function extractCnhFields(formData: FormData): Promise<ActionResult<ExtractionResult<CnhFields>>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Tenant não resolvido' } }
  }

  const parsedFile = ExtractDocumentFileSchema.safeParse(formData.get('file'))
  if (!parsedFile.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: parsedFile.error.issues[0]?.message ?? 'Arquivo inválido', field: 'file' },
    }
  }

  const startedAt = Date.now()
  const result = await extractFields('cnh', parsedFile.data)
  const latencyMs = Date.now() - startedAt

  if (!result) {
    console.error('[extractCnhFields] extraction_failed', { tenant_id: tenantId, outcome: 'error', latency_ms: latencyMs })
    return {
      ok: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Não foi possível extrair os dados da CNH. Tente novamente ou preencha manualmente.' },
    }
  }

  console.info('[extractCnhFields] extraction_completed', {
    tenant_id: tenantId, outcome: 'ok', fields_found: result.fieldsFound, fields_total: result.fieldsTotal, latency_ms: latencyMs,
  })
  return { ok: true, data: result }
}
