'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { CustomerSchema, cpfShellEmail } from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'

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

  await logAction({ action: 'create', table: 'customers', recordId: data.id, newData: data })
  revalidatePath('/clientes')
  return { data }
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

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
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
  if (customer.user_id) return { error: 'Cliente já tem acesso ao app' }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
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
      options: { redirectTo: MOBILE_REDIRECT },
    })
    if (linkErr) return { error: `Falha ao gerar link: ${linkErr.message}` }
    link = linkData.properties?.action_link ?? null
  } else {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: cpfEmail,
      options: { redirectTo: MOBILE_REDIRECT },
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

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
  const cpfEmail = cpfShellEmail(customer.cpf)

  const { data: linkData, error: resetErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: cpfEmail,
    options: { redirectTo: MOBILE_REDIRECT },
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
