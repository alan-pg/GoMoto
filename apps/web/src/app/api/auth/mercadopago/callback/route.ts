import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { exchangeCodeForTokens } from '@/lib/payment/mercadopago'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

const REDIRECT_BASE = '/configuracoes'

function serverLog(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  if (searchParams.get('error') === 'access_denied') {
    serverLog('info', 'mp_oauth.cancelled')
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=cancelled`, req.url))
  }

  const code  = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    serverLog('warn', 'mp_oauth.error', { reason: 'missing_params', has_code: !!code, has_state: !!state })
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=missing_params`, req.url))
  }

  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) {
    serverLog('warn', 'mp_oauth.error', { reason: 'no_tenant' })
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const secret = process.env.MERCADOPAGO_CLIENT_SECRET
  if (!secret) {
    serverLog('error', 'mp_oauth.error', { reason: 'misconfiguration', tenant_id: tenantId })
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=misconfiguration`, req.url))
  }

  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret))
    if (payload.tenant_id !== tenantId) throw new Error('tenant mismatch')
  } catch (err) {
    serverLog('warn', 'mp_oauth.error', { reason: 'state_mismatch', tenant_id: tenantId, detail: String(err) })
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=state_mismatch`, req.url))
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch (err) {
    serverLog('error', 'mp_oauth.error', { reason: 'token_exchange', tenant_id: tenantId, detail: String(err) })
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=token_exchange`, req.url))
  }

  // Spec 0014: credenciais em `payment_provider_accounts`, com o provedor como
  // dado. `payment_connections` tinha UNIQUE(tenant_id) e impedia um segundo
  // gateway (F-13); aqui a chave é (tenant, provider, conta externa).
  // O token NÃO é coluna: vai para o Vault por `fn_store_provider_credentials`,
  // e a tabela guarda só a referência. Credencial de pagamento em texto puro
  // vaza junto com qualquer dump ou log de linha (P-1).
  const { data: account, error } = await supabase
    .from('payment_provider_accounts')
    .upsert(
      {
        tenant_id:           tenantId,
        provider:            'mercadopago',
        external_account_id: tokens.mp_user_id,
        account_email:       tokens.mp_account_email,
        is_default: true,
        active:     true,
      },
      { onConflict: 'tenant_id,provider,external_account_id' },
    )
    .select('id')
    .single()

  if (!error && account) {
    const { error: secretError } = await supabase.rpc('fn_store_provider_credentials', {
      p_account_id:    (account as { id: string }).id,
      p_access_token:  tokens.access_token,
      p_refresh_token: tokens.refresh_token,
    })
    if (secretError) {
      console.error('[mercadopago/callback] store_credentials_failed', { error: secretError.message })
      return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=credentials`, req.url))
    }
  }

  if (error) {
    serverLog('error', 'mp_oauth.error', { reason: 'db_upsert', tenant_id: tenantId, mp_user_id: tokens.mp_user_id, db_code: error.code })
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=db_error`, req.url))
  }

  // Tentativas pendentes da conta anterior apontam para outra conta externa e
  // o webhook não conseguiria resolver o tenant.
  await supabase
    .from('payment_intents')
    .update({ status: 'expired' })
    .eq('tenant_id', tenantId)
    .eq('provider', 'mercadopago')
    .eq('status', 'pending')

  serverLog('info', 'mp_oauth.connected', { tenant_id: tenantId, mp_user_id: tokens.mp_user_id })

  await logAction({
    action: 'connect_payment',
    table: 'payment_provider_accounts',
    newData: { tenant_id: tenantId, mp_user_id: tokens.mp_user_id, mp_account_email: tokens.mp_account_email },
  })

  revalidatePath(REDIRECT_BASE)
  return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=connected`, req.url))
}
