/**
 * Job de emissão de cobranças (Spec 0014 / ADR 0024).
 *
 * Consequência direta da reversão da ADR 0009: como a locação grava um PLANO em
 * vez de documentos, alguém precisa transformar linha de cronograma em cobrança
 * quando o período chega. Sem este job, nenhuma cobrança é emitida sozinha.
 *
 * A ADR 0009 descartou a opção "cron" alegando ausência de infraestrutura de
 * job agendado. Isso não vale mais: o web roda em Vercel, onde Cron Jobs são
 * nativos — nenhum componente novo entra no stack.
 *
 * Idempotente: `issue_due_charges` só consome linhas `scheduled` e a transição
 * para `issued` é atômica por linha. Rodar duas vezes no mesmo dia não duplica.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNTS } from '@gomoto/core'

/** Cobranças de período são geradas com esta antecedência ao início do ciclo. */
const LEAD_DAYS = 0

function log(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

export async function GET(req: NextRequest) {
  // O Vercel Cron envia `Authorization: Bearer $CRON_SECRET`. Sem o segredo
  // configurado a rota fica fechada — melhor não emitir do que expor um
  // endpoint que cria documentos financeiros.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    log('error', 'cron.misconfigured', { reason: 'CRON_SECRET ausente' })
    return NextResponse.json({ ok: false, error: 'Job não configurado' }, { status: 500 })
  }

  if (req.headers.get('Authorization') !== `Bearer ${secret}`) {
    log('warn', 'cron.unauthorized')
    return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })
  }

  // Job de sistema: percorre todos os tenants, então roda com service role.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const startedAt = Date.now()

  // Tenant ativo é o que não tem data de suspensão. Não existe coluna booleana
  // `suspended` — enquanto a query a usava, ela falhava na PRIMEIRA linha do
  // job e nenhuma cobrança era emitida, para nenhum tenant, nunca.
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id')
    .is('suspended_at', null)

  if (tenantsError) {
    log('error', 'cron.tenants_failed', { error: tenantsError.message })
    return NextResponse.json({ ok: false, error: tenantsError.message }, { status: 500 })
  }

  const results: { tenant_id: string; issued: number; error?: string }[] = []

  for (const tenant of (tenants ?? []) as { id: string }[]) {
    try {
      const issued = await issueForTenant(supabase, tenant.id)
      results.push({ tenant_id: tenant.id, issued })
      if (issued > 0) log('info', 'cron.issued', { tenant_id: tenant.id, count: issued })
    } catch (err) {
      // Falha em um tenant não impede os demais: o job é por tenant, e a
      // próxima execução reprocessa as linhas que continuam `scheduled`.
      log('error', 'cron.tenant_failed', { tenant_id: tenant.id, error: String(err) })
      results.push({ tenant_id: tenant.id, issued: 0, error: String(err) })
    }
  }

  const totalIssued = results.reduce((s, r) => s + r.issued, 0)
  const failed = results.filter((r) => r.error).length

  log('info', 'cron.finished', {
    tenants: results.length,
    issued: totalIssued,
    failed,
    latency_ms: Date.now() - startedAt,
  })

  return NextResponse.json({
    ok: failed === 0,
    data: { tenants: results.length, issued: totalIssued, failed, results },
  })
}

/**
 * Emite as cobranças devidas do tenant e lança cada uma no ledger.
 *
 * A RPC cria o documento e os itens; o lançamento fica aqui porque a tradução
 * evento → contas vive em @gomoto/core, não em PL/pgSQL.
 */
async function issueForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('issue_due_charges', {
    p_tenant_id: tenantId,
    p_lead_days: LEAD_DAYS,
  })

  if (error) throw new Error(`issue_due_charges: ${error.message}`)

  const issued = (data ?? []) as { schedule_id: string; charge_id: string; charge_number: number }[]
  if (issued.length === 0) return 0

  for (const row of issued) {
    const { data: charge } = await supabase
      .from('charges')
      .select('customer_id, rental_id')
      .eq('id', row.charge_id)
      .single()

    const c = charge as { customer_id: string; rental_id: string | null } | null

    const { data: items } = await supabase
      .from('charge_items')
      .select('amount, vehicle_id')
      .eq('charge_id', row.charge_id)

    const total = ((items ?? []) as { amount: number }[]).reduce((s, i) => s + i.amount, 0)
    const vehicleId = ((items ?? []) as { vehicle_id: string | null }[])
      .find((i) => i.vehicle_id)?.vehicle_id ?? null

    if (total <= 0) continue

    const { error: ledgerError } = await supabase.rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'charge_issued',
        description: `Emissão automática — cobrança #${row.charge_number}`,
        source_module: 'rental',
        source_id: c?.rental_id ?? null,
      },
      p_entries: [
        {
          account_code: ACCOUNTS.RECEIVABLE, direction: 'debit', amount: total,
          customer_id: c?.customer_id ?? null, rental_id: c?.rental_id ?? null,
          charge_id: row.charge_id, vehicle_id: vehicleId,
        },
        {
          account_code: ACCOUNTS.RENTAL_REVENUE, direction: 'credit', amount: total,
          customer_id: c?.customer_id ?? null, rental_id: c?.rental_id ?? null,
          charge_id: row.charge_id, vehicle_id: vehicleId,
        },
      ],
    })

    if (ledgerError) throw new Error(`ledger (cobrança #${row.charge_number}): ${ledgerError.message}`)
  }

  return issued.length
}
