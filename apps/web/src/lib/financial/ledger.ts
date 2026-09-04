/**
 * Escrita no ledger financeiro (Spec 0014 / ADR 0024).
 *
 * ÚNICO caminho de escrita. Nenhuma Server Action deve inserir em
 * `financial_entries` diretamente — a tradução evento → contas vive em
 * `buildLedgerEntries` de @gomoto/core, e a persistência atômica na RPC
 * `post_financial_transaction`.
 *
 * Nota de arquitetura: este módulo NÃO importa @gomoto/data. O barrel daquele
 * pacote reexporta `context.tsx` (client-only), o que quebraria o boundary
 * Server/Client do Next.js — mesma restrição já observada em multas/actions.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildLedgerEntries,
  type LedgerEvent,
  type LedgerDimensions,
} from '@gomoto/core'

export type PostTransactionInput = {
  event: LedgerEvent
  /** Tipo de evento gravado em `financial_transactions.event_type`. */
  description: string
  sourceModule: string
  sourceId?: string | null
  occurredAt?: Date
  branchId?: string | null
  /** Preenchido quando esta transação estorna outra. */
  reversesTransactionId?: string | null
  createdBy?: string | null
}

/**
 * Grava um fato financeiro: transação + pernas, atomicamente.
 *
 * @returns id da transação criada.
 * @throws Se as pernas não fecharem em zero — barrado em @gomoto/core antes de
 *         tocar o banco, e de novo pela invariante do Postgres no COMMIT.
 */
export async function postTransaction(
  supabase: SupabaseClient,
  tenantId: string,
  input: PostTransactionInput,
): Promise<string> {
  // Falha aqui traz contexto do evento; a barreira do banco é a segunda linha.
  const entries = buildLedgerEntries(input.event)

  const { data, error } = await supabase.rpc('post_financial_transaction', {
    p_tenant_id: tenantId,
    p_transaction: {
      event_type: input.event.type,
      description: input.description,
      occurred_at: (input.occurredAt ?? new Date()).toISOString(),
      source_module: input.sourceModule,
      source_id: input.sourceId ?? null,
      branch_id: input.branchId ?? null,
      reverses_transaction_id: input.reversesTransactionId ?? null,
      created_by: input.createdBy ?? null,
    },
    p_entries: entries.map((e) => ({
      account_code: e.account_code,
      direction: e.direction,
      amount: e.amount,
      customer_id: e.customer_id ?? null,
      vehicle_id: e.vehicle_id ?? null,
      rental_id: e.rental_id ?? null,
      charge_id: e.charge_id ?? null,
      payable_id: e.payable_id ?? null,
      cost_center_id: e.cost_center_id ?? null,
    })),
  })

  if (error) throw new Error(`Falha ao lançar no ledger: ${error.message}`)
  return data as string
}

/**
 * Estorna uma transação, gerando a inversa e amarrando as duas.
 *
 * Correção NUNCA é UPDATE (Princípio 3). O vínculo por
 * `reverses_transaction_id` é único no banco: uma transação só pode ser
 * estornada uma vez.
 */
export async function reverseTransaction(
  supabase: SupabaseClient,
  tenantId: string,
  originalTransactionId: string,
  input: PostTransactionInput,
): Promise<string> {
  return postTransaction(supabase, tenantId, {
    ...input,
    reversesTransactionId: originalTransactionId,
  })
}

/** Dimensões analíticas, montadas a partir do documento de origem. */
export function dimensionsOf(params: {
  customerId?: string | null
  vehicleId?: string | null
  rentalId?: string | null
  chargeId?: string | null
  payableId?: string | null
  costCenterId?: string | null
}): LedgerDimensions {
  return {
    customer_id: params.customerId ?? null,
    vehicle_id: params.vehicleId ?? null,
    rental_id: params.rentalId ?? null,
    charge_id: params.chargeId ?? null,
    payable_id: params.payableId ?? null,
    cost_center_id: params.costCenterId ?? null,
  }
}

/**
 * O dia de hoje no fuso do TENANT.
 *
 * Toda data que vira `occurred_at` de lançamento decide em que MÊS o fato cai
 * no DRE, e não pode sair do relógio de quem clicou: o servidor Node roda no
 * fuso da máquina em dev e em UTC na Vercel, e o navegador roda no fuso do
 * operador. Quem sabe onde o dia termina para o negócio é o banco — a régua
 * está em `fn_business_today`, criada com o fuso por tenant (migration
 * `fuso_horario_por_tenant`).
 *
 * O fallback existe para não derrubar uma baixa por causa de leitura: é a data
 * local do servidor, que erra no máximo por algumas horas na virada do dia,
 * contra perder a operação inteira.
 */
export async function businessToday(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data } = await supabase.rpc('fn_business_today', { p_tenant_id: tenantId })
  if (typeof data === 'string' && data.length >= 10) return data.slice(0, 10)

  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
