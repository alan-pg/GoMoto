/**
 * Obrigações anuais do veículo (IPVA, licenciamento, DPVAT) — em payables.
 *
 * `vehicle_obligations` perdeu `amount`, `status`, `paid_at`, `payment_method`,
 * `payment_reference` e `receipt_url` na ADR 0024: valor e pagamento são fato
 * financeiro e vivem no payable, não numa coluna paralela que ninguém concilia.
 * A obrigação ficou sendo só o calendário — que imposto, de que ano, vence quando.
 *
 * Dois caminhos gravavam obrigação (criar veículo e editar veículo) e os dois
 * escreviam as colunas removidas. Na edição o erro subia; na criação caía num
 * `warnings.push` e o veículo salvava com as obrigações silenciosamente perdidas.
 * Este módulo é o caminho único dos dois.
 *
 * O valor não é mais descartado: vira `payables`, que é o que aparece no fluxo
 * de caixa e no DRE. Sem payable = nada a pagar (isenta ou ainda sem valor).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNTS, type AccountCode } from '@gomoto/core'
import { createPayable, payPayable } from './payables'

export type ObligationType = 'ipva' | 'licensing' | 'dpvat'

export type ObligationInput = {
  type: ObligationType
  reference_year: number
  due_date: string
  /** 0 ou ausente = obrigação sem valor a pagar (isenta ou ainda não precificada). */
  amount?: number
  /** `paid` quita o payable na mesma operação; `exempt` não gera payable. */
  status?: 'pending' | 'paid' | 'exempt'
}

/** DPVAT é seguro; IPVA e licenciamento são custo de documentação. */
const ACCOUNT_BY_TYPE: Record<ObligationType, AccountCode> = {
  ipva:      ACCOUNTS.DOCUMENTATION_EXPENSE,
  licensing: ACCOUNTS.DOCUMENTATION_EXPENSE,
  dpvat:     ACCOUNTS.INSURANCE_EXPENSE,
}

const LABEL: Record<ObligationType, string> = {
  ipva:      'IPVA',
  licensing: 'Licenciamento',
  dpvat:     'DPVAT',
}

/**
 * Grava as obrigações do veículo e, quando têm valor, a conta a pagar de cada uma.
 *
 * Idempotente por (veículo, tipo, ano): reexecutar não duplica a obrigação, e o
 * índice único por origem em `payables` impede o segundo payable da mesma.
 */
export async function saveVehicleObligations(
  supabase: SupabaseClient,
  tenantId: string,
  vehicleId: string,
  rows: ObligationInput[],
  createdBy?: string | null,
): Promise<void> {
  for (const row of rows) {
    // Sem `upsert`: `vehicle_obligations_year_unique` é um índice PARCIAL, e o
    // ON CONFLICT do PostgREST não sabe repetir o predicado — a chamada morria
    // com "no unique or exclusion constraint matching the ON CONFLICT
    // specification" toda vez, tanto na criação quanto na edição do veículo.
    const { data: existing, error: readError } = await supabase
      .from('vehicle_obligations')
      .select('id, payable_id')
      .eq('tenant_id', tenantId)
      .eq('vehicle_id', vehicleId)
      .eq('type', row.type)
      .eq('reference_year', row.reference_year)
      .maybeSingle()

    if (readError) throw new Error(`Erro ao ler ${LABEL[row.type]}: ${readError.message}`)

    const write = existing
      ? supabase
        .from('vehicle_obligations')
        .update({ due_date: row.due_date, is_exempt: row.status === 'exempt' })
        .eq('id', (existing as { id: string }).id)
        .eq('tenant_id', tenantId)
        .select('id, payable_id')
        .single()
      : supabase
        .from('vehicle_obligations')
        .insert({
          tenant_id:      tenantId,
          vehicle_id:     vehicleId,
          type:           row.type,
          reference_year: row.reference_year,
          due_date:       row.due_date,
          // A isenção precisa ser gravada: é o único dos três estados da tela
          // que não sai da conta a pagar. Descartada, a obrigação virava
          // "custo nunca lançado" e reprovava a documentação do veículo por
          // algo de que ele está dispensado.
          is_exempt:      row.status === 'exempt',
        })
        .select('id, payable_id')
        .single()

    const { data, error } = await write
    if (error) throw new Error(`Erro ao salvar ${LABEL[row.type]}: ${error.message}`)

    const obligation = data as { id: string; payable_id: string | null }
    const amount = row.amount ?? 0

    // Sem valor, isenta, ou já com payable: nada a lançar. Reajustar o valor de
    // uma obrigação já lançada é estornar o payable, não sobrescrevê-lo — e isso
    // pertence à tela de contas a pagar, não ao cadastro do veículo.
    if (amount <= 0 || row.status === 'exempt' || obligation.payable_id) continue

    const { payableId } = await createPayable(supabase, tenantId, {
      description:        `${LABEL[row.type]} ${row.reference_year}`,
      expenseAccountCode: ACCOUNT_BY_TYPE[row.type],
      competenceDate:     row.due_date,
      dueDate:            row.due_date,
      amount,
      responsibility:     'company',
      vehicleId,
      sourceModule:       'vehicle_obligation',
      sourceId:           obligation.id,
      createdBy,
    })

    const { error: linkError } = await supabase
      .from('vehicle_obligations')
      .update({ payable_id: payableId })
      .eq('id', obligation.id)
      .eq('tenant_id', tenantId)

    if (linkError) throw new Error(`Erro ao vincular ${LABEL[row.type]}: ${linkError.message}`)

    if (row.status === 'paid') {
      await payPayable(supabase, tenantId, payableId, row.due_date, createdBy)
    }
  }
}
