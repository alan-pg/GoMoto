/**
 * ChargeService — emissão e ciclo de vida da cobrança (Spec 0014).
 *
 * Ponto único de emissão para TODOS os módulos. Hoje, multas, despesas e
 * manutenção têm cada um sua cópia da lógica de sincronizar cobrança em
 * `actions.ts`, e as três já divergiram — `billing_type='fine'` existe no enum
 * mas o módulo de multas grava `'one_time'` (F-19).
 *
 * Um módulo novo passa a declarar `source_module` e emitir itens. Zero DDL,
 * zero cópia de lógica.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACCOUNTS,
  type AccountCode,
  type ChargeItemInput,
} from '@gomoto/core'
import { postTransaction, dimensionsOf } from './ledger'

export type CreateChargeParams = {
  customerId: string
  rentalId?: string | null
  branchId?: string | null
  dueDate: string
  issueDate?: string
  items: ChargeItemInput[]
  sourceModule: string
  sourceId?: string | null
  createdBy?: string | null
}

export type CreatedCharge = {
  chargeId: string
  chargeNumber: number
  totalAmount: number
  transactionId: string
}

/**
 * Emite uma cobrança com seus itens e lança no ledger.
 *
 * Cada item credita a conta que a sua natureza determina: aluguel credita
 * receita, repasse de multa credita conta de repasse. É por isso que a
 * cobrança composta funciona — um documento, várias naturezas econômicas.
 */
export async function createCharge(
  supabase: SupabaseClient,
  tenantId: string,
  params: CreateChargeParams,
): Promise<CreatedCharge> {
  const total = round2(params.items.reduce((sum, i) => sum + i.amount, 0))
  if (total <= 0) throw new Error('Cobrança precisa ter valor maior que zero')

  // Sem veículo no lançamento, a cobrança some do resultado por veículo. Quem
  // cria a cobrança nem sempre tem o veículo à mão — a avulsa, por exemplo, só
  // pede cliente e locação —, então quando a cobrança está vinculada a uma
  // locação o veículo é derivado dela. Item que já traz o seu manda; isto é
  // apenas o piso.
  const vehicleId = await resolveVehicleId(supabase, tenantId, params)

  const { data: numberData, error: numberError } = await supabase.rpc(
    'fn_next_charge_number',
    { p_tenant_id: tenantId },
  )
  if (numberError) throw new Error(`Falha ao numerar cobrança: ${numberError.message}`)
  const chargeNumber = numberData as number

  const policyId = await resolveLateChargePolicy(supabase, tenantId, params.dueDate)

  const { data: charge, error: chargeError } = await supabase
    .from('charges')
    .insert({
      tenant_id: tenantId,
      customer_id: params.customerId,
      rental_id: params.rentalId ?? null,
      branch_id: params.branchId ?? null,
      charge_number: chargeNumber,
      due_date: params.dueDate,
      issue_date: params.issueDate ?? new Date().toISOString().slice(0, 10),
      late_charge_policy_id: policyId,
      created_by: params.createdBy ?? null,
    })
    .select('id')
    .single()

  if (chargeError) throw new Error(`Falha ao criar cobrança: ${chargeError.message}`)
  const chargeId = (charge as { id: string }).id

  const { error: itemsError } = await supabase.from('charge_items').insert(
    params.items.map((i) => ({
      tenant_id: tenantId,
      charge_id: chargeId,
      description: i.description,
      credit_account_code: i.credit_account_code,
      quantity: i.quantity,
      unit_amount: i.unit_amount,
      amount: i.amount,
      source_module: i.source_module,
      source_id: i.source_id ?? null,
      vehicle_id: i.vehicle_id ?? vehicleId,
      cost_center_id: i.cost_center_id ?? null,
    })),
  )
  if (itemsError) throw new Error(`Falha ao gravar itens: ${itemsError.message}`)

  // Uma transação por natureza de conta: agrupa itens que creditam a mesma
  // conta, mantendo a rastreabilidade sem inflar o número de lançamentos.
  const byAccount = new Map<string, number>()
  for (const item of params.items) {
    byAccount.set(
      item.credit_account_code,
      round2((byAccount.get(item.credit_account_code) ?? 0) + item.amount),
    )
  }

  let transactionId = ''
  for (const [account, amount] of byAccount) {
    transactionId = await postTransaction(supabase, tenantId, {
      event: {
        type: 'charge_issued',
        amount,
        credit_account: account as AccountCode,
        dimensions: dimensionsOf({
          customerId: params.customerId,
          rentalId: params.rentalId,
          chargeId,
          vehicleId,
        }),
      },
      description: `Cobrança #${chargeNumber}`,
      sourceModule: params.sourceModule,
      sourceId: params.sourceId ?? null,
      branchId: params.branchId ?? null,
      createdBy: params.createdBy ?? null,
    })
  }

  return { chargeId, chargeNumber, totalAmount: total, transactionId }
}

