'use server'

import { SignJWT } from 'jose'
import { LateChargePolicyInputSchema, toPolicyRow, ThemePreferenceSchema } from '@gomoto/core'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId, requireTenantOwner } from '@/lib/auth/tenant'
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

/**
 * Integração de Pagamento é restrita a Tenant Owner — conectar/desconectar
 * a conta Mercado Pago afeta o recebimento de toda a empresa, não é uma
 * configuração operacional comum. Guard server-side; a tela também esconde
 * a seção pra quem não é Owner (mesmo padrão de "esconder, não só bloquear"
 * já usado na Spec 0011 pra Usuários/RNF-003).
 */
async function getOwnerTenant() {
  try {
    return await requireTenantOwner()
  } catch (err) {
    const code = err instanceof Error && err.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAUTHORIZED'
    return { error: code as 'FORBIDDEN' | 'UNAUTHORIZED' }
  }
}

export async function connectMercadoPagoAction() {
  const ctx = await getOwnerTenant()
  if ('error' in ctx) {
    const message = ctx.error === 'FORBIDDEN' ? 'Apenas o Owner da empresa pode conectar a integração de pagamento' : 'Não autorizado'
    return { ok: false, error: { code: ctx.error, message } }
  }

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
  const ctx = await getOwnerTenant()
  if ('error' in ctx) {
    const message = ctx.error === 'FORBIDDEN' ? 'Apenas o Owner da empresa pode desconectar a integração de pagamento' : 'Não autorizado'
    return { ok: false, error: { code: ctx.error, message } }
  }

  const { data: conn } = await ctx.supabase
    .from('payment_provider_accounts')
    .select('id, external_account_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('provider', 'mercadopago')
    .maybeSingle()

  if (!conn) return { ok: false, error: { code: 'NOT_FOUND', message: 'Nenhuma integração ativa' } }

  const account = conn as { id: string; external_account_id: string }

  // Desativa em vez de apagar: `payment_intents` referencia a conta, e o
  // histórico de tentativas precisa continuar rastreável (Princípio 3).
  const { error } = await ctx.supabase
    .from('payment_provider_accounts')
    .update({ active: false, is_default: false })
    .eq('id', account.id)
    .eq('tenant_id', ctx.tenantId)

  if (error) return { ok: false, error: { code: 'INTERNAL', message: 'Erro ao desconectar' } }

  // Tentativas pendentes não podem mais ser confirmadas pelo webhook.
  await ctx.supabase
    .from('payment_intents')
    .update({ status: 'expired' })
    .eq('tenant_id', ctx.tenantId)
    .eq('provider_account_id', account.id)
    .eq('status', 'pending')

  await logAction({
    action: 'disconnect_payment',
    table: 'payment_provider_accounts',
    oldData: { tenant_id: ctx.tenantId, external_account_id: account.external_account_id },
  })

  revalidatePath('/configuracoes')
  return { ok: true }
}

// ============================================================
// createLateChargePolicyAction — nova versão da política de encargo
// ============================================================

/**
 * O que estava aqui era `saveFinancialSettings`: gravava a configuração como
 * JSON em `settings.late_charge_defaults` e devolvia `{ ok: true }`. Nenhum
 * código lia essa chave — a emissão sempre resolveu a política em
 * `late_charge_policies`. A action não tinha um único chamador, o que a
 * manteve inofensiva; ligar um formulário nela teria produzido uma tela que
 * aceita 5% de multa, responde "salvo", e segue cobrando 2%.
 *
 * A gravação é nova VERSÃO, nunca edição da vigente: cobrança emitida guarda
 * `late_charge_policy_id` e continua valendo o que valia no dia. A numeração
 * e a trava de retroatividade ficam na função do banco, sob lock do tenant.
 */
export async function createLateChargePolicyAction(input: unknown) {
  const ctx = await getOwnerTenant()
  if ('error' in ctx) {
    const message = ctx.error === 'FORBIDDEN'
      ? 'Apenas o Owner da empresa pode alterar a política de encargo'
      : 'Não autorizado'
    return { ok: false as const, error: { code: ctx.error, message } }
  }

  const parsed = LateChargePolicyInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false as const, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos' } }
  }

  const row = toPolicyRow(parsed.data)

  const { data, error } = await ctx.supabase.rpc('fn_create_late_charge_policy', {
    p_tenant_id:           ctx.tenantId,
    p_fee_type:            row.fee_type,
    p_fee_value:           row.fee_value,
    p_daily_interest_rate: row.daily_interest_rate,
    p_grace_period_days:   row.grace_period_days,
    p_min_amount:          row.min_amount,
    p_effective_from:      row.effective_from,
    p_created_by:          ctx.userId,
  })

  if (error) {
    const conhecidos: Record<string, string> = {
      EFFECTIVE_FROM_IN_PAST: 'A vigência não pode começar antes de hoje — política nova não retroage sobre o que já foi cobrado.',
      TENANT_NOT_FOUND:       'Empresa não encontrada.',
    }
    const chave = Object.keys(conhecidos).find((k) => error.message.includes(k))
    return {
      ok: false as const,
      error: { code: chave ? 'VALIDATION_ERROR' : 'INTERNAL', message: chave ? conhecidos[chave]! : error.message },
    }
  }

  await logAction({
    action: 'create',
    table:  'late_charge_policies',
    recordId: data as string,
    newData: { ...row, tenant_id: ctx.tenantId },
  })

  revalidatePath('/configuracoes')
  revalidatePath('/cobrancas')
  return { ok: true as const, data: { id: data as string } }
}

// ============================================================
// updateThemePreferenceAction — direção de marca + modo de cor (ADR 0019)
// Preferência por operador (tenant_members), não por tenant.
// ============================================================

export async function updateThemePreferenceAction(input: unknown) {
  const ctx = await getAuthenticatedTenant()
  if ('error' in ctx) return { ok: false, error: { code: ctx.error, message: 'Não autorizado' } }

  const parsed = ThemePreferenceSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'Dados inválidos' } }
  }

  // RPC SECURITY DEFINER, não UPDATE direto: a única policy de UPDATE em
  // tenant_members ("Owners/admins can manage members") exige role
  // owner/admin — operator/viewer não conseguem alterar nem a própria
  // linha por ela. Sem a RPC, o update roda sem erro mas afeta 0 linhas.
  const { error } = await ctx.supabase.rpc('update_own_theme_preference', {
    p_theme_brand: parsed.data.theme_brand,
    p_color_mode: parsed.data.color_mode,
  })

  if (error) return { ok: false, error: { code: 'INTERNAL', message: error.message } }

  await logAction({
    action: 'update',
    table: 'tenant_members',
    newData: parsed.data,
  })

  // Revalida o layout raiz (não só /configuracoes) — é onde data-brand/data-mode
  // são escritos no <html> a partir de tenant_members (ADR 0019 §5).
  revalidatePath('/', 'layout')
  return { ok: true, data: undefined }
}
