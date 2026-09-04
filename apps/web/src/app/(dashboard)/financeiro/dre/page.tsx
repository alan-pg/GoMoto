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
import { HelpCircle } from 'lucide-react'
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

type ReportLineRow = { code: string; name: string; sort_order: number }

type AccountRow = {
  code: string
  name: string
  default_report_line_code: string | null
}

type MappingRow = { account_code: string; report_line_code: string }

/**
 * O que cada linha do DRE SIGNIFICA. Só o significado mora aqui: a COMPOSIÇÃO
 * — quais contas caem em cada linha — é lida do banco logo abaixo, porque é
 * política do tenant e pode ser remapeada (ADR 0024, Princípio 6). Repetir o
 * mapa aqui seria a segunda cópia de uma decisão que já tem dona.
 *
 * O texto responde a pergunta que o operador faz na frente da tabela: "por que
 * este número está nesta linha, e o que mais cairia aqui?".
 */
const LINE_MEANING: Record<string, string> = {
  gross_revenue:
    'O que a empresa faturou na operação. Entra no mês em que a cobrança é EMITIDA, '
    + 'não no mês em que o cliente paga — por isso a receita pode subir num mês em que o caixa não se mexeu.',
  expense_recovery:
    'A parte de uma despesa que é repassada ao cliente. Não é venda: em vez de somar à receita, '
    + 'devolve o custo que a empresa adiantou. É por isso que fica fora da base de cálculo por padrão — '
    + 'o tenant que precisar do tratamento bruto remapeia a conta para Receita bruta.',
  operating_cost:
    'O que a operação consumiu no mês. Aparece negativo porque reduz o resultado. '
    + 'A parte repassada ao cliente NÃO é abatida aqui: ela aparece inteira em Recuperação de despesas, '
    + 'para que dê para ler o custo bruto e o quanto dele voltou.',
  depreciation:
    'A perda de valor da frota com o uso. É custo sem saída de caixa: o dinheiro saiu na compra da moto, '
    + 'e o resultado reconhece esse gasto diluído nos meses de uso. '
    + 'Hoje o produto não lança depreciação automaticamente, então esta linha costuma ficar vazia.',
  financial_income:
    'Ganho que não vem da locação em si — hoje, o encargo por atraso (juros e multa). '
    + 'Só entra quando o encargo é REALIZADO, no recebimento: enquanto a cobrança está vencida e não paga, '
    + 'o encargo é projeção na tela da cobrança e não aparece no resultado.',
  loss_provision:
    'Cobrança que a empresa reconhece que não vai receber (baixa por inadimplência). '
    + 'A receita original permanece onde está — a venda aconteceu; o que se reconhece aqui é a perda. '
    + 'É isso que separa baixa de cancelamento: cancelar apaga a receita, baixar reconhece que ela não virá.',
}

/**
 * Primeiro dia do mês, deslocado por `offset` meses a partir de UMA data dada.
 *
 * A data vem do banco (`fn_business_today(tenant)`), nunca de `new Date()`. O
 * relógio do servidor Node é o fuso da máquina em dev e UTC na Vercel, então o
 * mesmo código pedia meses diferentes conforme onde rodava — enquanto a view
 * classifica o período no fuso do TENANT. Às 22h de 31/08 a tela pedia
 * "mar/26 a ago/26", a view respondia setembro, e o DRE aparecia em branco.
 */