/**
 * Cancela a cobrança e estorna o lançamento de emissão.
 *
 * Só é permitido enquanto nada foi recebido — cobrança com pagamento alocado
 * exige estorno do pagamento antes.
 */
export async function cancelCharge(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  reason: string,
  createdBy?: string | null,
): Promise<void> {
  const balance = await requireBalance(supabase, chargeId)

  if (balance.paid_amount > 0) {
    throw new Error(
      'Cobrança com pagamento alocado não pode ser cancelada. Estorne o pagamento primeiro.',
    )
  }

  const { error } = await supabase
    .from('charges')
    .update({ status: 'cancelled', cancellation_reason: reason })
    .eq('id', chargeId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`Falha ao cancelar cobrança: ${error.message}`)

  await reverseChargeIssuance(supabase, tenantId, chargeId, balance, {
    description: `Cancelamento da cobrança #${balance.charge_number}`,
    createdBy,
  })
}

/**
 * Baixa por inadimplência: reconhece a perda, sem apagar o recebível original.
 */
export async function writeOffCharge(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  reason: string,
  createdBy?: string | null,
): Promise<void> {
  const balance = await requireBalance(supabase, chargeId)

  if (balance.open_amount <= 0) {
    throw new Error('Cobrança sem saldo em aberto não admite baixa.')
  }

  const { error } = await supabase
    .from('charges')
    .update({ status: 'written_off', cancellation_reason: reason })
    .eq('id', chargeId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`Falha ao dar baixa: ${error.message}`)

  await postTransaction(supabase, tenantId, {
    event: {
      type: 'charge_written_off',
      amount: balance.open_amount,
      dimensions: dimensionsOf({
        customerId: balance.customer_id,
        rentalId: balance.rental_id,
        chargeId,
      }),
    },
    description: `Baixa por inadimplência — cobrança #${balance.charge_number}`,
    sourceModule: 'charge',
    sourceId: chargeId,
    createdBy,
  })
}

/**
 * Materializa o encargo acumulado como item da cobrança.
 *
 * Só aqui o encargo vira receita: antes disso é valor projetado (R-06). É
 * também a razão de `charge_items` aceitar INSERT depois da emissão — o
 * documento não muda, ele acumula.
 */
export async function realizeLateCharge(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  amount: number,
  createdBy?: string | null,
): Promise<void> {
  if (amount <= 0) return

  const balance = await requireBalance(supabase, chargeId)

  const { error } = await supabase.from('charge_items').insert({
    tenant_id: tenantId,
    charge_id: chargeId,
    description: `Encargo por atraso (${balance.days_overdue} dias)`,
    credit_account_code: ACCOUNTS.LATE_CHARGE_REVENUE,
    quantity: 1,
    unit_amount: amount,
    amount,
    source_module: 'late_charge',
    source_id: chargeId,
  })

  if (error) throw new Error(`Falha ao lançar encargo: ${error.message}`)

  await postTransaction(supabase, tenantId, {
    event: {
      type: 'late_charge_realized',
      amount,
      dimensions: dimensionsOf({
        customerId: balance.customer_id,
        rentalId: balance.rental_id,
        chargeId,
      }),
    },
    description: `Encargo realizado — cobrança #${balance.charge_number}`,
    sourceModule: 'late_charge',
    sourceId: chargeId,
    createdBy,
  })
}

