/**
 * PayableService — contas a pagar e rateio de responsabilidade (Spec 0014).
 *
 * Unifica o lado da empresa, hoje espalhado entre `expenses`,
 * `vehicle_obligations`, o custo de `maintenances` e a multa de
 * responsabilidade da empresa.
 *
 * A parte do cliente vira cobrança ou crédito conforme quem executou o serviço
 * — e sempre contra conta de REPASSE, nunca receita: reembolso de despesa não é
 * faturamento (ADR 0024, R-03). Qual linha de DRE aquilo ocupa é política do
 * tenant, não decisão do produto.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACCOUNTS,
  splitResponsibility,
  type AccountCode,
  type Responsibility,
  type ReimbursementMode,
} from '@gomoto/core'
import { postTransaction, dimensionsOf } from './ledger'
import { cancelCharge, createCharge } from './charges'

/** Conta de despesa → conta de repasse correspondente. */
const REIMBURSEMENT_ACCOUNT: Partial<Record<string, AccountCode>> = {
  [ACCOUNTS.MAINTENANCE_EXPENSE]: ACCOUNTS.MAINTENANCE_REIMBURSEMENT,
  [ACCOUNTS.FINE_EXPENSE]: ACCOUNTS.FINE_REIMBURSEMENT,
  [ACCOUNTS.OPERATIONAL_EXPENSE]: ACCOUNTS.OPERATIONAL_REIMBURSEMENT,
  [ACCOUNTS.DOCUMENTATION_EXPENSE]: ACCOUNTS.OPERATIONAL_REIMBURSEMENT,
  [ACCOUNTS.INSURANCE_EXPENSE]: ACCOUNTS.OPERATIONAL_REIMBURSEMENT,
}

export type CreatePayableParams = {
  description: string
  expenseAccountCode: AccountCode
  competenceDate: string
  dueDate: string
  amount: number
  responsibility: Responsibility
  customerId?: string | null
  customerAmount?: number
  reimbursement?: ReimbursementMode
  vehicleId?: string | null
  rentalId?: string | null
  vendorName?: string | null
  sourceModule: string
  sourceId?: string | null
  attachmentUrl?: string | null
  createdBy?: string | null
}

export type CreatedPayable = {
  payableId: string
  /** Cobrança gerada quando o rateio retorna via cobrança. */
  chargeId?: string
  /** Crédito gerado quando o cliente adiantou a despesa. */
  creditId?: string
}

/**
 * Cria a conta a pagar e, havendo parte do cliente, o retorno correspondente.
 */
