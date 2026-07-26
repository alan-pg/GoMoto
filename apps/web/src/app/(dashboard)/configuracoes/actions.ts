'use server'

import { z } from 'zod'
import { SignJWT } from 'jose'
import { LateChargeConfigSchema } from '@gomoto/core'
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

  // Expirar Pixes ativos: QR codes da conta desconectada não podem mais ser confirmados via webhook.
  await ctx.supabase
    .from('billing_pix')
    .update({ status: 'expired' })
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'active')

  await logAction({
    action: 'disconnect_payment',
    table: 'payment_connections',
    oldData: { tenant_id: ctx.tenantId, mp_user_id: conn.mp_user_id },
  })

  revalidatePath('/configuracoes')
  return { ok: true }
}

// ============================================================
// saveFinancialSettings — persiste configuração de encargos por atraso (RF-001)
// ============================================================

export async function saveFinancialSettings(input: unknown) {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const parsed = LateChargeConfigSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos' } }
  }

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ tenant_id: ctx.tenantId, key: 'late_charge_defaults', value: JSON.stringify(parsed.data) }, { onConflict: 'tenant_id,key' })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  revalidatePath('/configuracoes')
  return { ok: true, data: undefined }
}

// ============================================================
// saveDelinquencySettings — persiste thresholds de inadimplência (RF-033)
// ============================================================

const DelinquencySettingsSchema = z.object({
  delinquent_count: z.number().int().min(1),
  delinquent_days:  z.number().int().min(1),
  blocked_count:    z.number().int().min(1),
  blocked_days:     z.number().int().min(1),
  auto_block:       z.boolean().default(false),
})

export async function saveDelinquencySettings(input: unknown) {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const parsed = DelinquencySettingsSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos' } }
  }

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ tenant_id: ctx.tenantId, key: 'delinquency_thresholds', value: JSON.stringify(parsed.data) }, { onConflict: 'tenant_id,key' })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  revalidatePath('/configuracoes')
  return { ok: true, data: undefined }
}

// ============================================================
// saveAutoApplyCreditSetting — habilita/desabilita aplicação automática de crédito
// ============================================================

export async function saveAutoApplyCreditSetting(enabled: boolean) {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ tenant_id: ctx.tenantId, key: 'auto_apply_credit', value: JSON.stringify({ enabled }) }, { onConflict: 'tenant_id,key' })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  revalidatePath('/configuracoes')
  return { ok: true, data: undefined }
}
