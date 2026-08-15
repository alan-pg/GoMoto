'use server'

/**
 * Server Actions de despesas (Spec 0014 / ADR 0024).
 *
 * Reescrita sobre `payables`. Duas mudanças de fundo:
 *
 * 1. RESPONSABILIDADE EXISTE. A tabela `expenses` não tinha coluna de
 *    responsabilidade, nem `customer_id`, nem `rental_id` — despesa
 *    compartilhada era inmodelável (F-07). A ADR 0013 afirmava que
 *    `is_company_expense` existia; a coluna nunca existiu.
 *
 * 2. O REPASSE É UM PASSO SÓ. Antes, criar a despesa e gerar a cobrança eram
 *    operações separadas, com o INSERT em `billings` escrito à mão aqui — uma
 *    das três cópias divergentes dessa lógica. Agora `createPayable` cria a
 *    conta a pagar, lança no ledger e gera cobrança ou crédito conforme o
 *    rateio, tudo coerente por construção.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import {
  CreatePayableSchema,
  type ActionResult,
  type ErrorCode,
  type AccountCode,
} from '@gomoto/core'
import { cancelPayable, createPayable, payPayable } from '@/lib/financial'

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
 * Cria a despesa e, havendo parte do cliente, o retorno correspondente.
 *
 * O rateio é validado em `splitResponsibility` antes de tocar o banco, então
 * um rateio incoerente dá erro legível em vez de violação de CHECK.
 */
export async function createExpenseAction(
  raw: unknown,
): Promise<ActionResult<{ payable_id: string; charge_id?: string; credit_id?: string }>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  const parsed = CreatePayableSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Dados inválidos',
        field: first?.path?.map(String).join('.'),
      },
    }
  }

  try {
    const result = await createPayable(ctx.supabase, ctx.tenantId, {
      description: parsed.data.description,
      expenseAccountCode: parsed.data.expense_account_code as AccountCode,
      competenceDate: parsed.data.competence_date,
      dueDate: parsed.data.due_date,
      amount: parsed.data.amount,
      responsibility: parsed.data.responsibility,
      customerId: parsed.data.customer_id ?? null,
      customerAmount: parsed.data.customer_amount,
      reimbursement: parsed.data.reimbursement,
      vehicleId: parsed.data.vehicle_id ?? null,
      rentalId: parsed.data.rental_id ?? null,
      vendorName: parsed.data.vendor_name ?? null,
      attachmentUrl: parsed.data.attachment_url ?? null,
      sourceModule: 'expense',
      createdBy: ctx.userId,
    })

    await logAction({
      action: 'create',
      table: 'payables',
      recordId: result.payableId,
      newData: {
        amount: parsed.data.amount,
        responsibility: parsed.data.responsibility,
        customer_amount: parsed.data.customer_amount,
        charge_id: result.chargeId ?? null,
        credit_id: result.creditId ?? null,
      },
    })

    revalidatePath('/despesas')
    revalidatePath('/cobrancas')
    revalidatePath('/financeiro')
    // O serviço usa camelCase; o contrato das actions é snake_case.
    return {
      ok: true,
      data: {
        payable_id: result.payableId,
        charge_id: result.chargeId,
        credit_id: result.creditId,
      },
    }
  } catch (err) {
    return fail('INTERNAL', toMessage(err))
  }
}

/** Baixa da despesa: dinheiro sai do caixa. */
export async function payExpenseAction(
  payableId: string,
  paidAt: string,
): Promise<ActionResult<void>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  try {
    await payPayable(ctx.supabase, ctx.tenantId, payableId, paidAt, ctx.userId)

    await logAction({
      action: 'update',
      table: 'payables',
      recordId: payableId,
      newData: { status: 'paid', paid_at: paidAt },
    })

    revalidatePath('/despesas')
    revalidatePath('/financeiro')
    return { ok: true, data: undefined }
  } catch (err) {
    return fail('INTERNAL', toMessage(err))
  }
}

/**
 * Cancela a despesa.
 *
 * Não existe excluir: apagar registro financeiro viola o Princípio 3. O
 * cancelamento preserva o histórico e o lançamento original permanece,
 * compensado por estorno.
 */
export async function cancelExpenseAction(
  payableId: string,
): Promise<ActionResult<void>> {
  const ctx = await getContext()
  if (!ctx.ok) return ctx.failure

  const { data: payable, error: readError } = await ctx.supabase
    .from('payables')
    .select('id, status')
    .eq('id', payableId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (readError) return fail('INTERNAL', readError.message)
  if (!payable) return fail('NOT_FOUND', 'Despesa não encontrada')
  if ((payable as { status: string }).status === 'paid') {
    return fail('CONFLICT', 'Despesa já paga não pode ser cancelada.')
  }

  // Delega a `cancelPayable`: marcar o status aqui deixava o lançamento de
  // `payable_created` no razão — custo eterno no DRE e passivo fantasma — e a
  // cobrança de repasse viva, cobrando o cliente por um custo negado.
  try {
    await cancelPayable(ctx.supabase, ctx.tenantId, payableId, ctx.userId)
  } catch (err) {
    return fail('INTERNAL', err instanceof Error ? err.message : String(err))
  }

  await logAction({
    action: 'update',
    table: 'payables',
    recordId: payableId,
    newData: { status: 'cancelled' },
  })

  revalidatePath('/despesas')
  return { ok: true, data: undefined }
}
