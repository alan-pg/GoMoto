import type { SupabaseClient } from '@supabase/supabase-js'
import type { VehicleObligation } from '@gomoto/core'

export async function listVehicleObligations(
  client: SupabaseClient,
  motorcycleId: string,
): Promise<VehicleObligation[]> {
  const { data, error } = await client
    .from('vehicle_obligations')
    .select('*')
    .eq('motorcycle_id', motorcycleId)
    .order('due_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as VehicleObligation[]
}

export async function getVehicleObligation(
  client: SupabaseClient,
  id: string,
): Promise<VehicleObligation> {
  const { data, error } = await client
    .from('vehicle_obligations')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as VehicleObligation
}

export async function createVehicleObligation(
  client: SupabaseClient,
  payload: Omit<VehicleObligation, 'id' | 'created_at' | 'updated_at'>,
): Promise<VehicleObligation> {
  const { data, error } = await client
    .from('vehicle_obligations')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as VehicleObligation
}

export async function updateVehicleObligation(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<VehicleObligation, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
): Promise<VehicleObligation> {
  const { data, error } = await client
    .from('vehicle_obligations')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as VehicleObligation
}

export async function deleteVehicleObligation(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client.from('vehicle_obligations').delete().eq('id', id)
  if (error) throw error
}
