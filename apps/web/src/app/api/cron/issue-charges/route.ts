/**
 * Disparo manual da emissão de cobranças.
 *
 * A emissão em si vive no banco (`fn_run_billing_emission`, agendada por
 * pg_cron). Esta rota existe só para o operador conseguir rodar fora de hora —
 * quando o agendamento falhou, quando um tenant foi reativado, quando alguém
 * precisa da cobrança agora.
 *
 * O que ela NÃO faz mais: montar o lançamento contábil. Isso era feito aqui,
 * numa segunda chamada depois da RPC que criava a cobrança, e a distância entre
 * as duas era o modo de falha mais sério do redesenho — cobrança existindo,
 * visível e pagável, sem nunca ter entrado em contas a receber. Documento e
 * lançamento agora são a mesma transação, dentro do Postgres.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function log(level: 'info' | 'warn' | 'error', action: string, fields: Record<string, unknown> = {}) {
  const out = JSON.stringify({ ts: new Date().toISOString(), level, action, ...fields })
  level === 'error' ? console.error(out) : console.log(out)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    log('error', 'emission.misconfigured', { reason: 'CRON_SECRET ausente' })
    return NextResponse.json({ ok: false, error: 'Disparo manual não configurado' }, { status: 500 })
  }

  if (req.headers.get('Authorization') !== `Bearer ${secret}`) {
    log('warn', 'emission.unauthorized')
    return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const startedAt = Date.now()

  const { data: runId, error } = await supabase.rpc('fn_run_billing_emission', {
    p_triggered_by: 'manual',
    p_lead_days: 0,
  })

  if (error) {
    log('error', 'emission.failed', { error: error.message })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // O resultado por tenant fica em `billing_runs`; aqui só resumimos.
  const { data: runs } = await supabase
    .from('billing_runs')
    .select('tenant_id, charges_issued, error')
    .eq('run_id', runId as string)

  const rows = (runs ?? []) as { tenant_id: string; charges_issued: number; error: string | null }[]
  const issued = rows.reduce((s, r) => s + r.charges_issued, 0)
  const failed = rows.filter((r) => r.error).length

  log('info', 'emission.finished', {
    run_id: runId, tenants: rows.length, issued, failed, latency_ms: Date.now() - startedAt,
  })

  return NextResponse.json({
    ok: failed === 0,
    data: { run_id: runId, tenants: rows.length, issued, failed },
  })
}
