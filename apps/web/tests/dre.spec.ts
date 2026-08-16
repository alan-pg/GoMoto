/**
 * DRE — `income_statement`.
 *
 * O demonstrativo não é uma tabela que alguém alimenta: é a soma dos
 * lançamentos, agrupada pela linha de relatório que a POLÍTICA DO TENANT
 * atribuía à conta na data do fato (ADR 0024, Princípio 6 — fato e
 * classificação são coisas separadas).
 *
 * Isso tem uma consequência que só um teste prova: mudar a política hoje NÃO
 * reclassifica o passado. Um fato de março continua caindo na linha que valia
 * em março, mesmo depois que a conta passar a ser classificada de outro jeito.
 * É o que separa um demonstrativo auditável de um que muda quando ninguém está
 * olhando.
 *
 * O outro ponto é o sinal: receita e despesa vivem no mesmo `amount_signed`, e
 * a view inverte o sinal para o demonstrativo. Se essa inversão quebrar, a
 * despesa aparece como receita — e o número fecha, o que torna o erro invisível
 * sem uma asserção explícita.
 *
 * Os números são medidos por DELTA (antes/depois do lançamento), não por total
 * absoluto: o razão é imutável por trigger, então lançamento de teste não sai
 * mais de lá. Asserção sobre total absoluto passaria na primeira execução e
 * falharia na segunda — e o que se quer provar é a contribuição do fato, não o
 * saldo acumulado do banco de desenvolvimento.
 *
 * Usa service_role: o alvo é a view.
 */

import { test, expect } from '@playwright/test'
import { TEST_TAG, getSupabaseAdmin, getTestTenantId, createTestCustomer, deleteTestCustomer } from './helpers'

const admin = () => getSupabaseAdmin()

/**
 * Primeiro dia do mês, N meses atrás — o período é truncado por mês na view.
 *
 * Montado a partir dos componentes LOCAIS, nunca por `toISOString()`: à noite,
 * em UTC-3, a conversão empurra a data para o dia seguinte, e `mesAtras()`
 * devolvia dia 2 enquanto `date_trunc('month')` agrupa no dia 1. O teste
 * passava de dia e quebrava depois das 21h.
 */
function mesAtras(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

let customerId = ''
const transacoes: string[] = []

async function lancar(
  occurredAt: string,
  entries: { account_code: string; direction: 'debit' | 'credit'; amount: number }[],
  eventType = 'charge_issued',
): Promise<string> {
  const tenantId = await getTestTenantId()
  const { data, error } = await admin().rpc('post_financial_transaction', {
    p_tenant_id: tenantId,
    p_transaction: {
      event_type: eventType,
      description: `${TEST_TAG} DRE`,
      occurred_at: occurredAt,
      source_module: 'manual',
    },
    p_entries: entries.map((e) => ({ ...e, customer_id: customerId })),
  })
  if (error) throw new Error(`post_financial_transaction: ${error.message}`)
  const id = data as string
  transacoes.push(id)
  return id
}

/** Soma do período por linha de relatório, para comparar antes/depois. */
async function porLinha(periodo: string): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  for (const l of await dre(periodo)) {
    m.set(l.report_line_code, (m.get(l.report_line_code) ?? 0) + Number(l.amount))
  }
  return m
}

/** Quanto cada linha mudou entre dois retratos. */
function delta(antes: Map<string, number>, depois: Map<string, number>): Map<string, number> {
  const d = new Map<string, number>()
  for (const code of new Set([...antes.keys(), ...depois.keys()])) {
    const diff = (depois.get(code) ?? 0) - (antes.get(code) ?? 0)
    if (Math.abs(diff) > 0.005) d.set(code, Number(diff.toFixed(2)))
  }
  return d
}

async function dre(periodo: string) {
  const tenantId = await getTestTenantId()
  const { data, error } = await admin()
    .from('income_statement')
    .select('period, report_line_code, in_tax_base, amount')
    .eq('tenant_id', tenantId)
    .eq('period', periodo)
  if (error) throw new Error(`income_statement: ${error.message}`)
  return (data ?? []) as {
    period: string; report_line_code: string; in_tax_base: boolean; amount: number
  }[]
}

test.beforeAll(async () => {
  const c = await createTestCustomer()
  customerId = c.id
})

test.afterAll(async () => {
  // Lançamento não é apagado: `trg_entries_immutable` existe justamente para
  // isso, e o teste não abre exceção no que ele valida. Por isso as asserções
  // são por delta.
  if (customerId) await deleteTestCustomer(customerId).catch(() => {})
})

