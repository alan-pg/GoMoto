import type { SupabaseClient } from '@supabase/supabase-js'
import type { VehicleDocument } from '@gomoto/core'

export async function listVehicleDocuments(
  client: SupabaseClient,
  vehicleId: string,
): Promise<VehicleDocument[]> {
  const { data, error } = await client
    .from('vehicle_documents')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('issued_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as VehicleDocument[]
}

export async function getVehicleDocument(
  client: SupabaseClient,
  id: string,
): Promise<VehicleDocument> {
  const { data, error } = await client
    .from('vehicle_documents')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as VehicleDocument
}

export async function createVehicleDocument(
  client: SupabaseClient,
  payload: Omit<VehicleDocument, 'id' | 'created_at' | 'updated_at'>,
): Promise<VehicleDocument> {
  const { data, error } = await client
    .from('vehicle_documents')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as VehicleDocument
}

export async function updateVehicleDocument(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<VehicleDocument, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
): Promise<VehicleDocument> {
  const { data, error } = await client
    .from('vehicle_documents')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as VehicleDocument
}

export async function deleteVehicleDocument(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('vehicle_documents').delete().eq('id', id)
  if (error) throw error
}
