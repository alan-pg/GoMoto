import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreatePix } from '@/lib/payment/pix'
import { GeneratePixSchema } from '@gomoto/core'

type RouteContext = { params: Promise<{ id: string }> }

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: billingId } = await ctx.params

  // Validar billing_id
  const parsed = GeneratePixSchema.safeParse({ billing_id: billingId })
  if (!parsed.success) return json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'ID de cobrança inválido' } }, 400)

  // Autenticar via JWT Bearer
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token não fornecido' } }, 401)

  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }, 401)

  // Resolver tenant via customers.user_id
  const { data: customer } = await supabase
    .from('customers')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!customer) return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Cliente não encontrado' } }, 403)

  // Verificar cobrança pertence ao tenant do cliente
  const { data: billing } = await supabase
    .from('billings')
    .select('id, status, tenant_id, original_amount, discount_amount')
    .eq('id', billingId)
    .eq('tenant_id', customer.tenant_id)
    .maybeSingle()

  if (!billing) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }, 404)
  if (billing.status === 'paid') return json({ ok: false, error: { code: 'CONFLICT', message: 'Esta cobrança já foi paga' } }, 409)

  try {
    const result = await getOrCreatePix(billingId, customer.tenant_id, supabase)
    return json({ ok: true, data: result })
  } catch (err: unknown) {
    const e = err as Error & { code?: string }
    if (e.code === 'FORBIDDEN') return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Integração de pagamento não configurada' } }, 403)
    if (e.code === 'NOT_FOUND') return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada' } }, 404)
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', action: 'pix.generation_failed', billing_id: billingId }))
    return json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao gerar Pix. Tente novamente.' } }, 500)
  }
}