export async function createPayable(
  supabase: SupabaseClient,
  tenantId: string,
  params: CreatePayableParams,
): Promise<CreatedPayable> {
  // Valida o rateio antes de tocar o banco: erro legível em vez de violação
  // de CHECK. As mesmas cinco regras existem em `payables`.
  const split = splitResponsibility(
    params.amount,
    params.responsibility,
    params.customerAmount ?? 0,
  )

  const reimbursement: ReimbursementMode =
    split.customer_amount === 0 ? 'none' : (params.reimbursement ?? 'charge')

  const { data: payable, error } = await supabase
    .from('payables')
    .insert({
      tenant_id: tenantId,
      description: params.description,
      expense_account_code: params.expenseAccountCode,
      competence_date: params.competenceDate,
      due_date: params.dueDate,
      amount: params.amount,
      responsibility: split.responsibility,
      customer_id: params.customerId ?? null,
      customer_amount: split.customer_amount,
      reimbursement,
      vehicle_id: params.vehicleId ?? null,
      rental_id: params.rentalId ?? null,
      vendor_name: params.vendorName ?? null,
      source_module: params.sourceModule,
      source_id: params.sourceId ?? null,
      attachment_url: params.attachmentUrl ?? null,
      created_by: params.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao criar conta a pagar: ${error.message}`)
  const payableId = (payable as { id: string }).id

  const dimensions = dimensionsOf({
    customerId: params.customerId,
    vehicleId: params.vehicleId,
    rentalId: params.rentalId,
    payableId,
  })

  // Custo integral entra como despesa da empresa. A parte do cliente é
  // recuperada em lançamento separado — nunca abatida aqui dentro, para que
  // custo bruto e repasse continuem visíveis separadamente.
  await postTransaction(supabase, tenantId, {
    event: {
      type: 'payable_created',
      amount: params.amount,
      expense_account: params.expenseAccountCode,
      dimensions,
    },
    description: params.description,
    sourceModule: params.sourceModule,
    sourceId: params.sourceId ?? payableId,
    createdBy: params.createdBy ?? null,
  })

  const result: CreatedPayable = { payableId }

  if (split.customer_amount > 0) {
    const reimbursementAccount =
      REIMBURSEMENT_ACCOUNT[params.expenseAccountCode] ?? ACCOUNTS.OPERATIONAL_REIMBURSEMENT

    if (reimbursement === 'charge') {
      const charge = await createCharge(supabase, tenantId, {
        customerId: params.customerId!,
        rentalId: params.rentalId ?? null,
        dueDate: params.dueDate,
        sourceModule: params.sourceModule,
        // Aponta para o registro que ORIGINOU a despesa — a manutenção, a
        // multa — e não para o payable. É o que torna a origem uniforme entre
        // os módulos: em multas a cobrança já apontava para a multa, e aqui
        // apontava para um payable, com o módulo dizendo 'maintenance'.
        sourceId: params.sourceId ?? payableId,
        createdBy: params.createdBy ?? null,
        items: [
          {
            description: params.description,
            credit_account_code: reimbursementAccount,
            quantity: 1,
            unit_amount: split.customer_amount,
            amount: split.customer_amount,
            vehicle_id: params.vehicleId ?? null,
                },
        ],
      })
      result.chargeId = charge.chargeId
    } else if (reimbursement === 'credit') {
      // Cliente adiantou serviço que cabia à empresa: vira dívida com ele.
      const { data: credit, error: creditError } = await supabase
        .from('customer_credits')
        .insert({
          tenant_id: tenantId,
          customer_id: params.customerId!,
          amount: split.customer_amount,
          origin: params.sourceModule,
          reason: params.description,
          payable_id: payableId,
          created_by: params.createdBy ?? null,
        })
        .select('id')
        .single()

      if (creditError) throw new Error(`Falha ao gerar crédito: ${creditError.message}`)
      result.creditId = (credit as { id: string }).id

      await postTransaction(supabase, tenantId, {
        event: {
          type: 'credit_granted',
          amount: split.customer_amount,
          expense_account: params.expenseAccountCode,
          dimensions,
        },
        description: `Crédito ao cliente — ${params.description}`,
        sourceModule: params.sourceModule,
        sourceId: payableId,
        createdBy: params.createdBy ?? null,
      })
    }
  }

  return result
}

/** Baixa da conta a pagar: dinheiro sai do caixa. */
export async function payPayable(
  supabase: SupabaseClient,
  tenantId: string,
  payableId: string,
  paidAt: string,
  createdBy?: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('payables')
    .select('id, description, amount, status, vehicle_id, rental_id, customer_id')
    .eq('id', payableId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler conta a pagar: ${error.message}`)
  if (!data) throw new Error('Conta a pagar não encontrada')

  const p = data as {
    id: string; description: string; amount: number; status: string
    vehicle_id: string | null; rental_id: string | null
    customer_id: string | null; cost_center_id: string | null
  }

  if (p.status === 'paid') throw new Error('Conta já paga')
  if (p.status === 'cancelled') throw new Error('Conta cancelada não pode ser paga')

  const { error: updateError } = await supabase
    .from('payables')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('id', payableId)
    .eq('tenant_id', tenantId)

  if (updateError) throw new Error(`Falha ao baixar conta: ${updateError.message}`)

  await postTransaction(supabase, tenantId, {
    event: {
      type: 'payable_paid',
      amount: p.amount,
      dimensions: dimensionsOf({
        customerId: p.customer_id,
        vehicleId: p.vehicle_id,
        rentalId: p.rental_id,
        payableId,
      }),
    },
    description: `Pagamento — ${p.description}`,
    sourceModule: 'payable',
    sourceId: payableId,
    createdBy,
  })
}

/**
 * Cancela a conta a pagar, estornando o razão e a cobrança de repasse.
 *
 * Cancelar marcava só `payables.status` e ia embora. O lançamento de
 * `payable_created` continuava lá: o custo permanecia no DRE para sempre e
 * `contas_a_pagar` mostrava dívida que já não existia. Pior no rateio — a
 * cobrança do cliente sobrevivia, cobrando por um custo que a empresa acabara
 * de dizer que não teve.
 *
 * A simetria é a regra: cancelar estorna exatamente o que a criação lançou.
 * Nem mais, nem menos.
 */
export async function cancelPayable(
  supabase: SupabaseClient,
  tenantId: string,
  payableId: string,
  createdBy?: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('payables')
    .select('id, description, amount, status, expense_account_code, customer_id, vehicle_id, rental_id, source_module, source_id')
    .eq('id', payableId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler conta a pagar: ${error.message}`)
  if (!data) throw new Error('Conta a pagar não encontrada')

  const p = data as {
    id: string; description: string; amount: number; status: string
    expense_account_code: AccountCode
    customer_id: string | null; vehicle_id: string | null; rental_id: string | null
    source_module: string; source_id: string | null
  }

  if (p.status === 'paid')      throw new Error('Conta já paga não pode ser cancelada.')
  if (p.status === 'cancelled') throw new Error('Conta já está cancelada.')

  // A cobrança de repasse primeiro: se ela já recebeu pagamento, `cancelCharge`
  // recusa, e nada deve ser desfeito — cancelar a despesa deixando o cliente
  // cobrado seria pior que não cancelar.
  if (p.source_id) {
    const { data: repasse } = await supabase
      .from('charges')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('source_module', p.source_module)
      .eq('source_id', p.source_id)
      .neq('status', 'cancelled')
      .maybeSingle()

    const r = repasse as { id: string } | null
    if (r) {
      await cancelCharge(supabase, tenantId, r.id, `Despesa cancelada — ${p.description}`, createdBy)
    }
  }

  const { error: updateError } = await supabase
    .from('payables')
    .update({ status: 'cancelled' })
    .eq('id', payableId)
    .eq('tenant_id', tenantId)

  if (updateError) throw new Error(`Falha ao cancelar conta: ${updateError.message}`)

  await postTransaction(supabase, tenantId, {
    event: {
      type: 'payable_cancelled',
      amount: p.amount,
      expense_account: p.expense_account_code,
      dimensions: dimensionsOf({
        customerId: p.customer_id,
        vehicleId: p.vehicle_id,
        rentalId: p.rental_id,
        payableId,
      }),
    },
    description: `Cancelamento — ${p.description}`,
    sourceModule: 'payable',
    sourceId: payableId,
    createdBy,
  })
}
