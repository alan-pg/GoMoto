'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  FineSchema,
  ExtractDocumentFileSchema,
  ACCOUNTS,
  type ActionResult, type ExtractionResult, type FineNoticeFields, type Fine, type LateChargeConfig,
} from '@gomoto/core'
import { logAction } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { extractFields } from '@/lib/document-extraction/extract'
import { createCharge, cancelCharge, createPayable, payPayable } from '@/lib/financial'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface FineDuplicateMatch {
  id: string
  description: string
  amount: number
}

/**
 * RF-007/RN-001: procura multa existente do mesmo tenant com o mesmo RENAINF
 * (preferencial) ou AIT (fallback, quando a multa não tem RENAINF — RN-002).
 * Query fica inline (não em `@gomoto/data`) porque o barrel do pacote reexporta
 * `context.tsx` (client-only, `createContext`) — importar em Server Action quebra
 * o boundary Server/Client do Next.js. Nenhuma outra action deste arquivo importa
 * `@gomoto/data`; todas fazem query direta com o `supabase` local, mesmo padrão.
 */
async function findDuplicateFine(
  supabase: Supabase,
  tenantId: string,
  params: { renainfNumber?: string | null; aitNumber?: string | null },
): Promise<FineDuplicateMatch | null> {
  const { renainfNumber, aitNumber } = params
  if (!renainfNumber && !aitNumber) return null

  let query = supabase
    .from('fines')
    .select('id, description, amount')
    .eq('tenant_id', tenantId)

  query = renainfNumber ? query.eq('renainf_number', renainfNumber) : query.eq('ait_number', aitNumber as string)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as FineDuplicateMatch | null
}

// Mesmo default hardcoded usado em manutencao/[id]/actions.ts::confirmAutoBilling
// (RF-017) — não existe leitura de FinancialSettingsSchema.late_charge_defaults do
// tenant em nenhum dos dois fluxos hoje; mantendo consistente entre os dois.
const DEFAULT_LATE_CHARGE_CONFIG: LateChargeConfig = {
  late_fee_type:       'percentage',
  late_fee_value:      0.02,
  daily_interest_rate: 0.001,
  grace_period_days:   3,
}

interface SyncFineBillingParams {
  fineId: string
  tenantId: string
  responsible: 'customer' | 'company'
  amount: number
  dueDate: string | null
  customerId: string | null
  rentalId: string | null
  vehicleId?: string | null
  /** Data da infração — competência do custo, quando a empresa é a responsável. */
  infractionDate?: string | null
  userId?: string | null
}

type SyncFineBillingResult =
  | { ok: true; billingId: string | null }
  | { ok: false; error: string }

/**
 * Mantém `billings` (fine_id/source='fine') em sincronia com `responsible` e
 * `amount` da multa — chamada em todo create/update, idempotente:
 *  - responsible='company' → cancela cobrança ativa, se houver (bloqueia se
 *    já paga: não se cancela um pagamento real, RN nova confirmada com o usuário).
 *  - responsible='customer' → cria (se não existe) ou atualiza valor/vencimento
 *    (se existe e ainda não foi paga — cobrança paga fica congelada).
 */
/** Payable já lançado para esta multa, se houver. */
async function payableDaMulta(
  supabase: Supabase,
  tenantId: string,
  fineId: string,
): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase
    .from('payables')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('source_module', 'fine')
    .eq('source_id', fineId)
    .neq('status', 'cancelled')
    .maybeSingle()

  return (data as { id: string; status: string } | null) ?? null
}

