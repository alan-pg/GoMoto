import type { SupabaseClient } from '@supabase/supabase-js'
import type { MotorcycleCostSummary, MotorcycleFinancialEvent } from '@gomoto/core'

/**
 * Lê a view `motorcycle_cost_summary` (PRD 0002 F1) para todas as motos
 * do tenant atual (RLS faz o filtro). Cada linha é o TCO agregado.
 */
export async function listMotorcycleCostSummary(
  client: SupabaseClient,
): Promise<MotorcycleCostSummary[]> {
  const { data, error } = await client.from('motorcycle_cost_summary').select('*')
  if (error) throw error
  return (data ?? []) as MotorcycleCostSummary[]
}

export async function getMotorcycleCostSummary(
  client: SupabaseClient,
  motorcycleId: string,
): Promise<MotorcycleCostSummary | null> {
  const { data, error } = await client
    .from('motorcycle_cost_summary')
    .select('*')
    .eq('motorcycle_id', motorcycleId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as MotorcycleCostSummary | null
}

/**
 * Lê a view `motorcycle_financial_events` (linha por evento, cross-tipo).
 * Filtra por moto e ordena por data do evento desc — pronto para listar
 * na aba "Custo total" do detalhe.
 */
export async function listMotorcycleFinancialEvents(
  client: SupabaseClient,
  motorcycleId: string,
): Promise<MotorcycleFinancialEvent[]> {
  const { data, error } = await client
    .from('motorcycle_financial_events')
    .select('*')
    .eq('motorcycle_id', motorcycleId)
    .order('event_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as MotorcycleFinancialEvent[]
}
