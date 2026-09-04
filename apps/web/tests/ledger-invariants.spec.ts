import { test, expect } from '@playwright/test'
import { TEST_TAG, getSupabaseAdmin, getTestTenantId } from './helpers'

/**
 * P-4 (Spec 0014 §10.1) — as garantias estruturais do ledger.
 *
 * Os dois invariantes do ADR 0024 que só existem no banco:
 *
 *   Princípio 1 — todo fato financeiro é transação balanceada.
 *     `SUM(amount_signed) = 0`, cobrado por CONSTRAINT TRIGGER DEFERRABLE
 *     INITIALLY DEFERRED: a violação só aparece no COMMIT, nunca no INSERT.
 *   Princípio 3 — lançamento é imutável. Correção é estorno, nunca UPDATE.
 *
 * Nenhum dos dois é visível a `pnpm typecheck` ou `pnpm build`, e nenhum é
 * expresso em TypeScript: são triggers. Sem este spec, uma migration futura
 * pode derrubá-los sem que nada acuse.
 *
 * Usa service_role de propósito: o alvo é a regra do banco, não a RLS — se o
 * invariante resiste a quem ignora RLS, resiste a qualquer caminho do app.
 */

const admin = () => getSupabaseAdmin()

/** Transação sem pernas — o teste decide o que pendurar nela. */
async function createTransaction(tenantId: string, description: string): Promise<string> {
  const { data, error } = await admin()
    .from('financial_transactions')
    .insert({
      tenant_id:     tenantId,
      event_type:    'charge_issued',
      occurred_at:   new Date().toISOString(),
      description:   `${TEST_TAG} ${description}`,
      source_module: 'e2e_ledger_invariants',
    })
    .select('id')
    .single()

  if (error) throw new Error(`Setup falhou ao criar transação: ${error.message}`)
  return (data as { id: string }).id
}

async function addEntry(
  tenantId: string,
  transactionId: string,
  direction: 'debit' | 'credit',
  accountCode: string,
  amount: number,
) {
  return admin()
    .from('financial_entries')
    .insert({ tenant_id: tenantId, transaction_id: transactionId, account_code: accountCode, direction, amount })
    .select('id')
}

