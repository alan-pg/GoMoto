import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { exchangeCodeForTokens } from '@/lib/payment/mercadopago'
import { logAction } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

const REDIRECT_BASE = '/configuracoes'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  if (searchParams.get('error') === 'access_denied') {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=cancelled`, req.url))
  }

  const code  = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=missing_params`, req.url))
  }

  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Verificar state JWT (CSRF)
  const secret = process.env.MERCADOPAGO_CLIENT_SECRET
  if (!secret) {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=misconfiguration`, req.url))
  }

  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret))
    if (payload.tenant_id !== tenantId) throw new Error('tenant mismatch')
  } catch {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=state_mismatch`, req.url))
  }

  // Trocar code por tokens
  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=token_exchange`, req.url))
  }

  // Salvar credenciais
  const { error } = await supabase.from('payment_connections').upsert(
    {
      tenant_id:        tenantId,
      mp_user_id:       tokens.mp_user_id,
      mp_account_email: tokens.mp_account_email,
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token,
    },
    { onConflict: 'tenant_id' },
  )

  if (error) {
    return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=error&reason=db_error`, req.url))
  }

  await logAction({
    action: 'connect_payment',
    table: 'payment_connections',
    newData: { tenant_id: tenantId, mp_user_id: tokens.mp_user_id, mp_account_email: tokens.mp_account_email },
  })

  revalidatePath(REDIRECT_BASE)
  return NextResponse.redirect(new URL(`${REDIRECT_BASE}?payment=connected`, req.url))
}
