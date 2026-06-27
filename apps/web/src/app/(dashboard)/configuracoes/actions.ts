'use server'

import { SignJWT } from 'jose'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { buildOAuthUrl } from '@/lib/payment/mercadopago'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

async function getAuthenticatedTenant() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'UNAUTHORIZED' as const }
  return { supabase, user, tenantId }
}

export async function connectMercadoPagoAction() {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const secret = process.env.MERCADOPAGO_CLIENT_SECRET
  if (!secret) return { ok: false, error: { code: 'INTERNAL', message: 'Integração não configurada' } }

  const stateJwt = await new SignJWT({ tenant_id: ctx.tenantId, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret))

  const authUrl = buildOAuthUrl(stateJwt)
  return { ok: true, data: { authUrl } }
}

export async function disconnectPaymentAction() {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const { data: conn } = await ctx.supabase
    .from('payment_connections')
    .select('mp_user_id')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!conn) return { ok: false, error: { code: 'NOT_FOUND', message: 'Nenhuma integração ativa' } }

  const { error } = await ctx.supabase
    .from('payment_connections')
    .delete()
    .eq('tenant_id', ctx.tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao desconectar' } }

  await logAction({
    action: 'disconnect_payment',
    table: 'payment_connections',
    oldData: { tenant_id: ctx.tenantId, mp_user_id: conn.mp_user_id },
  })

  revalidatePath('/configuracoes')
  return { ok: true }
}
