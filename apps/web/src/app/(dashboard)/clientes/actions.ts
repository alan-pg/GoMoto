'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { CustomerSchema } from '@gomoto/core'
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
    .select('id, email, user_id, name')
    .eq('id', id)
    .single()

  if (fetchErr || !customer) return { error: 'Cliente não encontrado' }
  if (!customer.email) return { error: 'Cliente sem email cadastrado' }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
  const normalizedEmail = customer.email.trim().toLowerCase()

  let authUserId: string

  if (customer.user_id) {
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(customer.user_id, { password })
    if (updateErr) return { error: `Falha ao atualizar senha: ${updateErr.message}` }
    authUserId = customer.user_id
  } else {
    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listErr) return { error: `Falha ao consultar usuários: ${listErr.message}` }

    const existing = list.users.find((u) => u.email?.toLowerCase() === normalizedEmail)

    if (existing) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, { password })
      if (updateErr) return { error: `Falha ao atualizar senha: ${updateErr.message}` }
      authUserId = existing.id
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
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
    .select('id, email, user_id, name')
    .eq('id', id)
    .single()

  if (fetchErr || !customer) return { error: 'Cliente não encontrado' }
  if (!customer.email) return { error: 'Cliente sem email cadastrado' }
  if (customer.user_id) return { error: 'Cliente já tem acesso ao app' }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceUrl || !serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }

  const supabaseAdmin = createAdminClient(serviceUrl, serviceKey, { auth: { persistSession: false } })
  const normalizedEmail = customer.email.trim().toLowerCase()

  // Lookup primeiro: cliente pode já ser auth.users (cliente de outro tenant ou usuário reciclando email).
  // listUsers é paginado; perPage=1000 atende MVP. Trocar por RPC SECURITY DEFINER se o volume crescer.
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) return { error: `Falha ao consultar usuários: ${listErr.message}` }

  const existing = list.users.find((u) => u.email?.toLowerCase() === normalizedEmail)
  let authUserId: string

  if (existing) {
    authUserId = existing.id
  } else {
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: MOBILE_REDIRECT }
    )
    if (inviteErr || !invited.user) {
      return { error: `Falha ao enviar convite: ${inviteErr?.message ?? 'erro desconhecido'}` }
    }
    authUserId = invited.user.id
  }

  // UPDATE via client autenticado para que RLS confine ao tenant ativo.
  const { error: linkErr } = await supabase
    .from('customers')
    .update({ user_id: authUserId })
    .eq('id', id)

  if (linkErr) return { error: `Falha ao vincular conta: ${linkErr.message}` }

  await logAction({
    action: 'update',
    table: 'customers',
    recordId: id,
    newData: { user_id: authUserId, invite_action: existing ? 'linked_existing' : 'invited' },
  })
  revalidatePath('/clientes')

  return { success: true, alreadyExisted: !!existing }
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
