import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContractTemplate } from '@gomoto/core'

export async function listContractTemplates(client: SupabaseClient): Promise<ContractTemplate[]> {
  const { data, error } = await client
    .from('contract_templates')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as ContractTemplate[]
}

export async function getContractTemplate(
  client: SupabaseClient,
  id: string,
): Promise<ContractTemplate> {
  const { data, error } = await client
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as ContractTemplate
}

export async function createContractTemplate(
  client: SupabaseClient,
  payload: Omit<ContractTemplate, 'id' | 'created_at' | 'updated_at'>,
): Promise<ContractTemplate> {
  const { data, error } = await client
    .from('contract_templates')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as ContractTemplate
}

export async function updateContractTemplate(
  client: SupabaseClient,
  id: string,
  payload: Partial<Omit<ContractTemplate, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
): Promise<ContractTemplate> {
  const { data, error } = await client
    .from('contract_templates')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ContractTemplate
}

export async function deleteContractTemplate(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('contract_templates')
    .delete()
    .eq('id', id)
  if (error) throw error
}