async function syncFineBilling(supabase: Supabase, params: SyncFineBillingParams): Promise<SyncFineBillingResult> {
  const { fineId, tenantId, responsible, amount, dueDate, customerId, rentalId, vehicleId, infractionDate, userId } = params

  // Origem por (source_module, source_id) — uniforme para todos os módulos.
  // Antes era a coluna dedicada `billings.fine_id`, que obrigava DDL a cada
  // módulo novo (F-11).
  const { data: existingItem } = await supabase
    .from('charge_items')
    .select('charge_id')
    .eq('tenant_id', tenantId)
    .eq('source_module', 'fine')
    .eq('source_id', fineId)
    .maybeSingle()

  const existingChargeId = (existingItem as { charge_id: string } | null)?.charge_id ?? null

  let existing: { id: string; status: string; paid_amount: number } | null = null
  if (existingChargeId) {
    const { data } = await supabase
      .from('charge_balances')
      .select('charge_id, status, paid_amount')
      .eq('charge_id', existingChargeId)
      .maybeSingle()

    const b = data as { charge_id: string; status: string; paid_amount: number } | null
    if (b && b.status !== 'cancelled') {
      existing = { id: b.charge_id, status: b.status, paid_amount: b.paid_amount }
    }
  }

  // A multa é SEMPRE despesa da empresa: o auto é lavrado contra o veículo, e
  // quem responde ao órgão é a proprietária. Ser "do cliente" não muda quem
  // desembolsa — muda apenas se existe recuperação depois.
  //
  // Enquanto a despesa só era lançada no caso `company`, uma multa repassada
  // creditava `repasse_multa` sem `despesa_multa` do outro lado: o DRE mostrava
  // LUCRO de R$ 300 numa multa de R$ 300. Recuperação sem custo é contradição
  // no próprio nome da conta.
  const jaTemPayable = await payableDaMulta(supabase, tenantId, fineId)
  if (!jaTemPayable) {
    try {
      await createPayable(supabase, tenantId, {
        description: `Multa — ${fineId}`,
        expenseAccountCode: ACCOUNTS.FINE_EXPENSE,
        competenceDate: infractionDate ?? dueDate ?? new Date().toISOString().slice(0, 10),
        dueDate: dueDate ?? new Date().toISOString().slice(0, 10),
        amount,
        // Sempre `company`: o rateio ao cliente não passa por aqui, e sim pela
        // cobrança de repasse abaixo — assim trocar o responsável não exige
        // desfazer a despesa.
        responsibility: 'company',
        // O cliente entra como DIMENSÃO, não como rateio: `responsibility`
        // segue 'company' e nenhuma cobrança nasce daqui. Sem essa dimensão, o
        // custo da multa ficava sem dono em `customer_financial_position` — o
        // repasse contava para o cliente e a despesa não, e ele aparecia com
        // lucro no valor da multa. O mesmo erro que a multa tinha no DRE.
        customerId: customerId ?? null,
        vehicleId: vehicleId ?? null,
        rentalId: rentalId ?? null,
        sourceModule: 'fine',
        sourceId: fineId,
        createdBy: userId ?? null,
      })
      // Sem vínculo de volta: `payables.source_module/source_id` já aponta
      // para a multa, e `payableDaMulta` consulta por aí. A coluna
      // `fines.payable_id` era só escrita, nunca lida.
    } catch (err) {
      return { ok: false, error: `Erro ao lançar o custo da multa: ${String(err)}` }
    }
  }

  if (responsible === 'company') {
    // Sem recuperação: se havia cobrança ao cliente, ela deixa de valer.
    if (existing) {
      if (existing.paid_amount > 0) {
        return { ok: false, error: 'Não é possível mudar o responsável para empresa: o cliente já pagou parte desta cobrança.' }
      }

      try {
        await cancelCharge(supabase, tenantId, existing.id, 'Multa passou a ser de responsabilidade da empresa', userId)
      } catch (err) {
        return { ok: false, error: `Erro ao cancelar cobrança: ${String(err)}` }
      }
    }

    return { ok: true, billingId: null }
  }

  // responsible === 'customer'
  if (!dueDate) return { ok: false, error: 'Data de vencimento é obrigatória para gerar a cobrança do cliente' }
  if (!customerId) return { ok: false, error: 'Selecione o cliente (via locação) para gerar a cobrança' }

  // Documento emitido é imutável (Princípio 5): não se reescreve valor nem
  // vencimento. Alterar a multa cancela a cobrança anterior e emite outra.
  if (existing) {
    if (existing.paid_amount > 0) return { ok: true, billingId: existing.id }

    try {
      await cancelCharge(supabase, tenantId, existing.id, 'Substituída por revisão da multa', userId)
    } catch (err) {
      return { ok: false, error: `Erro ao substituir cobrança: ${String(err)}` }
    }
  }

  try {
    // Repasse credita conta de REPASSE, não receita: a multa é custo da empresa
    // recuperado do cliente, e a linha de DRE é política do tenant (R-03).
    const charge = await createCharge(supabase, tenantId, {
      customerId,
      rentalId: rentalId ?? null,
      dueDate,
      sourceModule: 'fine',
      sourceId: fineId,
      createdBy: userId,
      items: [{
        description: 'Multa de trânsito',
        credit_account_code: ACCOUNTS.FINE_REIMBURSEMENT,
        quantity: 1,
        unit_amount: amount,
        amount,
        vehicle_id: vehicleId ?? null,
      }],
    })
    return { ok: true, billingId: charge.chargeId }
  } catch (err) {
    return { ok: false, error: `Erro ao gerar cobrança: ${String(err)}` }
  }
}

