'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CustomerSchema } from '@/lib/schemas'
import { logAction } from '@/lib/audit'
import { z } from 'zod'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

const QueueIdSchema = z.string().uuid('Identificador inválido')

const AddCustomerToQueueSchema = CustomerSchema.extend({
  queue_notes: z.string().max(2000).optional().nullable(),
}).superRefine((data, ctx) => {
  if (!data.cpf?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cpf'],
      message: 'CPF é obrigatório',
    })
  }

  if (!data.phone?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'Telefone é obrigatório',
    })
  }
})

const QueueEntryPositionSchema = z.object({
  direction: z.enum(['up', 'down']),
  reason: z.string().trim().min(1, 'Selecione o motivo da movimentação').max(500),
})

const QueueEntryNotesSchema = z.object({
  notes: z.string().max(2000).nullable(),
})

const CloseQueueContractSchema = z.object({
  motorcycle_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de início inválida'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de término inválida').optional().nullable(),
  weekly_amount: z.coerce.number().positive('Valor semanal inválido'),
  initial_km: z.coerce.number().int('Quilometragem inicial inválida').min(0, 'Quilometragem inicial inválida'),
  deposit_paid: z.boolean().optional().default(false),
  deposit_amount: z.coerce.number().min(0, 'Valor da caução inválido').optional().nullable(),
  deposit_payment_method: z.string().max(50).optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.deposit_paid && (!data.deposit_amount || data.deposit_amount <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deposit_amount'],
      message: 'Informe o valor da caução',
    })
  }
})

function revalidateQueuePaths() {
  revalidatePath('/fila')
  revalidatePath('/clientes')
}

function revalidateContractPaths() {
  revalidateQueuePaths()
  revalidatePath('/contratos')
  revalidatePath('/motos')
  revalidatePath('/entradas')
}

function getMoveDownNote(reason: string) {
  const mappedReasons: Record<string, string> = {
    'Possui caução e documentos completos': 'Desceu na fila: Outro candidato possui caução e documentos completos',
    'Aguardando há mais tempo na fila': 'Desceu na fila: Outro candidato aguardava há mais tempo',
  }

  return mappedReasons[reason] ?? 'Desceu na fila: Reordenação da fila'
}

async function normalizeQueuePositions(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: entries, error } = await supabase
    .from('queue_entries')
    .select('id, position')
    .order('position', { ascending: true })

  if (error) return { error: 'Erro ao reorganizar a fila' }

  for (let index = 0; index < (entries ?? []).length; index += 1) {
    const entry = entries![index]
    const expectedPosition = index + 1

    if (entry.position === expectedPosition) continue

    const { error: updateError } = await supabase
      .from('queue_entries')
      .update({ position: expectedPosition })
      .eq('id', entry.id)

    if (updateError) return { error: 'Erro ao reorganizar a fila' }
  }

  return { success: true as const }
}

export async function addCustomerToQueue(rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsed = AddCustomerToQueueSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { queue_notes, ...customerData } = parsed.data

  const customerPayload = {
    ...customerData,
    observations: customerData.observations ?? queue_notes ?? null,
    in_queue: true,
    active: true,
  }

  const { data: lastEntry } = await supabase
    .from('queue_entries')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = (lastEntry?.position ?? 0) + 1

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert(customerPayload)
    .select()
    .single()

  if (customerError) return { error: 'Erro ao adicionar cliente à fila' }

  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      customer_id: customer.id,
      position: nextPosition,
      notes: queue_notes ?? customerData.observations ?? null,
    })
    .select()
    .single()

  if (queueError) {
    await supabase.from('customers').delete().eq('id', customer.id)
    return { error: 'Erro ao adicionar cliente à fila' }
  }

  await logAction({ action: 'create', table: 'customers', recordId: customer.id, newData: customer })
  await logAction({ action: 'create', table: 'queue_entries', recordId: queueEntry.id, newData: queueEntry })
  revalidateQueuePaths()

  return { data: { customer, queueEntry } }
}