test.describe('DRE em valores', () => {
  test('receita entra positiva e despesa entra negativa no mesmo período', async () => {
    const periodo = mesAtras(2)
    const antes = await porLinha(periodo)

    // Receita de locação: 1.000 a receber contra receita.
    await lancar(periodo, [
      { account_code: 'contas_a_receber', direction: 'debit',  amount: 1000 },
      { account_code: 'receita_locacao',  direction: 'credit', amount: 1000 },
    ])

    // Despesa de manutenção: 300 de custo contra o que se deve.
    await lancar(periodo, [
      { account_code: 'despesa_manutencao', direction: 'debit',  amount: 300 },
      { account_code: 'contas_a_pagar',     direction: 'credit', amount: 300 },
    ], 'payable_created')

    const mudou = delta(antes, await porLinha(periodo))
    expect(mudou.size, 'DRE não registrou os lançamentos do período').toBeGreaterThan(0)

    const valores = [...mudou.values()]
    const receita = valores.filter((v) => v > 0).reduce((s, v) => s + v, 0)
    const despesa = valores.filter((v) => v < 0).reduce((s, v) => s + v, 0)

    // Contas patrimoniais (a receber, a pagar) não entram no demonstrativo. Se
    // entrassem, cada fato apareceria duas vezes e o resultado dobraria.
    expect(receita, 'receita não apareceu positiva').toBe(1000)
    expect(despesa, 'despesa não apareceu negativa').toBe(-300)
    expect(Number((receita + despesa).toFixed(2)), 'resultado do período não fecha').toBe(700)

    // A linha vem da política do tenant, não do código da conta.
    expect([...mudou.keys()].every((c) => typeof c === 'string' && c.length > 0)).toBe(true)
  })

  test('cada fato cai no seu mês, não no mês em que foi lançado', async () => {
    const mesA = mesAtras(4)
    const mesB = mesAtras(3)
    const antesA = await porLinha(mesA)
    const antesB = await porLinha(mesB)

    await lancar(mesA, [
      { account_code: 'contas_a_receber', direction: 'debit',  amount: 500 },
      { account_code: 'receita_locacao',  direction: 'credit', amount: 500 },
    ])
    await lancar(mesB, [
      { account_code: 'contas_a_receber', direction: 'debit',  amount: 800 },
      { account_code: 'receita_locacao',  direction: 'credit', amount: 800 },
    ])

    const somaDelta = (m: Map<string, number>) => Number([...m.values()].reduce((s, v) => s + v, 0).toFixed(2))

    expect(somaDelta(delta(antesA, await porLinha(mesA))), `competência vazou de ${mesA}`).toBe(500)
    expect(somaDelta(delta(antesB, await porLinha(mesB))), `competência vazou de ${mesB}`).toBe(800)
  })

  test('mudar a política de classificação não reclassifica o passado', async () => {
    const tenantId = await getTestTenantId()
    const periodo = mesAtras(5)
    const retratoInicial = await porLinha(periodo)

    await lancar(periodo, [
      { account_code: 'contas_a_receber',        direction: 'debit',  amount: 400 },
      { account_code: 'receita_encargos_atraso', direction: 'credit', amount: 400 },
    ])

    const deltaAntes = delta(retratoInicial, await porLinha(periodo))
    const linhaOriginal = [...deltaAntes.entries()].find(([, v]) => v === 400)?.[0]
    expect(linhaOriginal, 'encargo não apareceu no DRE').toBe('financial_income')

    // Nova política valendo a partir de HOJE, mandando a mesma conta para outra
    // linha de relatório.
    const { data: ultima } = await admin()
      .from('tenant_account_mappings')
      .select('version')
      .eq('tenant_id', tenantId)
      .eq('account_code', 'receita_encargos_atraso')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const versaoNova = ((ultima as { version: number } | null)?.version ?? 0) + 1

    // Data local: `toISOString()` empurraria `effective_from` para amanhã à
    // noite em UTC-3, e o fato lançado "hoje" ficaria fora da política nova.
    const agora = new Date()
    const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`

    const { data: politica, error } = await admin()
      .from('tenant_account_mappings')
      .insert({
        tenant_id:        tenantId,
        // Versão própria: a unicidade é (tenant, versão, conta), e o teste não
        // pode depender de nenhuma outra política já ter sido criada ou não.
        version:          versaoNova,
        account_code:     'receita_encargos_atraso',
        // Alvo tem de ser DIFERENTE do padrão da conta (`financial_income`),
        // senão a política nova não muda nada e o teste passa sem provar nada.
        report_line_code: 'gross_revenue',
        in_tax_base:      false,
        effective_from:   hoje,
      })
      .select('id')
      .single()

    expect(error, `não foi possível criar a política: ${error?.message}`).toBeNull()

    // A política nova precisa de fato mudar a classificação DAQUI PRA FRENTE —
    // senão o teste passaria mesmo com a resolução por data quebrada.
    const retratoHoje = await porLinha(hoje.slice(0, 8) + '01')
    await lancar(hoje, [
      { account_code: 'contas_a_receber',        direction: 'debit',  amount: 400 },
      { account_code: 'receita_encargos_atraso', direction: 'credit', amount: 400 },
    ])
    const deltaHoje = delta(retratoHoje, await porLinha(hoje.slice(0, 8) + '01'))
    expect(
      deltaHoje.get('gross_revenue'),
      'a política nova não valeu nem para o fato novo — o teste seria vácuo',
    ).toBe(400)

    // E o fato antigo continua exatamente onde estava.
    const deltaDepois = delta(retratoInicial, await porLinha(periodo))
    expect(
      deltaDepois.get(linhaOriginal!),
      'política nova reclassificou fato antigo — o DRE do passado mudou sozinho',
    ).toBe(400)
    expect(
      deltaDepois.get('gross_revenue'),
      'fato antigo migrou para a linha nova',
    ).toBeUndefined()

    await admin().from('tenant_account_mappings').delete().eq('id', (politica as { id: string }).id)
  })
})
