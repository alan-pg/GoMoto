import type { SupabaseClient } from '@supabase/supabase-js'
import type { VehicleCostSummary, VehicleFinancialEvent } from '@gomoto/core'

export async function listVehicleCostSummary(
  client: SupabaseClient,
): Promise<VehicleCostSummary[]> {
  const { data, error } = await client.from('vehicle_cost_summary').select('*')
  if (error) throw error
  return (data ?? []) as VehicleCostSummary[]
}

export async function getVehicleCostSummary(
  client: SupabaseClient,
  vehicleId: string,
): Promise<VehicleCostSummary | null> {
  const { data, error } = await client
    .from('vehicle_cost_summary')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as VehicleCostSummary | null
}

export async function listVehicleFinancialEvents(
  client: SupabaseClient,
  vehicleId: string,
): Promise<VehicleFinancialEvent[]> {
  const { data, error } = await client
    .from('vehicle_financial_events')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as VehicleFinancialEvent[]
}
