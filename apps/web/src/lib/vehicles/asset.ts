/**
 * Dados de ativo do veículo — compra e venda.
 *
 * Por decisão de produto, valor de compra e de venda servem a RELATÓRIO: não
 * geram lançamento no razão. O que eles precisam é estar estruturados de modo
 * que `vehicle_asset_position` consiga responder quanto a frota custou e quanto
 * voltou. Por isso este módulo não chama `postTransaction`.
 *
 * O que ele precisa acertar é a consequência OPERACIONAL da venda: uma moto
 * alienada não é mais frota.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canChangeStatus, type VehicleStatus } from '@gomoto/core'

export type SaleResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT'; message: string }

/**
 * Registra a alienação e tira a moto da frota disponível.
 *
 * Gravava só `sale_value` e `sold_at`, deixando o status intacto. O enum tem
 * `sold` e nada o usava — e `listAvailableVehicles`, que alimenta o seletor de
 * nova locação, filtra exatamente por `status='available'`. A moto vendida
 * continuava sendo oferecida para alugar; verificado na tela.
 *
 * `canChangeStatus` já sabia a resposta e ninguém perguntava. Ela também é o
 * que recusa alienar moto locada (RN-001): dar baixa num ativo que está com o
 * cliente não era impedido por nada.
 */
export async function registerSale(
  supabase: SupabaseClient,
  tenantId: string,
  params: { vehicleId: string; saleValue: number; soldAt: string },
): Promise<SaleResult> {
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, status, sale_value')
    .eq('id', params.vehicleId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!vehicle) return { ok: false, code: 'NOT_FOUND', message: 'Veículo não encontrado' }

  const v = vehicle as { status: VehicleStatus; sale_value: number | null }
  if (v.sale_value) return { ok: false, code: 'CONFLICT', message: 'Veículo já alienado' }

  if (!canChangeStatus(v.status, 'sold')) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: v.status === 'rented'
        ? 'Moto locada não pode ser alienada. Encerre o contrato antes.'
        : `Não é possível alienar um veículo com situação "${v.status}".`,
    }
  }

  const { error } = await supabase
    .from('vehicles')
    .update({ sale_value: params.saleValue, sold_at: params.soldAt, status: 'sold' })
    .eq('id', params.vehicleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`Falha ao registrar alienação: ${error.message}`)
  return { ok: true }
}

/**
 * Cadastra ou corrige o valor de aquisição.
 *
 * Fazia `.update()` sem `.select()`. No PostgREST, update que não encontra
 * linha não é erro: devolve sucesso com zero linhas afetadas. Um id de outro
 * tenant — ou inexistente — respondia "salvo" e não salvava nada. O
 * `.eq('tenant_id')` protege o isolamento, mas transformava a violação em
 * silêncio.
 */
export async function setAcquisitionValue(
  supabase: SupabaseClient,
  tenantId: string,
  params: { vehicleId: string; amount: number },
): Promise<SaleResult> {
  const { data, error } = await supabase
    .from('vehicles')
    .update({ acquisition_amount: params.amount })
    .eq('id', params.vehicleId)
    .eq('tenant_id', tenantId)
    .select('id')

  if (error) throw new Error(`Falha ao gravar valor de aquisição: ${error.message}`)
  if (!data || data.length === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'Veículo não encontrado' }
  }
  return { ok: true }
}