export async function removeFromQueue(entryId: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsedId = QueueIdSchema.safeParse(entryId)
  if (!parsedId.success) return { error: 'Identificador inválido' }

  const { data: entry, error: entryError } = await supabase
    .from('queue_entries')
    .select()
    .eq('id', parsedId.data)
    .single()

  if (entryError || !entry) return { error: 'Entrada da fila não encontrada' }

  const { data: customerBefore } = await supabase
    .from('customers')
    .select('id, in_queue')
    .eq('id', entry.customer_id)
    .maybeSingle()

  const { error: deleteError } = await supabase
    .from('queue_entries')
    .delete()
    .eq('id', entry.id)

  if (deleteError) return { error: 'Erro ao remover da fila' }

  const { data: customerAfter, error: customerError } = await supabase
    .from('customers')
    .update({ in_queue: false })
    .eq('id', entry.customer_id)
    .select('id, in_queue')
    .single()

  if (customerError) return { error: 'Erro ao atualizar cliente da fila' }

  const reorderResult = await normalizeQueuePositions(supabase)
  if ('error' in reorderResult) return reorderResult

  await logAction({ action: 'delete', table: 'queue_entries', recordId: entry.id, oldData: entry })
  await logAction({
    action: 'update',
    table: 'customers',
    recordId: entry.customer_id,
    oldData: customerBefore,
    newData: customerAfter,
  })

  revalidateQueuePaths()
  return { success: true }
}

export async function updateQueueEntryPosition(entryId: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsedId = QueueIdSchema.safeParse(entryId)
  if (!parsedId.success) return { error: 'Identificador inválido' }

  const parsed = QueueEntryPositionSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: entries, error: entriesError } = await supabase
    .from('queue_entries')
    .select('id, customer_id, position, notes')
    .order('position', { ascending: true })

  if (entriesError || !entries) return { error: 'Erro ao carregar a fila' }

  const currentEntry = entries.find((entry) => entry.id === parsedId.data)
  if (!currentEntry) return { error: 'Entrada da fila não encontrada' }

  const otherEntry = parsed.data.direction === 'up'
    ? entries.find((entry) => entry.position === currentEntry.position - 1)
    : entries.find((entry) => entry.position === currentEntry.position + 1)

  if (!otherEntry) {
    return {
      error: parsed.data.direction === 'up'
        ? 'Esta entrada já está no topo da fila'
        : 'Esta entrada já está na última posição da fila',
    }
  }

  const currentBefore = { ...currentEntry }
  const otherBefore = { ...otherEntry }

  if (parsed.data.direction === 'up') {
    const { data: otherAfter, error: otherError } = await supabase
      .from('queue_entries')
      .update({
        position: currentEntry.position,
        notes: getMoveDownNote(parsed.data.reason),
      })
      .eq('id', otherEntry.id)
      .select()
      .single()

    if (otherError) return { error: 'Erro ao atualizar posição na fila' }

    const { data: currentAfter, error: currentError } = await supabase
      .from('queue_entries')
      .update({
        position: currentEntry.position - 1,
        notes: `Subiu na fila: ${parsed.data.reason}`,
      })
      .eq('id', currentEntry.id)
      .select()
      .single()

    if (currentError) return { error: 'Erro ao atualizar posição na fila' }

    await logAction({ action: 'update', table: 'queue_entries', recordId: otherEntry.id, oldData: otherBefore, newData: otherAfter })
    await logAction({ action: 'update', table: 'queue_entries', recordId: currentEntry.id, oldData: currentBefore, newData: currentAfter })
  } else {
    const { data: otherAfter, error: otherError } = await supabase
      .from('queue_entries')
      .update({
        position: currentEntry.position,
        notes: 'Subiu na fila: Reordenação da fila',
      })
      .eq('id', otherEntry.id)
      .select()
      .single()

    if (otherError) return { error: 'Erro ao atualizar posição na fila' }

    const { data: currentAfter, error: currentError } = await supabase
      .from('queue_entries')
      .update({
        position: currentEntry.position + 1,
        notes: `Desceu na fila: ${parsed.data.reason}`,
      })
      .eq('id', currentEntry.id)
      .select()
      .single()

    if (currentError) return { error: 'Erro ao atualizar posição na fila' }

    await logAction({ action: 'update', table: 'queue_entries', recordId: otherEntry.id, oldData: otherBefore, newData: otherAfter })
    await logAction({ action: 'update', table: 'queue_entries', recordId: currentEntry.id, oldData: currentBefore, newData: currentAfter })
  }

  revalidatePath('/fila')
  return { success: true }
}

export async function updateQueueEntryNotes(entryId: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsedId = QueueIdSchema.safeParse(entryId)
  if (!parsedId.success) return { error: 'Identificador inválido' }

  const parsed = QueueEntryNotesSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('queue_entries').select().eq('id', parsedId.data).single()

  const { data, error } = await supabase
    .from('queue_entries')
    .update({ notes: parsed.data.notes })
    .eq('id', parsedId.data)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar observações da fila' }

  await logAction({ action: 'update', table: 'queue_entries', recordId: parsedId.data, oldData: before, newData: data })
  revalidatePath('/fila')

  return { data }
}

