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
import { postTransaction, reverseTransaction, dimensionsOf } from './ledger'
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
  /**
   * Quanto muda de mão entre empresa e cliente. Ausente, é a parte do cliente
   * — o caso "empresa executou e cobra o rateio". Quando o CLIENTE executou, é
   * a parte da EMPRESA, porque ele desembolsou o total.
   */
  reimbursementAmount?: number
  /**
   * Quem entregou o dinheiro ao fornecedor. É FATO, não dedução: com o cliente
   * pagando um custo que também é 100% dele, nada muda de mão e o reembolso é
   * `none` — e daí não dava mais para inferir que a oficina já estava paga. A
   * empresa acabava com despesa e conta a pagar que nunca existiram.
   */
  paidBy?: 'company' | 'customer'
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
 * Cria a conta a pagar e, havendo parte do cliente, o retorno correspondente —
 * **atomicamente**.
 *
 * O custo integral entra como despesa da empresa; a parte do cliente é
 * recuperada em documento separado, nunca abatida aqui dentro, para que custo
 * bruto e repasse continuem visíveis lado a lado.
 *
 * A orquestração vive em `fn_create_payable`, no banco. Aqui eram até seis
 * chamadas separadas — payable, lançamento do custo, cobrança de repasse, itens
 * dela, lançamento dela —, cada uma a sua própria transação. Falha no meio
 * deixava despesa sem repasse: a empresa registrava o custo e nunca cobrava o
 * cliente.
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

  const reembolsavel = params.reimbursementAmount ?? split.customer_amount
  const reimbursement: ReimbursementMode =
    reembolsavel === 0 ? 'none' : (params.reimbursement ?? 'charge')

  const { data, error } = await supabase.rpc('fn_create_payable', {
    p_tenant_id: tenantId,
    p_payable: {
      description:          params.description,
      expense_account_code: params.expenseAccountCode,
      competence_date:      params.competenceDate,
      due_date:             params.dueDate,
      amount:               params.amount,
      responsibility:       split.responsibility,
      customer_id:          params.customerId ?? null,
      customer_amount:      split.customer_amount,
      reimbursement_amount: params.reimbursementAmount ?? split.customer_amount,
      reimbursement,
      paid_by:              params.paidBy ?? 'company',
      vehicle_id:           params.vehicleId ?? null,
      rental_id:            params.rentalId ?? null,
      vendor_name:          params.vendorName ?? null,
      source_module:        params.sourceModule,
      source_id:            params.sourceId ?? null,
      attachment_url:       params.attachmentUrl ?? null,
      created_by:           params.createdBy ?? null,
    },
  })

  if (error) throw new Error(`Falha ao criar conta a pagar: ${error.message}`)

  const r = data as { payable_id: string; charge_id?: string; credit_id?: string }
  const result: CreatedPayable = { payableId: r.payable_id }
  if (r.charge_id) result.chargeId = r.charge_id
  if (r.credit_id) result.creditId = r.credit_id
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
  // Era ler-decidir-escrever em três passos soltos: lia o status, marcava
  // `paid`, lançava no razão. Duas chamadas simultâneas liam `open` antes de
  // qualquer uma gravar e as duas seguiam — o caixa saía duas vezes pela mesma
  // despesa. Reproduzido: R$ 600 para uma conta de R$ 300.
  //
  // A verificação agora acontece sob `FOR UPDATE` dentro da transação que
  // também lança. Quando dinheiro se move, quem decide é o banco.
  const { error } = await supabase.rpc('fn_pay_payable', {
    p_tenant_id: tenantId,
    p_payable_id: payableId,
    p_paid_at: paidAt,
    p_created_by: createdBy ?? null,
  })

  if (!error) return

  // Mensagens que o operador lê na tela. Os códigos vêm da função.
  if (error.message.includes('PAYABLE_ALREADY_PAID')) throw new Error('Conta já paga')
  if (error.message.includes('PAYABLE_CANCELLED')) throw new Error('Conta cancelada não pode ser paga')
  if (error.message.includes('PAYABLE_NOT_FOUND')) throw new Error('Conta a pagar não encontrada')
  throw new Error(`Falha ao baixar conta: ${error.message}`)
}

/**
 * Cancela a conta a pagar e desfaz tudo que o lançamento criou (ADR 0029).
 *
 * Cancelar marcava só `payables.status` e ia embora. O lançamento de
 * `payable_created` continuava lá: o custo permanecia no DRE para sempre e
 * `contas_a_pagar` mostrava dívida que já não existia. Pior no rateio — a
 * cobrança do cliente sobrevivia, cobrando por um custo que a empresa acabara
 * de dizer que não teve.
 *
 * Depois disso passou a estornar, mas em passos soltos daqui: ler o payable,
 * cancelar a cobrança, marcar o status, estornar a transação. Falha no meio
 * deixava metade desfeita — e a guarda do crédito depende de SALDO DERIVADO
 * (`customer_credit_balances`), então ler-decidir-escrever solto deixa dois
 * operadores desfazerem o mesmo crédito.
 *
 * Agora é uma transação só, no banco, sob trava do payable e do cliente. Aqui
 * ficou o que é de tela: traduzir código de erro em frase que o operador
 * entende, com o próximo passo dentro dela.
 *
 * A simetria é a regra: cancelar estorna exatamente o que a criação lançou.
 * Nem mais, nem menos.
 */
export type CancelPayableResult = {
  cancelledChargeId: string | null
  cancelledCreditId: string | null
  reversedTransactions: number
}

export async function cancelPayable(
  supabase: SupabaseClient,
  tenantId: string,
  payableId: string,
  reason: string,
  createdBy?: string | null,
): Promise<CancelPayableResult> {
  const { data, error } = await supabase.rpc('fn_cancel_payable', {
    p_tenant_id: tenantId,
    p_payable_id: payableId,
    p_reason: reason,
    p_created_by: createdBy ?? null,
  })

  if (error) {
    // As duas primeiras são as recusas do ADR 0029: dinheiro de terceiro se
    // moveu, e desfazer isso é decisão dele, não efeito colateral. A mensagem
    // aponta o botão que já existe.
    if (error.message.includes('CHARGE_HAS_PAYMENT')) {
      throw new Error(
        'A cobrança de repasse já recebeu pagamento. Estorne o pagamento na cobrança '
        + 'e depois cancele — o cliente pagou por isto e tem direito de volta.',
      )
    }
    if (error.message.includes('CREDIT_ALREADY_USED')) {
      throw new Error(
        'O crédito gerado já foi usado ou devolvido ao cliente. Estorne o abatimento na '
        + 'cobrança em que ele foi aplicado — isso devolve o saldo e libera o cancelamento.',
      )
    }
    if (error.message.includes('PAYABLE_ALREADY_CANCELLED')) throw new Error('Conta já está cancelada.')
    if (error.message.includes('PAYABLE_NOT_FOUND')) throw new Error('Conta a pagar não encontrada')
    if (error.message.includes('CANCEL_REASON_REQUIRED')) throw new Error('Informe o motivo do cancelamento.')
    throw new Error(`Falha ao cancelar conta: ${error.message}`)
  }

  const r = (data ?? {}) as {
    cancelled_charge_id?: string | null
    cancelled_credit_id?: string | null
    reversed_transactions?: number
  }

  return {
    cancelledChargeId: r.cancelled_charge_id ?? null,
    cancelledCreditId: r.cancelled_credit_id ?? null,
    reversedTransactions: r.reversed_transactions ?? 0,
  }
}
