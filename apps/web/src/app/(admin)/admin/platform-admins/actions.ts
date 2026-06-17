'use server'

import { revalidatePath } from 'next/cache'

import { requirePlatformAdmin } from '@/lib/auth/platform'

type PlatformRole = 'owner' | 'operator'

const ERROR_MAP: Record<string, string> = {
  '42501': 'Apenas owners podem realizar essa ação',
  '23514': 'A plataforma precisa de pelo menos um owner ativo',
  '23505': 'Esse usuário já é platform_admin',
  '22023': 'Role inválida',
  P0002: 'Usuário não encontrado',
}

// O Postgres devolve códigos SQLSTATE; mapeamos para mensagens humanas.
// Mantém os RAISE EXCEPTION do banco como única fonte de verdade.
function translateError(err: { code?: string; message: string }): string {
  if (err.code && ERROR_MAP[err.code]) return ERROR_MAP[err.code]
  return err.message ?? 'Erro inesperado'
}

export async function addPlatformAdmin(email: string, role: PlatformRole) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  const normalized = email.trim().toLowerCase()
  if (!normalized.includes('@')) return { error: 'Email inválido' }

  const { data: newUserId, error } = await ctx.supabase.rpc('add_platform_admin_by_email', {
    p_email: normalized,
    p_role: role,
  })
  if (error) return { error: translateError(error) }

  // Recarrega a lista e devolve a linha recém-adicionada já enriquecida —
  // evita um reload completo na UI.
  const { data: rows } = await ctx.supabase.rpc('list_platform_admins')
  const created = (rows as Array<{ user_id: string }> | null)?.find(
    (r) => r.user_id === newUserId,
  )

  revalidatePath('/admin/platform-admins')
  return { success: true as const, row: created ?? null }
}

export async function setPlatformAdminRole(userId: string, role: PlatformRole) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  const { error } = await ctx.supabase.rpc('set_platform_admin_role', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) return { error: translateError(error) }

  revalidatePath('/admin/platform-admins')
  return { success: true as const }
}

export async function removePlatformAdmin(userId: string) {
  let ctx
  try {
    ctx = await requirePlatformAdmin()
  } catch {
    return { error: 'Acesso negado' }
  }

  // Proteção amistosa: o caller não pode se remover. O guard "≥1 owner"
  // do banco impediria perder todos os owners, mas remover-se sendo
  // operator deixaria a pessoa sem acesso ao admin — quase sempre erro.
  if (userId === ctx.userId) return { error: 'Você não pode remover a si mesmo' }

  const { error } = await ctx.supabase.rpc('remove_platform_admin', {
    p_user_id: userId,
  })
  if (error) return { error: translateError(error) }

  revalidatePath('/admin/platform-admins')
  return { success: true as const }
}