type CreateFineResult =
  | { error: string; details?: unknown }
  | { error: string; code: 'DUPLICATE_FINE'; existingFineId: string }
  | { data: Fine }

export async function createFine(rawData: unknown, rentalId?: string | null): Promise<CreateFineResult> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const parsed = FineSchema.safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  if (parsed.data.responsible === 'customer' && !parsed.data.due_date) {
    return { error: 'Data de vencimento é obrigatória quando o responsável é o cliente' }
  }

  // RF-007/RN-001: RENAINF (ou AIT, na ausência) já identifica outra multa do tenant —
  // trava final, cobre tanto o caso sem extração quanto RENAINF editado manualmente.
  const duplicate = await findDuplicateFine(supabase, tenantId, {
    renainfNumber: parsed.data.renainf_number,
    aitNumber: parsed.data.ait_number,
  })
  if (duplicate) {
    return {
      error: 'Já existe uma multa com este RENAINF/AIT',
      code: 'DUPLICATE_FINE' as const,
      existingFineId: duplicate.id,
    }
  }

  const { data, error } = await supabase
    .from('fines')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()

  if (error) {
    // Sem este log, uma coluna removida vira "Erro ao registrar multa" na tela
    // e silêncio no servidor — foi exatamente assim que a queda do cadastro
    // passou despercebida por dias.
    console.error('[createFine] insert_failed', { message: error.message, details: error.details })
    return { error: `Erro ao registrar multa: ${error.message}` }
  }

  // Gera a cobrança já na criação, se responsável=cliente. Multa já foi salva
  // (sem risco de duplicar) — falha aqui não desfaz o cadastro, só fica sem
  // cobrança até o operador editar e tentar de novo.
  const billingSync = await syncFineBilling(supabase, {
    fineId:      data.id,
    tenantId,
    responsible: parsed.data.responsible,
    amount:      parsed.data.amount,
    dueDate:     parsed.data.due_date ?? null,
    customerId:  parsed.data.customer_id ?? null,
    rentalId:    rentalId ?? null,
    vehicleId:   parsed.data.vehicle_id,
    infractionDate: parsed.data.infraction_date,
    userId:      user.id,
  })
  if (!billingSync.ok) {
    console.error('[createFine] billing_sync_failed', { fine_id: data.id, error: billingSync.error })
  }

  await logAction({ action: 'create', table: 'fines', recordId: data.id, newData: data })
  revalidatePath('/multas')
  revalidatePath('/cobrancas')
  return { data }
}

export async function updateFine(
  id: string,
  rawData: unknown,
  rentalId?: string | null,
): Promise<{ error: string; details?: unknown } | { data: Fine }> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido' }

  const parsed = FineSchema.partial().safeParse(rawData)
  if (!parsed.success) return { error: 'Dados inválidos', details: parsed.error.flatten() }

  if (parsed.data.responsible === 'customer' && parsed.data.due_date === null) {
    return { error: 'Data de vencimento é obrigatória quando o responsável é o cliente' }
  }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()
  if (!before) return { error: 'Multa não encontrada' }

  // Sincroniza a cobrança ANTES de gravar a multa — se estiver bloqueado
  // (cobrança já paga e responsável mudando pra empresa), a multa nem chega a
  // ser alterada, evitando ficar com responsible='company' e cobrança de
  // cliente paga ainda pendurada.
  const billingSync = await syncFineBilling(supabase, {
    fineId:      id,
    tenantId,
    responsible: parsed.data.responsible ?? before.responsible,
    amount:      parsed.data.amount ?? before.amount,
    dueDate:     parsed.data.due_date !== undefined ? parsed.data.due_date : before.due_date,
    customerId:  parsed.data.customer_id !== undefined ? parsed.data.customer_id : before.customer_id,
    rentalId:    rentalId ?? null,
    vehicleId:   parsed.data.vehicle_id ?? before.vehicle_id,
    infractionDate: parsed.data.infraction_date ?? before.infraction_date,
    userId:      user.id,
  })
  if (!billingSync.ok) return { error: billingSync.error }

  const { data, error } = await supabase
    .from('fines')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: 'Erro ao atualizar multa' }

  await logAction({ action: 'update', table: 'fines', recordId: id, oldData: before, newData: data })
  revalidatePath('/multas')
  revalidatePath('/cobrancas')
  return { data }
}

/**
 * Registra o pagamento da multa pela empresa.
 *
 * Antes escrevia `status`/`payment_date` na própria multa — colunas removidas
 * pela ADR 0024, então a ação falhava sempre. Pagamento de multa é fato
 * financeiro: quita o payable e sai como saída de caixa no ledger.
 *
 * Multa de responsabilidade do cliente não passa por aqui: o dinheiro dele
 * entra pela cobrança, em /cobrancas.
 */
