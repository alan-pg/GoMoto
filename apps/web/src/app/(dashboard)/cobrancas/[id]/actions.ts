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
 * Abate crédito do cliente NESTA cobrança, no valor informado.
 *
 * A versão anterior recebia só o `customerId` e varria todo o saldo para as
 * cobranças mais antigas em aberto. O modal pedia qual crédito e quanto,
 * validava os dois e descartava: abrir a cobrança #7, escolher R$ 50 e ver
 * R$ 200 abatidos na #3 era o comportamento correto do código e o oposto do
 * que a tela prometia.
 *
 * A regra e as guardas moram em `fn_apply_customer_credit`, sob trava do
 * cliente: ler-saldo, decidir e escrever solto aqui deixava dois operadores
 * gastarem o mesmo crédito ao mesmo tempo.
 *
 * O encargo do atraso é realizado ANTES — quitar com crédito é quitar, e quem
 * paga assim não pode escapar da multa que já correu.
 */
export async function applyCustomerCredits(
  input: { customer_id: string; charge_id: string; amount: number },
): Promise<ActionResult<{ total: number }>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail('VALIDATION_ERROR', 'Informe um valor maior que zero.')
  }

  try {
    await realizeAccruedBefore(ctx.supabase, ctx.tenantId, [input.charge_id], new Date())

    const { error } = await ctx.supabase.rpc('fn_apply_customer_credit', {
      p_tenant_id:   ctx.tenantId,
      p_customer_id: input.customer_id,
      p_charge_id:   input.charge_id,
      p_amount:      amount,
      p_created_by:  ctx.userId,
    })

    if (error) {
      const conhecidos: [string, string][] = [
        ['AMOUNT_EXCEEDS_BALANCE', 'O cliente não tem esse saldo de crédito.'],
        ['AMOUNT_EXCEEDS_CHARGE', 'O valor passa do que esta cobrança ainda deve.'],
        ['CHARGE_BELONGS_TO_ANOTHER_CUSTOMER', 'Esta cobrança é de outro cliente.'],
        ['CHARGE_NOT_FOUND', 'Cobrança não encontrada.'],
        ['CUSTOMER_NOT_FOUND', 'Cliente não encontrado.'],
      ]
      const achado = conhecidos.find(([k]) => error.message.includes(k))
      return achado
        ? fail('VALIDATION_ERROR', achado[1])
        : fail('INTERNAL', error.message)
    }

    await logAction({
      action: 'update',
      table: 'customer_credits',
      recordId: input.customer_id,
      newData: { charge_id: input.charge_id, amount },
    })

    revalidatePath('/cobrancas')
    revalidatePath('/clientes')
    return { ok: true, data: { total: amount } }
  } catch (err) {
    return fail('INTERNAL', toMessage(err))
  }
}


function round2(n: number): number {
  return Math.round(n * 100) / 100
}
