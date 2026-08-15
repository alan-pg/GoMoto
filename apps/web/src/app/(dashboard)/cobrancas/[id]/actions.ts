'use server'

/**
 * Server Actions do detalhe da cobrança (Spec 0014 / ADR 0024).
 *
 * Aplicação de crédito e consolidação de encargo. O recebimento e o ciclo de
 * vida do documento ficam em `../actions.ts`.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import {
  applyCredits,
  calculateAccruedCharges,
  type ActionResult,
  type ErrorCode,
  type AvailableCredit,
  type ChargeBalance,
  type LateChargePolicy,
} from '@gomoto/core'
import { postTransaction, dimensionsOf, realizeLateCharge } from '@/lib/financial'

type Failure = { ok: false; error: { code: ErrorCode; message: string } }

function fail(code: ErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } }
}

type Context =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; tenantId: string }
  | { ok: false; failure: Failure }

async function getContext(): Promise<Context> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, failure: fail('UNAUTHORIZED', 'Não autorizado') }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, failure: fail('FORBIDDEN', 'Empresa não resolvida') }

  return { ok: true, supabase, userId: user.id, tenantId }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado'
}

/**
 * Aplica os créditos disponíveis do cliente às cobranças em aberto.
 *
 * Substitui `fn_auto_apply_credit`, que aplicava um único crédito, sobrescrevia
 * o acumulado em vez de somar e engolia qualquer falha com
 * `EXCEPTION WHEN OTHERS` — perdendo dinheiro em silêncio (F-06).
 *
 * Aqui a regra vive em `applyCredits` de @gomoto/core: percorre todos os
 * créditos não expirados e abate a cobrança de vencimento mais antigo.
 */
export async function applyCustomerCredits(
  customerId: string,
): Promise<ActionResult<{ applied: number; total: number }>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  try {
    const [creditsRes, chargesRes] = await Promise.all([
      ctx.supabase
        .from('customer_credits')
        .select('id, amount, expires_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_id', customerId),
      ctx.supabase
        .from('charge_balances')
        .select('charge_id, due_date, total_amount, paid_amount, open_amount')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'open')
        .gt('open_amount', 0),
    ])

    if (creditsRes.error) return fail('INTERNAL', creditsRes.error.message)
    if (chargesRes.error) return fail('INTERNAL', chargesRes.error.message)

    // Saldo real vem da view; a tabela guarda só o valor concedido.
    const { data: balanceRow } = await ctx.supabase
      .from('customer_credit_balances')
      .select('balance')
      .eq('customer_id', customerId)
      .maybeSingle()

    const totalBalance = (balanceRow as { balance: number } | null)?.balance ?? 0
    if (totalBalance <= 0) {
      return { ok: true, data: { applied: 0, total: 0 } }
    }

    const rawCredits = (creditsRes.data ?? []) as {
      id: string; amount: number; expires_at: string | null
    }[]

    // O saldo é do cliente como um todo; distribui proporcionalmente entre os
    // créditos concedidos para decidir qual usar primeiro.
    let restante = totalBalance
    const credits: AvailableCredit[] = rawCredits.map((c) => {
      const available = Math.min(c.amount, Math.max(0, restante))
      restante = round2(restante - available)
      return { id: c.id, amount: c.amount, available, expires_at: c.expires_at }
    })

    const charges = (chargesRes.data ?? []) as ChargeBalance[]
    const { applications } = applyCredits(credits, charges)

    if (applications.length === 0) {
      return { ok: true, data: { applied: 0, total: 0 } }
    }

    let total = 0
    for (const app of applications) {
      const charge = charges.find((c) => c.charge_id === app.charge_id)

      await postTransaction(ctx.supabase, ctx.tenantId, {
        event: {
          type: 'credit_applied',
          amount: app.amount,
          dimensions: dimensionsOf({ customerId, chargeId: app.charge_id }),
        },
        description: `Crédito abatido — cobrança em aberto`,
        sourceModule: 'credit',
        sourceId: app.credit_id,
        createdBy: ctx.userId,
      })

      total = round2(total + app.amount)

      // Cobrança coberta pelo crédito fica paga por consequência: o status é
      // derivado do saldo em `charge_balances`, não gravado.
    }

    await logAction({
      action: 'update',
      table: 'customer_credits',
      recordId: customerId,
      newData: { applications: applications.length, total },
    })

    revalidatePath('/cobrancas')
    revalidatePath('/clientes')
    return { ok: true, data: { applied: applications.length, total } }
  } catch (err) {
    return fail('INTERNAL', toMessage(err))
  }
}

/**
 * Consolida o encargo acumulado como item da cobrança.
 *
 * Enquanto não consolidado, o encargo é valor projetado — não há receita de
 * juros antes de o juro ser efetivamente cobrado (R-06).
 */
export async function consolidateLateCharge(
  chargeId: string,
): Promise<ActionResult<{ amount: number }>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  try {
    const { data: balance, error } = await ctx.supabase
      .from('charge_balances')
      .select('charge_id, due_date, total_amount, paid_amount, open_amount, is_overdue')
      .eq('charge_id', chargeId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()

    if (error) return fail('INTERNAL', error.message)
    if (!balance) return fail('NOT_FOUND', 'Cobrança não encontrada')

    const b = balance as ChargeBalance & { is_overdue: boolean }
    if (!b.is_overdue) return fail('CONFLICT', 'Cobrança não está vencida')

    const { data: charge } = await ctx.supabase
      .from('charges')
      .select('late_charge_policy_id')
      .eq('id', chargeId)
      .maybeSingle()

    const policyId = (charge as { late_charge_policy_id: string | null } | null)?.late_charge_policy_id
    if (!policyId) return fail('CONFLICT', 'Cobrança sem política de encargo definida')

    const { data: policyRow } = await ctx.supabase
      .from('late_charge_policies')
      .select('fee_type, fee_value, daily_interest_rate, grace_period_days, min_amount')
      .eq('id', policyId)
      .maybeSingle()

    if (!policyRow) return fail('NOT_FOUND', 'Política de encargo não encontrada')

    const accrued = calculateAccruedCharges(
      policyRow as LateChargePolicy, b.open_amount, b.due_date,
    )

    if (accrued.total <= 0) {
      return fail('CONFLICT', 'Não há encargo a consolidar (período de carência)')
    }

    await realizeLateCharge(ctx.supabase, ctx.tenantId, chargeId, accrued.total, ctx.userId)

    await logAction({
      action: 'update',
      table: 'charges',
      recordId: chargeId,
      newData: { late_charge_realized: accrued.total, days_overdue: accrued.days_overdue },
    })

    revalidatePath('/cobrancas')
    return { ok: true, data: { amount: accrued.total } }
  } catch (err) {
    return fail('INTERNAL', toMessage(err))
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