export async function markFineAsPaid(id: string, paymentDate: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido para o usuário' }

  const payable = await payableDaMulta(supabase, tenantId, id)
  if (!payable) {
    return { error: 'Esta multa não tem conta a pagar. Multa do cliente é quitada pela cobrança, em Cobranças.' }
  }
  if (payable.status === 'paid') return { error: 'Esta multa já está paga' }

  try {
    await payPayable(supabase, tenantId, payable.id, paymentDate, user.id)
  } catch (err) {
    console.error('[markFineAsPaid] pay_payable_failed', { fine_id: id, error: String(err) })
    return { error: `Erro ao registrar o pagamento: ${String(err)}` }
  }

  await logAction({ action: 'update', table: 'payables', recordId: payable.id, newData: { status: 'paid', paid_at: paymentDate } })
  revalidatePath('/multas')
  revalidatePath('/despesas')
  return { data: { payableId: payable.id } }
}

export async function deleteFine(id: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fines').select().eq('id', id).single()
  const { error } = await supabase.from('fines').delete().eq('id', id)

  if (error) return { error: 'Erro ao excluir multa' }

  await logAction({ action: 'delete', table: 'fines', recordId: id, oldData: before })
  revalidatePath('/multas')
  return { success: true }
}

export async function addFineAttachment(
  fineId: string,
  type: string,
  fileUrl: string,
  label?: string,
  notes?: string,
) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) return { error: 'Tenant não resolvido' }

  const { data, error } = await supabase
    .from('fine_attachments')
    .insert({ fine_id: fineId, tenant_id: tenantId, type, file_url: fileUrl, label: label ?? null, notes: notes ?? null })
    .select()
    .single()

  if (error) return { error: 'Erro ao salvar anexo' }

  await logAction({ action: 'create', table: 'fine_attachments', recordId: data.id, newData: data })
  revalidatePath(`/multas/${fineId}`)
  return { data }
}

export async function deleteFineAttachment(attachmentId: string, fineId: string, fileUrl: string) {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) return { error: 'Não autorizado' }

  const { data: before } = await supabase.from('fine_attachments').select().eq('id', attachmentId).single()
  const { error } = await supabase.from('fine_attachments').delete().eq('id', attachmentId)
  if (error) return { error: 'Erro ao remover anexo' }

  await supabase.storage.from('fine-documents').remove([fileUrl])

  await logAction({ action: 'delete', table: 'fine_attachments', recordId: attachmentId, oldData: before })
  revalidatePath(`/multas/${fineId}`)
  return { success: true }
}

export type FineNoticeExtraction = ExtractionResult<FineNoticeFields> & {
  /** RF-007: multa existente com o mesmo RENAINF/AIT, se houver — aviso antecipado antes de salvar. */
  duplicateOf: FineDuplicateMatch | null
}

/**
 * PRD 0012/Spec 0012 §5.1 — extrai campos da NA (Notificação de Autuação, PRD
 * 0013/RF-005) via IA pra pré-preencher o FineForm. Não persiste nada (RN-001).
 */
export async function extractFineNoticeFields(formData: FormData): Promise<ActionResult<FineNoticeExtraction>> {
  const { supabase, user } = await getAuthenticatedUser()
  if (!user) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }
  }

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Tenant não resolvido' } }
  }

  const parsedFile = ExtractDocumentFileSchema.safeParse(formData.get('file'))
  if (!parsedFile.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: parsedFile.error.issues[0]?.message ?? 'Arquivo inválido', field: 'file' },
    }
  }

  const startedAt = Date.now()
  const result = await extractFields('fine_notice', parsedFile.data)
  const latencyMs = Date.now() - startedAt

  if (!result) {
    console.error('[extractFineNoticeFields] extraction_failed', { tenant_id: tenantId, outcome: 'error', latency_ms: latencyMs })
    return {
      ok: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Não foi possível extrair os dados da notificação. Tente novamente ou preencha manualmente.' },
    }
  }

  console.info('[extractFineNoticeFields] extraction_completed', {
    tenant_id: tenantId, outcome: 'ok', fields_found: result.fieldsFound, fields_total: result.fieldsTotal, latency_ms: latencyMs,
  })

  // RF-007: aviso antecipado, antes mesmo de o operador salvar o formulário.
  const duplicateOf = await findDuplicateFine(supabase, tenantId, {
    renainfNumber: result.fields.renainf_number.value,
    aitNumber: result.fields.ait_number.value,
  })

  return { ok: true, data: { ...result, duplicateOf } }
}
