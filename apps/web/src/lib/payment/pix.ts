import type { SupabaseClient } from '@supabase/supabase-js'
import { createPixCharge, refreshAccessToken } from './mercadopago'
import type { PixResult } from '@gomoto/core'

export async function getOrCreatePix(
  billingId: string,
  tenantId: string,
  supabase: SupabaseClient,
): Promise<PixResult> {
  // 1. Verificar Pix ativo existente
  const { data: activePix } = await supabase
    .from('billing_pix')
    .select('qr_code, qr_code_base64, expires_at')
    .eq('billing_id', billingId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (activePix) {
    return {
      qr_code:        activePix.qr_code,
      qr_code_base64: activePix.qr_code_base64,
      expires_at:     activePix.expires_at,
      is_reused:      true,
    }
  }

  // 2. Expirar Pix ativo vencido (se existir)
  await supabase
    .from('billing_pix')
    .update({ status: 'expired' })
    .eq('billing_id', billingId)
    .eq('status', 'active')

  // 3. Buscar credenciais do tenant
  const { data: conn, error: connErr } = await supabase
    .from('payment_connections')
    .select('access_token, refresh_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (connErr || !conn) throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })

  // 4. Buscar dados da cobrança
  const { data: billing, error: billErr } = await supabase
    .from('billings')
    .select('id, original_amount, discount_amount, customers(email, name)')
    .eq('id', billingId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (billErr || !billing) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })

  const amount = (billing.original_amount ?? 0) - (billing.discount_amount ?? 0)
  const customer = billing.customers as { email?: string | null; name?: string | null } | null
  const customerEmail = customer?.email ?? 'cliente@gomoto.app'
  const nameParts = (customer?.name ?? '').trim().split(/\s+/)
  const customerFirstName = nameParts[0] ?? 'Cliente'
  const customerLastName  = nameParts.length > 1 ? nameParts.slice(1).join(' ') : customerFirstName

  // 5. Criar Pix no MP (com 1 retry em caso de token expirado)
  let charge
  try {
    charge = await createPixCharge({
      amount,
      billingId,
      customerEmail,
      customerFirstName,
      customerLastName,
      accessToken: conn.access_token,
    })
  } catch (err: unknown) {
    const mpErr = err as Error & { status?: number }
    if (mpErr.status === 401) {
      const refreshed = await refreshAccessToken(conn.refresh_token)
      await supabase
        .from('payment_connections')
        .update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token })
        .eq('tenant_id', tenantId)
      charge = await createPixCharge({
        amount,
        billingId,
        customerEmail,
        customerFirstName,
        customerLastName,
        accessToken: refreshed.access_token,
      })
    } else {
      throw err
    }
  }

  // 6. Persistir billing_pix
  const { error: insertErr } = await supabase.from('billing_pix').insert({
    billing_id:     billingId,
    tenant_id:      tenantId,
    mp_payment_id:  charge.mp_payment_id,
    qr_code:        charge.qr_code,
    qr_code_base64: charge.qr_code_base64,
    expires_at:     charge.expires_at,
    status:         'active',
  })

  if (insertErr) {
    console.error(`[PIX] billing_pix insert failed: ${insertErr.message} code=${insertErr.code}`)
    throw new Error(`Failed to persist billing_pix: ${insertErr.message}`)
  }

  return {
    qr_code:        charge.qr_code,
    qr_code_base64: charge.qr_code_base64,
    expires_at:     charge.expires_at,
    is_reused:      false,
  }
}