export async function updateQueueCustomer(customerId: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsedId = QueueIdSchema.safeParse(customerId)
  if (!parsedId.success) return { error: 'Identificador inválido' }

  const parsed = CustomerSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: before } = await supabase.from('customers').select().eq('id', parsedId.data).single()

  const { data, error } = await supabase
    .from('customers')
    .update(parsed.data)
    .eq('id', parsedId.data)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar cliente da fila' }

  await logAction({ action: 'update', table: 'customers', recordId: parsedId.data, oldData: before, newData: data })
  revalidateQueuePaths()

  return { data }
}

export async function closeQueueContract(entryId: string, rawData: unknown) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const parsedId = QueueIdSchema.safeParse(entryId)
  if (!parsedId.success) return { error: 'Identificador inválido' }

  const parsed = CloseQueueContractSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .select('id, customer_id, position, notes')
    .eq('id', parsedId.data)
    .single()

  if (queueError || !queueEntry) return { error: 'Entrada da fila não encontrada' }

  const { data: customer, error: customerLookupError } = await supabase
    .from('customers')
    .select('id, name, in_queue')
    .eq('id', queueEntry.customer_id)
    .single()

  if (customerLookupError || !customer) return { error: 'Cliente da fila não encontrado' }

  const { data: motorcycle, error: motorcycleLookupError } = await supabase
    .from('motorcycles')
    .select('id, license_plate, status, km_current')
    .eq('id', parsed.data.motorcycle_id)
    .single()

  if (motorcycleLookupError || !motorcycle) return { error: 'Motocicleta não encontrada' }
  if (motorcycle.status !== 'available') return { error: 'A motocicleta selecionada não está disponível' }

  const observationParts = [`KM inicial: ${parsed.data.initial_km}`]
  if (parsed.data.observations?.trim()) observationParts.push(parsed.data.observations.trim())

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({
      customer_id: queueEntry.customer_id,
      motorcycle_id: parsed.data.motorcycle_id,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      monthly_amount: parsed.data.weekly_amount,
      status: 'active',
      observations: observationParts.join(' | '),
    })
    .select()
    .single()

  if (contractError) return { error: 'Erro ao fechar contrato' }

  const motorcycleBefore = { ...motorcycle }
  const { data: motorcycleAfter, error: motorcycleError } = await supabase
    .from('motorcycles')
    .update({
      status: 'rented',
      km_current: parsed.data.initial_km,
    })
    .eq('id', parsed.data.motorcycle_id)
    .select()
    .single()

  if (motorcycleError) return { error: 'Erro ao atualizar a motocicleta do contrato' }

  let income: Record<string, unknown> | null = null

  if (parsed.data.deposit_paid && parsed.data.deposit_amount) {
    const { data: createdIncome, error: incomeError } = await supabase
      .from('incomes')
      .insert({
        description: `Caução - ${customer.name}`,
        vehicle: motorcycle.license_plate ?? '',
        date: new Date().toISOString().split('T')[0],
        lessee: customer.name ?? '',
        amount: parsed.data.deposit_amount,
        reference: 'Caucao',
        payment_method: parsed.data.deposit_payment_method ?? 'PIX',
      })
      .select()
      .single()

    if (incomeError) return { error: 'Erro ao registrar a caução' }
    income = createdIncome
  }

  const customerBefore = { ...customer }
  const { data: customerAfter, error: customerError } = await supabase
    .from('customers')
    .update({ in_queue: false })
    .eq('id', queueEntry.customer_id)
    .select('id, name, in_queue')
    .single()

  if (customerError) return { error: 'Erro ao atualizar o cliente da fila' }

  const { error: deleteError } = await supabase
    .from('queue_entries')
    .delete()
    .eq('id', queueEntry.id)

  if (deleteError) return { error: 'Erro ao remover a entrada da fila' }

  const reorderResult = await normalizeQueuePositions(supabase)
  if ('error' in reorderResult) return reorderResult

  await logAction({ action: 'create', table: 'contracts', recordId: contract.id, newData: contract })
  await logAction({ action: 'update', table: 'motorcycles', recordId: motorcycle.id, oldData: motorcycleBefore, newData: motorcycleAfter })
  await logAction({ action: 'update', table: 'customers', recordId: customer.id, oldData: customerBefore, newData: customerAfter })
  await logAction({ action: 'delete', table: 'queue_entries', recordId: queueEntry.id, oldData: queueEntry })

  if (income?.id && typeof income.id === 'string') {
    await logAction({ action: 'create', table: 'incomes', recordId: income.id, newData: income })
  }

  revalidateContractPaths()
  return { data: { contract, income } }
}
