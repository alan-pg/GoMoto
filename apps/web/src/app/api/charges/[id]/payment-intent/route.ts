/**
 * Criação de tentativa de pagamento pelo app do cliente (Spec 0014 / ADR 0024).
 *
 * Substitui `/api/billings/[id]/pix`. Duas mudanças:
 *
 * - o valor vem de `calculateAmountDue`, não de `original_amount − desconto`.
 *   O endpoint antigo ignorava crédito aplicado e encargo de atraso (F-05):
 *   cliente com crédito pagava a mais, cobrança vencida quitava a menos.
 * - o provedor é parâmetro, não premissa. A rota não sabe o que é Mercado Pago.
 *
 * Escrita do cliente mobile via Route Handler com service role, conforme
 * ADR 0016 — o padrão de autenticação não muda, só o que trafega nele.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getOrCreateIntent } from '@/lib/payment/intents'
import { mercadoPagoProvider } from '@/lib/payment/mercadopago-provider'

type RouteContext = { params: Promise<{ id: string }> }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

function log(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: chargeId } = await ctx.params

  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token não fornecido' } }, 401)

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }, 401)

  // Service role: o token do mobile não chega por cookie, então o cliente SSR
  // roda como anon e a RLS bloqueia as leituras necessárias.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: customer } = await admin
    .from('customers')
    .select('id, tenant_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!customer) {
    log('warn', 'intent.customer_not_found', { user_id: user.id, charge_id: chargeId })
    return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Cliente não encontrado' } }, 403)
  }

  const c = customer as { id: string; tenant_id: string }

  // Titularidade: a cobrança precisa ser deste cliente. Sem esta checagem, o
  // service role contornaria a RLS.
  const { data: charge } = await admin
    .from('charges')
    .select('id, customer_id')
    .eq('id', chargeId)
    .eq('tenant_id', c.tenant_id)
    .maybeSingle()

  if (!charge || (charge as { customer_id: string }).customer_id !== c.id) {
    log('warn', 'intent.charge_not_owned', { charge_id: chargeId, customer_id: c.id })
    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }, 404)
  }

  const body = await req.json().catch(() => ({})) as { method?: string }
  const method = body.method ?? 'pix'

  try {
    const result = await getOrCreateIntent(admin, c.tenant_id, chargeId, method, mercadoPagoProvider)
    log('info', 'intent.created', {
      charge_id: chargeId, tenant_id: c.tenant_id, amount: result.amount, reused: result.is_reused,
    })
    return json({ ok: true, data: result })
  } catch (err: unknown) {
    const e = err as Error & { code?: string }

    if (e.code === 'FORBIDDEN') {
      return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Pagamento online não configurado' } }, 403)
    }
    if (e.code === 'NOT_FOUND') {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: e.message } }, 404)
    }
    if (e.code === 'CONFLICT') {
      return json({ ok: false, error: { code: 'CONFLICT', message: e.message } }, 409)
    }

    log('error', 'intent.failed', { charge_id: chargeId, error: e.message })
    return json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao gerar cobrança. Tente novamente.' } }, 500)
  }
}
