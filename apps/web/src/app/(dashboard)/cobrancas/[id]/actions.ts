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
  type ActionResult,
  type ErrorCode,
  type AvailableCredit,
  type ChargeBalance,
} from '@gomoto/core'
import { postTransaction, dimensionsOf, realizeAccruedBefore } from '@/lib/financial'

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
    // Quitar com crédito é quitar. O encargo do atraso precisa ser realizado
    // antes de alocar, como no recebimento em dinheiro — senão quem paga com
    // crédito escapa da multa que já correu, e o mesmo atraso custa diferente
    // conforme a forma de pagamento.
    const { data: aVencer } = await ctx.supabase
      .from('charge_balances')
      .select('charge_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .eq('is_overdue', true)
      .gt('open_amount', 0)

    await realizeAccruedBefore(
      ctx.supabase,
      ctx.tenantId,
      ((aVencer ?? []) as { charge_id: string }[]).map((c) => c.charge_id),
      new Date(),
    )

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

    // O crédito quita a cobrança como qualquer outra forma de pagamento — o que
    // muda é a origem do dinheiro. Sem o par pagamento+alocação, o abatimento
    // existia só no razão e `charge_balances.open_amount` (itens − alocações)
    // continuava cheio: crédito consumido, dívida de pé, cliente cobrado duas
    // vezes.
    const totalAplicado = round2(applications.reduce((s, a) => s + a.amount, 0))

    const { data: pagamento, error: pagErr } = await ctx.supabase
      .from('payments')
      .insert({
        tenant_id:   ctx.tenantId,
        customer_id: customerId,
        amount:      totalAplicado,
        method:      'credit',
        paid_at:     new Date().toISOString(),
        notes:       'Abatimento por crédito do cliente',
        received_by: ctx.userId,
      })
      .select('id')
      .single()

    if (pagErr) return { ok: false, error: { code: 'INTERNAL', message: `Falha ao registrar o abatimento: ${pagErr.message}` } }
    const pagamentoId = (pagamento as { id: string }).id

    const { error: alocErr } = await ctx.supabase.from('payment_allocations').insert(
      applications.map((a) => ({
        tenant_id:  ctx.tenantId,
        payment_id: pagamentoId,
        charge_id:  a.charge_id,
        amount:     a.amount,
        created_by: ctx.userId,
      })),
    )
    if (alocErr) return { ok: false, error: { code: 'INTERNAL', message: `Falha ao alocar o crédito: ${alocErr.message}` } }

    let total = 0
    for (const app of applications) {
      const charge = charges.find((c) => c.charge_id === app.charge_id)

      await postTransaction(ctx.supabase, ctx.tenantId, {
        event: {
          type: 'credit_applied',
          amount: app.amount,
          dimensions: dimensionsOf({ customerId, chargeId: app.charge_id }),
        },
        description: `Crédito abatido — cobrança em aberto (crédito ${app.credit_id})`,
        // A origem é o PAGAMENTO, não o crédito. Abatimento também cria linha
        // em `payments`, e sem esse vínculo o estorno não encontrava o que
        // desfazer: procurava por (source_module='payment', source_id=pagamento)
        // e achava nada — exceção depois de já ter marcado o pagamento como
        // estornado. O crédito de origem segue na descrição.
        sourceModule: 'payment',
        sourceId: pagamentoId,
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


function round2(n: number): number {
  return Math.round(n * 100) / 100
}
