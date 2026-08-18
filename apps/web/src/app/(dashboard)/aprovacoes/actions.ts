'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ACCOUNTS, splitResponsibility, resolveReimbursement, type ActionResult } from '@gomoto/core'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { createPayable } from '@/lib/financial/payables'
import { logAction } from '@/lib/audit'

const Schema = z.object({
  record_id: z.string().uuid(),
  effective_executor: z.enum(['company', 'customer']),
  /** Quanto DESTE custo cabe ao cliente. 0 = tudo da empresa. */
  customer_amount: z.number().min(0).default(0),
})

/**
 * Lança o custo da manutenção que o cliente enviou pelo app.
 *
 * Aprovar marcava o registro como `approved` e mais nada. O custo que o cliente
 * informou — e desembolsou, quando foi ele quem levou à oficina — não virava
 * despesa, não virava crédito, não aparecia no resultado do veículo. Sumia.
 *
 * A origem está no comentário que ficou no `handleApprove`: quando a ADR 0024
 * tirou `cost` de `maintenances`, o payload parou de enviá-lo para o UPDATE
 * deixar de falhar. Só que nada passou a criar a conta a pagar no lugar.
 *
 * É o terceiro ponto de entrada com o mesmo defeito. `manutencao.spec.ts` já
 * documenta os dois primeiros: "havia dois caminhos para registrar manutenção
 * concluída, e só um lançava... quem lançava direto digitava o custo e ele
 * morria na tela".
 *
 * `registerCost` não serve aqui porque exige `maintenance_id`, e registro
 * avulso — enviado sem vínculo com o plano — não tem. Os dados de que o
 * lançamento precisa já estão no próprio registro.
 */
export async function registerApprovedRecordCost(
  input: unknown,
): Promise<ActionResult<{ payable_id: string | null; charge_id?: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Tenant não encontrado' } }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Dados inválidos' } }
  }

  const { data: row, error: readError } = await supabase
    .from('maintenance_records')
    .select('id, cost, vehicle_id, customer_id, workshop, notes, created_at')
    .eq('id', parsed.data.record_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (readError || !row) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Registro não encontrado' } }
  }

  const record = row as {
    id: string; cost: number | null; vehicle_id: string; customer_id: string
    workshop: string | null; notes: string | null; created_at: string
  }

  const amount = Number(record.cost ?? 0)
  // Sem custo informado não há o que lançar — e isso é normal: manutenção em
  // garantia, ou o cliente ainda não recebeu a nota.
  if (amount <= 0) return { ok: true, data: { payable_id: null } }

  // Já lançado: aprovar de novo não pode duplicar a despesa.
  const { data: existing } = await supabase
    .from('payables')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source_module', 'maintenance_record')
    .eq('source_id', record.id)
    .maybeSingle()

  if (existing) {
    return { ok: true, data: { payable_id: (existing as { id: string }).id } }
  }

  // Sem locação ativa não há a quem repassar; o custo fica todo da empresa.
  const { data: rental } = await supabase
    .from('rentals')
    .select('id')
    .eq('vehicle_id', record.vehicle_id)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  const customerAmount = Math.min(parsed.data.customer_amount, amount)
  const responsibility =
    customerAmount === 0 ? 'company' : customerAmount === amount ? 'customer' : 'shared'

  // Quem executou desembolsou o total; o reembolso é a parte do OUTRO.
  const reembolso = resolveReimbursement(
    splitResponsibility(amount, responsibility, customerAmount),
    parsed.data.effective_executor,
  )

  const dataStr = record.created_at.slice(0, 10)

  try {
    const { payableId, chargeId } = await createPayable(supabase, tenantId, {
      description: `Manutenção — ${record.notes?.slice(0, 80) ?? 'registro do app'}`,
      expenseAccountCode: ACCOUNTS.MAINTENANCE_EXPENSE,
      competenceDate: dataStr,
      dueDate: dataStr,
      amount,
      responsibility,
      customerId: record.customer_id,
      customerAmount,
      reimbursement: reembolso.mode,
      reimbursementAmount: reembolso.amount,
      // Fato, não dedução: com o cliente levando à oficina, a empresa nunca
      // deveu ao fornecedor.
      paidBy: parsed.data.effective_executor,
      vehicleId: record.vehicle_id,
      rentalId: (rental as { id: string } | null)?.id ?? null,
      vendorName: record.workshop,
      sourceModule: 'maintenance_record',
      sourceId: record.id,
      createdBy: user.id,
    })

    await logAction({
      action: 'create',
      table: 'payables',
      recordId: payableId,
      newData: { origem: 'aprovacao_manutencao', record_id: record.id, amount, executor: parsed.data.effective_executor },
    })

    revalidatePath('/aprovacoes')
    revalidatePath('/despesas')
    revalidatePath('/cobrancas')

    return { ok: true, data: { payable_id: payableId, charge_id: chargeId } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: `Erro ao lançar o custo: ${String(err)}` },
    }
  }
}
