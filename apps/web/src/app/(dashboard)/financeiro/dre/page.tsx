/**
 * DRE — demonstrativo de resultado por competência.
 *
 * A view `income_statement` existia desde o redesenho, com repositório e hook
 * prontos, e nenhuma tela a consumia (P-10): o relatório que justifica o ledger
 * estava correto e inalcançável pelo operador.
 *
 * O que a tela mostra é soma de lançamento, nada mais. Não há coluna de saldo
 * em lugar nenhum e não há número digitado à mão: cada valor aqui é a soma dos
 * fatos daquele mês, agrupada pela linha que a política do tenant atribuía à
 * conta NA DATA DO FATO. Por isso um mês fechado não muda quando a
 * classificação muda (ADR 0024, Princípio 6).
 *
 * Sinal: a view já inverte `amount_signed`, então receita chega positiva e
 * despesa negativa. A tela não reinverte nada — se um número aparece com o
 * sinal trocado, o erro está no lançamento, e é isso que se quer ver.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'

type StatementRow = {
  period: string
  report_line_code: string
  report_line_name: string
  sort_order: number
  in_tax_base: boolean
  amount: number
}

/** Primeiro dia do mês, deslocado por `offset` meses a partir de hoje. */
function monthStart(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** "mar/26" — o `toLocaleDateString` pt-BR devolve "mar. de 26", e um
 *  `capitalize` no cabeçalho transformava isso em "Mar De 26". */
function monthLabel(period: string): string {
  const d = new Date(period + 'T12:00:00')
  const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  return `${mes}/${String(d.getFullYear()).slice(2)}`
}

/** Meses do intervalo, do mais antigo ao mais novo. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  const cur = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (cur <= end) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return out
}

const RANGES = [
  { months: 3,  label: '3 meses'  },
  { months: 6,  label: '6 meses'  },
  { months: 12, label: '12 meses' },
]

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ meses?: string }>
}) {
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const params = await searchParams
  const requested = Number(params.meses)
  const months = RANGES.some((r) => r.months === requested) ? requested : 6

  const from = monthStart(-(months - 1))
  const to   = monthStart(0)

  const { data, error } = await supabase
    .from('income_statement')
    .select('period, report_line_code, report_line_name, sort_order, in_tax_base, amount')
    .eq('tenant_id', tenantId)
    .gte('period', from)
    .lte('period', to)
    .order('sort_order')

  const rows = (data ?? []) as StatementRow[]
  const periods = monthsBetween(from, to)

  // Uma linha por conceito contábil; uma coluna por mês. O demonstrativo se lê
  // na horizontal — a pergunta é sempre "isto está crescendo ou encolhendo?".
  const lines = new Map<string, { name: string; sort: number; inTaxBase: boolean; byPeriod: Map<string, number> }>()
  for (const r of rows) {
    const key = r.report_line_code
    if (!lines.has(key)) {
      lines.set(key, { name: r.report_line_name, sort: r.sort_order, inTaxBase: r.in_tax_base, byPeriod: new Map() })
    }
    const line = lines.get(key)!
    line.byPeriod.set(r.period, (line.byPeriod.get(r.period) ?? 0) + Number(r.amount))
  }

  const ordered = [...lines.entries()].sort((a, b) => a[1].sort - b[1].sort)

  const totalOf = (period: string) =>
    ordered.reduce((s, [, l]) => s + (l.byPeriod.get(period) ?? 0), 0)

  const lineTotal = (byPeriod: Map<string, number>) =>
    periods.reduce((s, p) => s + (byPeriod.get(p) ?? 0), 0)

  const grandTotal = periods.reduce((s, p) => s + totalOf(p), 0)

  // Base de cálculo: o modelo marca por linha se ela entra, e a soma é
  // diferente do resultado. Deixar as duas juntas evita a conta de cabeça que
  // sempre sai errada.
  const taxBase = ordered
    .filter(([, l]) => l.inTaxBase)
    .reduce((s, [, l]) => s + lineTotal(l.byPeriod), 0)

  const valueClass = (v: number) =>
    v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-fg-mute'

  return (
    <div className="min-h-screen bg-bg">

      <div className="sticky top-0 z-10 flex h-16 items-center border-b border-divider bg-bg px-6">
        <Link href="/financeiro" className="text-[13px] text-fg-mute transition-colors hover:text-fg">
          ← Painel financeiro
        </Link>
        <span className="mx-2 text-fg-mute">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-fg">Demonstrativo de resultado</h1>

        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <Link
              key={r.months}
              href={`/financeiro/dre?meses=${r.months}`}
              className={`inline-flex h-8 items-center rounded-full px-4 text-[13px] transition-colors ${
                r.months === months
                  ? 'bg-primary font-bold text-bg'
                  : 'border border-border text-fg-mute hover:border-fg-mute hover:text-fg'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">

        {error && (
          <div className="rounded-xl border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">
            Não foi possível carregar o demonstrativo: {error.message}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">Resultado do período</p>
            <p className={`mt-1 text-xl font-bold ${valueClass(grandTotal)}`}>{formatCurrency(grandTotal)}</p>
            <p className="mt-0.5 text-[12px] text-fg-mute">
              {monthLabel(from)} a {monthLabel(to)}
            </p>
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">Base de cálculo de imposto</p>
            <p className="mt-1 text-xl font-bold text-fg">{formatCurrency(taxBase)}</p>
            <p className="mt-0.5 text-[12px] text-fg-mute">Só as linhas marcadas pela política do tenant</p>
          </div>
        </div>

        {ordered.length === 0 ? (
          <div className="rounded-xl bg-surface px-4 py-10 text-center">
            <p className="text-[13px] text-fg-mute">Nenhum lançamento no período.</p>
            <p className="mt-1 text-[12px] text-fg-mute">
              O demonstrativo é a soma dos lançamentos — ele se preenche sozinho conforme
              cobranças, pagamentos e despesas acontecem.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-divider">
                  <th className="h-9 px-4 text-left text-[13px] font-medium text-fg-mute">Linha</th>
                  {periods.map((p) => (
                    <th key={p} className="h-9 px-4 text-right text-[13px] font-medium text-fg-mute">
                      {monthLabel(p)}
                    </th>
                  ))}
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-fg">Total</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(([code, line]) => (
                  <tr key={code} className="border-b border-divider last:border-0">
                    <td className="h-9 px-4 text-[13px] text-fg">
                      {line.name}
                      {line.inTaxBase && (
                        <span className="ml-2 text-[12px] text-fg-mute">tributável</span>
                      )}
                    </td>
                    {periods.map((p) => {
                      const v = line.byPeriod.get(p) ?? 0
                      return (
                        <td key={p} className={`h-9 px-4 text-right text-[13px] tabular-nums ${valueClass(v)}`}>
                          {v === 0 ? '—' : formatCurrency(v)}
                        </td>
                      )
                    })}
                    <td className={`h-9 px-4 text-right text-[13px] font-bold tabular-nums ${valueClass(lineTotal(line.byPeriod))}`}>
                      {formatCurrency(lineTotal(line.byPeriod))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-2">
                  <td className="h-9 px-4 text-[13px] font-bold text-fg">Resultado</td>
                  {periods.map((p) => (
                    <td key={p} className={`h-9 px-4 text-right text-[13px] font-bold tabular-nums ${valueClass(totalOf(p))}`}>
                      {formatCurrency(totalOf(p))}
                    </td>
                  ))}
                  <td className={`h-9 px-4 text-right text-[13px] font-bold tabular-nums ${valueClass(grandTotal)}`}>
                    {formatCurrency(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[12px] text-fg-mute">
          Cada valor é a soma dos lançamentos do mês, agrupada pela linha que a política
          contábil do tenant atribuía à conta na data do fato. Mudar a política hoje não
          reclassifica meses já fechados.
        </p>
      </div>
    </div>
  )
}
