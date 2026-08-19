/**
 * Custo de manutenção e rateio — em valores.
 *
 * `maintenances.cost` e `effective_customer_payer_pct` saíram na ADR 0024:
 * percentual inteiro não representa 1/3 e deixa centavo sem dono (F-17,
 * Princípio 7). O custo passou a viver no payable — mas nada tomou o lugar na
 * tela, e a conta `despesa_manutencao` só recebia lançamento vindo de
 * /despesas. Manutenção concluída pela própria tela de manutenção não gerava
 * custo nenhum: o valor era digitado e descartado.
 *
 * Delega a `createPayable`, o mesmo caminho das despesas e das multas: ele cria
 * o custo bruto da empresa E a cobrança de repasse quando o cliente paga parte.
 * Sem uma quarta cópia da lógica.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  ACCOUNTS,
  resolveReimbursement,
  splitResponsibility,
  type ActionResult,
} from '@gomoto/core'
import { createPayable } from './payables'

export const MaintenanceCostSchema = z.object({
  maintenance_id:  z.string().uuid(),
  amount:          z.number().positive('Custo deve ser maior que zero'),
  /** Quanto DESTE custo o cliente paga. 0 = tudo da empresa. */
  customer_amount: z.number().min(0).default(0),
  /**
   * Quem executou o serviço. Decide se a parte do cliente vira COBRANÇA ou
   * CRÉDITO: executou a empresa, cobra-se do cliente; executou o cliente com
   * dinheiro que cabia à empresa, credita-se a ele.
   */
  executor: z.enum(['company', 'customer']).default('company'),
  due_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
})

export async function registerCost(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string | null,
  input: unknown,
): Promise<ActionResult<{ payable_id: string; charge_id?: string }>> {
  const parsed = MaintenanceCostSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Dados inválidos',
        field: first?.path?.map(String).join('.'),
      },
    }
  }

  if (parsed.data.customer_amount > parsed.data.amount) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A parte do cliente não pode passar do custo total.',
        field: 'customer_amount',
      },
    }
  }

  const { data: maintenance } = await supabase
    .from('maintenances')
    .select('id, vehicle_id, description')
    .eq('id', parsed.data.maintenance_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const m = maintenance as { id: string; vehicle_id: string; description: string } | null
  if (!m) return { ok: false, error: { code: 'NOT_FOUND', message: 'Manutenção não encontrada' } }

  // "Já tem custo?" pergunta-se ao payable pela origem, não a uma coluna de
  // volta na manutenção. `maintenances.payable_id` apontava para o payable que
  // já apontava para ela — dois lados que podiam divergir. O índice único por
  // origem em `payables` garante o resto: mesmo com corrida, só um passa.
  const { data: existente } = await supabase
    .from('payables')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source_module', 'maintenance')
    .eq('source_id', m.id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existente) {
    return { ok: false, error: { code: 'CONFLICT', message: 'Esta manutenção já teve o custo registrado.' } }
  }

  // O cliente da locação ativa do veículo é quem responde pelo repasse.
  const { data: rental } = await supabase
    .from('rentals')
    .select('id, customer_id')
    .eq('vehicle_id', m.vehicle_id)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  const r = rental as { id: string; customer_id: string } | null

  if (parsed.data.customer_amount > 0 && !r) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Sem locação ativa para este veículo, o custo não pode ser repassado ao cliente.',
        field: 'customer_amount',
      },
    }
  }

  const responsibility =
    parsed.data.customer_amount === 0 ? 'company'
      : parsed.data.customer_amount === parsed.data.amount ? 'customer'
        : 'shared'

  const reembolso = resolveReimbursement(
    splitResponsibility(parsed.data.amount, responsibility, parsed.data.customer_amount),
    parsed.data.executor,
  )

  try {
    const { payableId, chargeId } = await createPayable(supabase, tenantId, {
      description: `Manutenção — ${m.description}`,
      expenseAccountCode: ACCOUNTS.MAINTENANCE_EXPENSE,
      competenceDate: parsed.data.due_date,
      dueDate: parsed.data.due_date,
      amount: parsed.data.amount,
      responsibility,
      customerId: r?.customer_id ?? null,
      customerAmount: parsed.data.customer_amount,
      // Quem executou desembolsou o total; o reembolso é a parte do OUTRO.
      // Aqui estava fixo em 'charge' e depois passou a usar sempre a parte do
      // cliente — o que zerava o caso mais comum: cliente leva a moto à
      // oficina, paga R$ 300 de um custo 100% da empresa, e ninguém o
      // ressarcia.
      reimbursement: reembolso.mode,
      reimbursementAmount: reembolso.amount,
      // Custo 100% do cliente que ele mesmo levou à oficina: nada muda de mão,
      // o modo é 'none', e sem isto a função concluía "a empresa deve à
      // oficina" — R$ 300 de despesa e R$ 300 de contas a pagar inventados.
      paidBy: parsed.data.executor,
      vehicleId: m.vehicle_id,
      rentalId: r?.id ?? null,
      sourceModule: 'maintenance',
      sourceId: m.id,
      createdBy: userId,
    })

    return { ok: true, data: { payable_id: payableId, charge_id: chargeId } }
  } catch (err) {
    console.error('[registerCost] failed', { maintenance_id: m.id, error: String(err) })
    return { ok: false, error: { code: 'INTERNAL', message: `Erro ao registrar o custo: ${String(err)}` } }
  }
}


// ---------------------------------------------------------------------------
// Exclusão de manutenção — a origem não pode sumir deixando o dinheiro
// ---------------------------------------------------------------------------

export type DeleteCheck =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Diz se a manutenção pode ser apagada.
 *
 * `deleteMaintenance` era um `delete` seco. Manutenção com custo registrado
 * gera conta a pagar, lançamento no razão e — quando o cliente executou —
 * crédito a favor dele. Apagar a origem deixava tudo órfão: verificado na tela,
 * o cliente seguia com R$ 100 de crédito por um serviço que já não existia, e a
 * despesa continuava no DRE.
 *
 * O razão é append-only de propósito (Princípio 3): o certo não é apagar
 * lançamento, é estornar — e estorno de despesa já tem dono, `cancelPayable`,
 * que desfaz o custo E cancela a cobrança de repasse na mesma operação. Então
 * aqui não se inventa uma cascata paralela: recusa-se, apontando o caminho.
 *
 * A pergunta usa o mesmo par `(source_module, source_id)` de `registerCost`.
 * Conta cancelada não bloqueia: aí o dinheiro já foi desfeito.
 */
export async function checkMaintenanceDeletable(
  supabase: SupabaseClient,
  tenantId: string,
  maintenanceId: string,
): Promise<DeleteCheck> {
  const { data, error } = await supabase
    .from('payables')
    .select('id, reimbursement')
    .eq('tenant_id', tenantId)
    .eq('source_module', 'maintenance')
    .eq('source_id', maintenanceId)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (error) {
    return { ok: false, message: `Não foi possível verificar o custo da manutenção: ${error.message}` }
  }
  if (!data) return { ok: true }

  const p = data as { reimbursement: string }
  return {
    ok: false,
    message: p.reimbursement === 'credit'
      ? 'Esta manutenção foi paga pelo cliente e gerou crédito a favor dele. '
        + 'Excluí-la deixaria o crédito sem origem. Acerte o valor em Cobranças '
        + '(estorno do crédito ou cobrança avulsa) antes de excluir.'
      : 'Esta manutenção já tem custo lançado. Cancele a despesa correspondente '
        + 'em Despesas — o que estorna o razão e a cobrança de repasse — e só '
        + 'então exclua a manutenção.',
  }
}