test.describe('Ledger — invariantes do banco (ADR 0024)', () => {
  test('perna solta é rejeitada: transação que não fecha em zero não persiste', async () => {
    const tenantId = await getTestTenantId()
    const txId = await createTransaction(tenantId, 'perna solta')

    // Um débito de 100 sem contrapartida. A trigger é DEFERRABLE, então o
    // INSERT em si passa — o PostgREST faz cada chamada em sua própria
    // transação, e a checagem cai no COMMIT.
    const { error } = await addEntry(tenantId, txId, 'debit', 'contas_a_receber', 100)

    expect(error, 'lançamento desbalanceado deveria falhar no commit').not.toBeNull()
    expect(error!.message).toMatch(/contrapartida/i)

    // E não sobra nada: a transação inteira foi desfeita.
    const { data: entries } = await admin()
      .from('financial_entries')
      .select('id')
      .eq('transaction_id', txId)

    expect(entries ?? []).toEqual([])
  })

  test('duas pernas que não somam zero são rejeitadas', async () => {
    const tenantId = await getTestTenantId()
    const txId = await createTransaction(tenantId, 'soma divergente')

    // A guarda de contrapartida (>= 2 pernas) passaria aqui: são duas. O que
    // barra é a soma — 100 debitados contra 60 creditados. É o erro que um bug
    // no serviço de lançamento produziria, e o único que a contagem não pega.
    const { error } = await admin()
      .from('financial_entries')
      .insert([
        { tenant_id: tenantId, transaction_id: txId, account_code: 'contas_a_receber', direction: 'debit', amount: 100 },
        { tenant_id: tenantId, transaction_id: txId, account_code: 'receita_locacao', direction: 'credit', amount: 60 },
      ])

    expect(error, 'transação que não fecha deveria falhar no commit').not.toBeNull()
    expect(error!.message).toMatch(/n(ã|a)o fecha/i)

    const { data: entries } = await admin()
      .from('financial_entries')
      .select('id')
      .eq('transaction_id', txId)

    expect(entries ?? []).toEqual([])
  })

  test('par balanceado persiste e fecha em zero', async () => {
    const tenantId = await getTestTenantId()
    const txId = await createTransaction(tenantId, 'par balanceado')

    // Débito e crédito no mesmo statement: o PostgREST envia um único INSERT,
    // então o COMMIT enxerga a transação já fechada.
    const { error } = await admin()
      .from('financial_entries')
      .insert([
        { tenant_id: tenantId, transaction_id: txId, account_code: 'contas_a_receber', direction: 'debit', amount: 250 },
        { tenant_id: tenantId, transaction_id: txId, account_code: 'receita_locacao', direction: 'credit', amount: 250 },
      ])

    expect(error, error?.message).toBeNull()

    const { data } = await admin()
      .from('financial_entries')
      .select('amount_signed')
      .eq('transaction_id', txId)

    const rows = (data ?? []) as { amount_signed: number }[]
    expect(rows).toHaveLength(2)

    const soma = rows.reduce((acc, e) => acc + Number(e.amount_signed), 0)
    expect(Math.round(soma * 100) / 100).toBe(0)

    // `amount_signed` é coluna gerada: débito soma, crédito subtrai.
    expect(rows.some((e) => Number(e.amount_signed) === 250)).toBe(true)
    expect(rows.some((e) => Number(e.amount_signed) === -250)).toBe(true)
  })

  test('lançamento é imutável: UPDATE e DELETE são recusados', async () => {
    const tenantId = await getTestTenantId()
    const txId = await createTransaction(tenantId, 'imutabilidade')

    const { error: insErr } = await admin()
      .from('financial_entries')
      .insert([
        { tenant_id: tenantId, transaction_id: txId, account_code: 'caixa_e_bancos', direction: 'debit', amount: 80 },
        { tenant_id: tenantId, transaction_id: txId, account_code: 'contas_a_receber', direction: 'credit', amount: 80 },
      ])
    expect(insErr, insErr?.message).toBeNull()

    const { data: created } = await admin()
      .from('financial_entries')
      .select('id, amount')
      .eq('transaction_id', txId)
      .eq('direction', 'debit')
      .single()

    const entryId = (created as { id: string }).id

    // Adulterar valor: recusado por trigger, não por RLS. Diferente de
    // audit_logs (0 linhas afetadas, sem erro), aqui a exceção é explícita.
    const { error: updErr } = await admin()
      .from('financial_entries')
      .update({ amount: 9999 })
      .eq('id', entryId)

    expect(updErr, 'UPDATE em lançamento deveria explodir').not.toBeNull()

    const { error: delErr } = await admin()
      .from('financial_entries')
      .delete()
      .eq('id', entryId)

    expect(delErr, 'DELETE em lançamento deveria explodir').not.toBeNull()

    // O valor original sobrevive intacto aos dois ataques.
    const { data: after } = await admin()
      .from('financial_entries')
      .select('amount')
      .eq('id', entryId)
      .single()

    expect(Number((after as { amount: number }).amount)).toBe(80)
  })

  test('transação lançada não pode ser reescrita nem apagada', async () => {
    const tenantId = await getTestTenantId()
    const txId = await createTransaction(tenantId, 'transação imutável')

    await admin()
      .from('financial_entries')
      .insert([
        { tenant_id: tenantId, transaction_id: txId, account_code: 'caixa_e_bancos', direction: 'debit', amount: 40 },
        { tenant_id: tenantId, transaction_id: txId, account_code: 'receita_locacao', direction: 'credit', amount: 40 },
      ])

    // Apagar a transação levaria as pernas junto e abriria um buraco no
    // histórico — é o caminho que o estorno existe para substituir.
    const { error: delErr } = await admin()
      .from('financial_transactions')
      .delete()
      .eq('id', txId)

    expect(delErr, 'DELETE em transação com lançamento deveria ser recusado').not.toBeNull()

    const { data: still } = await admin()
      .from('financial_transactions')
      .select('id')
      .eq('id', txId)
      .maybeSingle()

    expect(still).not.toBeNull()
  })

  test('item de origem estranha não entra na cobrança', async () => {
    // "Uma cobrança cobra uma coisa só" era acordo verbal: todo chamador já
    // passava uma origem única, mas nada impedia o contrário. Acordo verbal é
    // o que este redesenho vem substituindo por invariante.
    const tenantId = await getTestTenantId()

    const { data: customer } = await admin()
      .from('customers')
      .insert({ tenant_id: tenantId, name: `${TEST_TAG} Origem única`, in_queue: false })
      .select('id')
      .single()
    const customerId = (customer as { id: string }).id

    const { data: n } = await admin().rpc('fn_next_charge_number', { p_tenant_id: tenantId })
    const fonte = crypto.randomUUID()

    const { data: charge } = await admin()
      .from('charges')
      .insert({
        tenant_id: tenantId, customer_id: customerId, charge_number: n as number,
        due_date: '2026-12-01', source_module: 'fine', source_id: fonte,
      })
      .select('id')
      .single()
    const chargeId = (charge as { id: string }).id

    // Item da própria origem: entra.
    const { error: okErr } = await admin().from('charge_items').insert({
      tenant_id: tenantId, charge_id: chargeId, description: `${TEST_TAG} Multa`,
      credit_account_code: 'repasse_multa', quantity: 1, unit_amount: 100, amount: 100,
      source_module: 'fine', source_id: fonte,
    })
    expect(okErr, okErr?.message).toBeNull()

    // Item de OUTRA origem: recusado. É o caso que a regra proíbe — misturar
    // aluguel com multa no mesmo documento.
    const { error: mixErr } = await admin().from('charge_items').insert({
      tenant_id: tenantId, charge_id: chargeId, description: `${TEST_TAG} Aluguel`,
      credit_account_code: 'receita_locacao', quantity: 1, unit_amount: 600, amount: 600,
      source_module: 'rental', source_id: crypto.randomUUID(),
    })
    expect(mixErr, 'item de outra origem foi aceito').not.toBeNull()
    expect(mixErr!.message).toMatch(/uma coisa s(ó|o)/i)

    // Encargo por atraso é ACESSÓRIO da mesma dívida, não outra coisa: entra.
    const { error: encargoErr } = await admin().from('charge_items').insert({
      tenant_id: tenantId, charge_id: chargeId, description: `${TEST_TAG} Encargo`,
      credit_account_code: 'receita_encargos_atraso', quantity: 1, unit_amount: 8.38, amount: 8.38,
      source_module: 'late_charge', source_id: chargeId,
    })
    expect(encargoErr, encargoErr?.message).toBeNull()

    // O documento nasceu cru porque o alvo aqui é a trigger de coerência do
    // item, não o fluxo de emissão. Apagar não é opção — item de cobrança é
    // imutável (`trg_charge_items_immutable`) —, então fecha-se o razão: sem
    // isso sobra cobrança sem lançamento, e `reconciliacao.spec.ts`, que varre
    // o banco inteiro, acusaria fixture como se fosse defeito de produto.
    const { error: postErr } = await admin().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'charge_issued',
        description: `${TEST_TAG} Emissão da multa`,
        source_module: 'fine',
        source_id: fonte,
      },
      p_entries: [
        { account_code: 'contas_a_receber',        direction: 'debit',  amount: 108.38, charge_id: chargeId, customer_id: customerId },
        { account_code: 'repasse_multa',           direction: 'credit', amount: 100,    charge_id: chargeId, customer_id: customerId },
        { account_code: 'receita_encargos_atraso', direction: 'credit', amount: 8.38,   charge_id: chargeId, customer_id: customerId },
      ],
    })
    expect(postErr, postErr?.message).toBeNull()
  })

  test('a mesma origem não gera duas cobranças vivas', async () => {
    // Fecha um buraco que ninguém tinha notado: nada impedia registrar a mesma
    // multa duas vezes e cobrar o cliente em dobro.
    const tenantId = await getTestTenantId()

    const { data: customer } = await admin()
      .from('customers')
      .insert({ tenant_id: tenantId, name: `${TEST_TAG} Origem dupla`, in_queue: false })
      .select('id')
      .single()
    const customerId = (customer as { id: string }).id
    const fonte = crypto.randomUUID()

    async function emitir() {
      const { data: n } = await admin().rpc('fn_next_charge_number', { p_tenant_id: tenantId })
      return admin().from('charges').insert({
        tenant_id: tenantId, customer_id: customerId, charge_number: n as number,
        due_date: '2026-12-01', source_module: 'fine', source_id: fonte,
      })
    }

    const { error: primeira } = await emitir()
    expect(primeira, primeira?.message).toBeNull()

    const { error: segunda } = await emitir()
    expect(segunda, 'a mesma multa gerou duas cobranças').not.toBeNull()

    // Este teste cria documento SEM lançamento de propósito — o alvo é o índice
    // de origem única, não o fluxo. Limpar é obrigatório: `reconciliacao.spec.ts`
    // varre o banco inteiro atrás de cobrança órfã, e sobra daqui seria
    // indistinguível de defeito real.
    await admin().from('charges').delete().eq('source_id', fonte)
    await admin().from('customers').delete().eq('id', customerId)
  })
})
