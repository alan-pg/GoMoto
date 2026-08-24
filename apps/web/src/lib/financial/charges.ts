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
 * Emite uma cobrança com seus itens e lança no ledger — **atomicamente**.
 *
 * Cada item credita a conta que a sua natureza determina: aluguel credita
 * receita, repasse de multa credita conta de repasse. É por isso que a
 * cobrança composta funciona — um documento, várias naturezas econômicas.
 *
 * A orquestração vive em `fn_create_charge`, no banco. Aqui eram três chamadas
 * separadas ao PostgREST — documento, itens, lançamento —, cada uma a sua
 * própria transação: queda de processo entre elas deixava cobrança sem
 * lançamento. Esse é o único estado que o modelo não consegue proibir por
 * trigger, porque o documento é legítimo no instante anterior ao lançamento
 * existir. Uma chamada, uma transação, tudo ou nada.
 */
export async function createCharge(
  supabase: SupabaseClient,
  tenantId: string,
  params: CreateChargeParams,
): Promise<CreatedCharge> {
  const total = round2(params.items.reduce((sum, i) => sum + i.amount, 0))
  if (total <= 0) throw new Error('Cobrança precisa ter valor maior que zero')

  const { data, error } = await supabase.rpc('fn_create_charge', {
    p_tenant_id: tenantId,
    p_charge: {
      customer_id:   params.customerId,
      rental_id:     params.rentalId ?? null,
      due_date:      params.dueDate,
      issue_date:    params.issueDate ?? null,
      source_module: params.sourceModule,
      source_id:     params.sourceId ?? null,
      created_by:    params.createdBy ?? null,
    },
    p_items: params.items.map((i) => ({
      description:         i.description,
      credit_account_code: i.credit_account_code,
      quantity:            i.quantity,
      unit_amount:         i.unit_amount,
      amount:              i.amount,
      vehicle_id:          i.vehicle_id ?? null,
    })),
  })

  if (error) throw new Error(`Falha ao criar cobrança: ${error.message}`)

  const r = data as {
    charge_id: string; charge_number: number
    total_amount: number; transaction_id: string
  }

  return {
    chargeId:    r.charge_id,
    chargeNumber: Number(r.charge_number),
    totalAmount: Number(r.total_amount),
    transactionId: r.transaction_id,
  }
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

  // A perda é despesa e precisa ser atribuída ao veículo, senão o prejuízo
  // não aparece no resultado dele — mesmo defeito que o estorno tinha.
  const { data: itemsBaixa } = await supabase
    .from('charge_items')
    .select('vehicle_id')
    .eq('charge_id', chargeId)

  const vehicleIdBaixa =
    ((itemsBaixa ?? []) as { vehicle_id: string | null }[]).find((i) => i.vehicle_id)?.vehicle_id ?? null

  await postTransaction(supabase, tenantId, {
    event: {
      type: 'charge_written_off',
      amount: balance.open_amount,
      dimensions: dimensionsOf({
        customerId: balance.customer_id,
        rentalId: balance.rental_id,
        vehicleId: vehicleIdBaixa,
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

  // Mesmo veículo da emissão. Sem isto, o encargo entrava no razão com
  // `vehicle_id` nulo e ficava fora de `vehicle_financial_position`, que exige
  // a dimensão: a moto gerava receita de atraso que não aparecia no resultado
  // dela. É o mesmo motivo pelo qual `resolveVehicleId` existe na emissão.
  const vehicleId = await vehicleOfCharge(supabase, tenantId, chargeId, balance.rental_id)

  const { error } = await supabase.from('charge_items').insert({
    tenant_id: tenantId,
    charge_id: chargeId,
    description: `Encargo por atraso (${balance.days_overdue} dias)`,
    credit_account_code: ACCOUNTS.LATE_CHARGE_REVENUE,
    quantity: 1,
    unit_amount: amount,
    amount,
    vehicle_id: vehicleId,
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
        vehicleId,
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
    .select('credit_account_code, amount, vehicle_id')
    .eq('charge_id', chargeId)

  if (error) throw new Error(`Falha ao ler itens: ${error.message}`)

  // O estorno precisa das MESMAS dimensões da emissão. Sem o veículo, a
  // reversão fica fora de `vehicle_financial_position` (que exige
  // `vehicle_id IS NOT NULL`) enquanto a emissão continua dentro: o veículo
  // aparecia recuperando um valor que havia sido cancelado.
  const vehicleId =
    ((items ?? []) as { vehicle_id: string | null }[]).find((i) => i.vehicle_id)?.vehicle_id ?? null

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
          vehicleId,
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
 * Veículo de uma cobrança JÁ emitida.
 *
 * A emissão resolve o veículo e grava nos itens; o que nasce depois — encargo
 * realizado, por exemplo — precisa herdar o mesmo, senão o lançamento fica sem
 * a dimensão e some do resultado do veículo.
 */
async function vehicleOfCharge(
  supabase: SupabaseClient,
  tenantId: string,
  chargeId: string,
  rentalId: string | null,
): Promise<string | null> {
  const { data: items } = await supabase
    .from('charge_items')
    .select('vehicle_id')
    .eq('charge_id', chargeId)
    .not('vehicle_id', 'is', null)
    .limit(1)

  const doItem = ((items ?? []) as { vehicle_id: string | null }[])[0]?.vehicle_id
  if (doItem) return doItem
  if (!rentalId) return null

  const { data } = await supabase
    .from('rentals')
    .select('vehicle_id')
    .eq('id', rentalId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  return (data as { vehicle_id: string | null } | null)?.vehicle_id ?? null
}

/**
 * Resolução de política de encargo e de veículo na EMISSÃO vive no banco,
 * dentro de `fn_create_charge`, na mesma transação que insere a cobrança.
 *
 * Havia aqui uma cópia TypeScript das duas, sem chamador desde que a emissão
 * passou pela RPC. Cópia morta de regra viva é pior que código morto comum: a
 * de política casava `effective_from <= onDate`, e o banco casa
 * `effective_from <= due_date`. Eram duas respostas para "qual política vale",
 * e quem lesse o TypeScript encontrava a errada.
 *
 * `vehicleOfCharge`, acima, é outra coisa e está viva: serve à REALIZAÇÃO do
 * encargo, que acontece depois da emissão e precisa reencontrar o veículo.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