function monthStart(hoje: string, offset: number): string {
  const d = new Date(hoje + 'T12:00:00')
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

  // O "hoje" do tenant, não o do servidor. É o mesmo relógio que a view usa para
  // classificar o período — pedir num fuso e classificar em outro foi o que
  // deixou a tela em branco na virada do mês.
  const { data: hojeDoTenant } = await supabase.rpc('fn_business_today', { p_tenant_id: tenantId })
  const hoje = (hojeDoTenant as string | null) ?? new Date().toISOString().slice(0, 10)

  const from = monthStart(hoje, -(months - 1))
  const to   = monthStart(hoje, 0)

  const { data, error } = await supabase
    .from('income_statement')
    .select('period, report_line_code, report_line_name, sort_order, in_tax_base, amount')
    .eq('tenant_id', tenantId)
    .gte('period', from)
    .lte('period', to)
    .order('sort_order')

  // Legenda: o catálogo de linhas e as contas que caem em cada uma. Não muda
  // nenhum número da tabela — é só o que explica o número.
  const [lineRes, accountRes, mappingRes] = await Promise.all([
    supabase
      .from('report_lines')
      .select('code, name, sort_order')
      .eq('statement', 'dre')
      .order('sort_order'),
    supabase
      .from('financial_accounts')
      .select('code, name, default_report_line_code')
      .in('kind', ['revenue', 'expense', 'reimbursement'])
      .order('sort_order'),
    // Override vigente HOJE. A tabela não tem tela que escreva nela ainda, mas
    // ler o banco é o que mantém a legenda verdadeira se um dia tiver.
    supabase
      .from('tenant_account_mappings')
      .select('account_code, report_line_code')
      .eq('tenant_id', tenantId)
      .lte('effective_from', hoje)
      .order('effective_from', { ascending: false })
      .order('version', { ascending: false }),
  ])

  const rows = (data ?? []) as StatementRow[]
  const periods = monthsBetween(from, to)

  // Espelha `fn_resolve_report_line`: override do tenant vigente na data vence
  // o default global da conta. A data aqui é HOJE, porque a pergunta da legenda
  // é "onde uma conta cai agora" — os VALORES da tabela continuam vindo da
  // view, que resolve na data de cada fato e por isso não reescreve o passado.
  const overrideOf = new Map<string, string>()
  for (const m of (mappingRes.data ?? []) as MappingRow[]) {
    if (!overrideOf.has(m.account_code)) overrideOf.set(m.account_code, m.report_line_code)
  }

  const composition = new Map<string, string[]>()
  for (const a of (accountRes.data ?? []) as AccountRow[]) {
    const lineCode = overrideOf.get(a.code) ?? a.default_report_line_code
    if (!lineCode) continue
    composition.set(lineCode, [...(composition.get(lineCode) ?? []), a.name])
  }

  const legend = ((lineRes.data ?? []) as ReportLineRow[]).map((l) => ({
    ...l,
    meaning: LINE_MEANING[l.code] ?? null,
    accounts: composition.get(l.code) ?? [],
  }))

  /** Resumo de uma linha para o `title` da célula — primeira frase do texto
   *  longo, que é o que cabe num tooltip nativo. */
  const shortMeaning = (code: string) => {
    const full = LINE_MEANING[code]
    if (!full) return undefined
    const end = full.indexOf('. ')
    return end === -1 ? full : full.slice(0, end + 1)
  }

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
          <div
            className="rounded-xl bg-surface p-4"
            title="Soma de todas as linhas no intervalo. É resultado, não saldo em conta: cobrança emitida e não paga já conta aqui."
          >
            <p className="text-[12px] text-fg-mute">Resultado do período</p>
            <p className={`mt-1 text-xl font-bold ${valueClass(grandTotal)}`}>{formatCurrency(grandTotal)}</p>
            <p className="mt-0.5 text-[12px] text-fg-mute">
              {monthLabel(from)} a {monthLabel(to)}
            </p>
          </div>
          <div
            className="rounded-xl bg-surface p-4"
            title="Soma apenas das linhas marcadas como tributáveis. Quais entram é política contábil do tenant, resolvida na data de cada fato."
          >
            <p className="text-[12px] text-fg-mute">Base de cálculo de imposto</p>
            <p className="mt-1 text-xl font-bold text-fg">{formatCurrency(taxBase)}</p>
            <p className="mt-0.5 text-[12px] text-fg-mute">Só as linhas marcadas pela política do tenant</p>
          </div>
        </div>

        <details className="rounded-xl bg-surface">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-medium text-fg">
            <HelpCircle className="h-4 w-4 shrink-0 text-fg-mute" />
            Como ler este demonstrativo
            <span className="ml-auto text-[12px] font-normal text-fg-mute">
              o que é cada linha e o que cai nela
            </span>
          </summary>

          <div className="space-y-4 border-t border-divider px-4 py-4">
            <div className="space-y-2 text-[13px] text-fg-mute">
              <p>
                <span className="text-fg">DRE é o resultado, não o caixa.</span> Ele responde
                “a empresa ganhou ou perdeu dinheiro neste mês?”. Quanto há em conta é outra
                pergunta, e tem outro relatório.
              </p>
              <p>
                <span className="text-fg">Competência.</span> Cada fato entra no mês em que
                aconteceu, não no mês em que o dinheiro se moveu: cobrança emitida em julho e
                paga em agosto é receita de julho.
              </p>
              <p>
                <span className="text-fg">Todo número é soma de lançamento.</span> Nenhuma
                célula é digitada — cada uma soma os lançamentos daquele mês. Positivo aumenta
                o resultado, negativo reduz, e a linha <em>Resultado</em> é a soma da coluna.
              </p>
              <p>
                <span className="text-fg">O que não aparece aqui.</span> Caução e crédito de
                cliente são dinheiro de terceiro: entram no patrimônio, não no resultado.
                Recebimento também não — quem gera receita é a emissão da cobrança; receber
                troca recebível por caixa.
              </p>
              <p>
                <span className="text-fg">tributável.</span> Marca a linha que entra na base
                de cálculo do imposto. Quais entram é política contábil do tenant, resolvida na
                data do fato — mudar a política hoje não reclassifica mês já fechado.
              </p>
            </div>

            <dl className="space-y-3 border-t border-divider pt-4">
              {legend.map((l) => (
                <div key={l.code}>
                  <dt className="text-[13px] text-fg">{l.name}</dt>
                  {l.meaning && (
                    <dd className="mt-0.5 text-[12px] leading-relaxed text-fg-mute">{l.meaning}</dd>
                  )}
                  <dd className="mt-0.5 text-[12px] text-fg-mute">
                    {l.accounts.length > 0
                      ? <>Composta por: {l.accounts.join(', ')}.</>
                      : <>Nenhuma conta cai nesta linha na política atual.</>}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="border-t border-divider pt-4 text-[12px] text-fg-mute">
              Uma linha só aparece na tabela acima quando teve movimento no intervalo
              escolhido. As demais continuam existindo — apenas não tiveram lançamento.
            </p>
          </div>
        </details>

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
                    <td className="h-9 px-4 text-[13px] text-fg" title={shortMeaning(code)}>
                      {line.name}
                      {line.inTaxBase && (
                        // O espaço é texto, não margem: sem ele o rótulo copiado
                        // da tela sai colado — "Receitas financeirastributável".
                        <>{' '}<span className="ml-1 text-[12px] text-fg-mute">tributável</span></>
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