// ============================================================
// Internos
// ============================================================

type BalanceRow = {
  charge_id: string
  customer_id: string
  rental_id: string | null
  charge_number: number
  total_amount: number
  paid_amount: number
  open_amount: number
  days_overdue: number
}

async function requireBalance(
  supabase: SupabaseClient,
  chargeId: string,
): Promise<BalanceRow> {
  const { data, error } = await supabase
    .from('charge_balances')
    .select('charge_id, customer_id, rental_id, charge_number, total_amount, paid_amount, open_amount, days_overdue')
    .eq('charge_id', chargeId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler saldo da cobrança: ${error.message}`)
  if (!data) throw new Error('Cobrança não encontrada')
  return data as BalanceRow
}

/** Estorna a emissão, agrupando por conta creditada como na criação. */
async function reverseChargeIssuance(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  balance: BalanceRow,
  opts: { description: string; createdBy?: string | null },
): Promise<void> {
  const { data: items, error } = await supabase
    .from('charge_items')
    .select('credit_account_code, amount')
    .eq('charge_id', chargeId)

  if (error) throw new Error(`Falha ao ler itens: ${error.message}`)

  const byAccount = new Map<string, number>()
  for (const item of (items ?? []) as { credit_account_code: string; amount: number }[]) {
    byAccount.set(
      item.credit_account_code,
      round2((byAccount.get(item.credit_account_code) ?? 0) + item.amount),
    )
  }

  for (const [account, amount] of byAccount) {
    // Inverso exato de charge_issued: debita a conta creditada na emissão e
    // credita o recebível, zerando a dívida do cliente.
    await postTransaction(supabase, tenantId, {
      event: {
        type: 'charge_issuance_reversed',
        amount,
        debit_account: account as AccountCode,
        dimensions: dimensionsOf({
          customerId: balance.customer_id,
          rentalId: balance.rental_id,
          chargeId,
        }),
      },
      description: opts.description,
      sourceModule: 'charge',
      sourceId: chargeId,
      createdBy: opts.createdBy,
    })
  }
}

/**
 * Veículo a atribuir à cobrança.
 *
 * Ordem: o que o item declarar vence; senão, o veículo da locação vinculada.
 *
 * Existe porque `vehicle_financial_position` agrega por
 * `financial_entries.vehicle_id`, e lançamento sem essa dimensão simplesmente
 * não aparece no resultado do veículo. Quem cria a cobrança nem sempre tem o
 * veículo em mãos — a cobrança avulsa pede cliente e locação, não veículo —, e
 * o resultado era receita real sumindo do relatório sem nenhum erro visível.
 */
async function resolveVehicleId(
  supabase: SupabaseClient,
  tenantId: string,
  params: CreateChargeParams,
): Promise<string | null> {
  const doItem = params.items.find((i) => i.vehicle_id)?.vehicle_id
  if (doItem) return doItem
  if (!params.rentalId) return null

  const { data } = await supabase
    .from('rentals')
    .select('vehicle_id')
    .eq('id', params.rentalId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  return (data as { vehicle_id: string | null } | null)?.vehicle_id ?? null
}

async function resolveLateChargePolicy(
  supabase: SupabaseClient,
  tenantId: string,
  onDate: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('late_charge_policies')
    .select('id')
    .eq('tenant_id', tenantId)
    .lte('effective_from', onDate)
    .order('effective_from', { ascending: false })
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as { id: string } | null)?.id ?? null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
