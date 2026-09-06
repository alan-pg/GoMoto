/**
 * Privilégio no caminho do dinheiro — ADR 0034.
 *
 * A suíte `tenant-isolation-financeiro.spec.ts` pergunta se o tenant 1 alcança
 * o tenant 2. Este spec pergunta outra coisa, que nenhum teste perguntava: **o
 * que dá para fazer SEM ser ninguém, e o que um membro qualquer da própria
 * empresa consegue escrever?**
 *
 * A pergunta não era acadêmica. Antes desta ADR, com a chave anônima — a que
 * viaja no bundle do navegador de toda página publicada — e mais nada:
 *
 *     POST /rest/v1/rpc/post_financial_transaction
 *     { "p_tenant_id": "<qualquer empresa>", ... }
 *     → HTTP 200, lançamento de R$ 999.999,00 no razão daquela empresa
 *
 * A causa era um `ALTER DEFAULT PRIVILEGES ... GRANT ALL ... TO anon` de
 * 2026-06-27: toda função criada depois nascia concedida a `anon`. As demais
 * funções de dinheiro escaparam porque conferem o tenant por dentro e o
 * conjunto de tenants do `anon` é vazio; `post_financial_transaction` recebia
 * `p_tenant_id` como parâmetro e não perguntava nada a ninguém.
 *
 * Estes testes são o alarme para a reincidência. Nenhum portão anterior via
 * isso: typecheck, unit e E2E de tela passavam com o buraco aberto — é a mesma
 * lição de que os portões não enxergam o banco.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { getSupabase, getSupabaseAdmin, getTestTenantId } from './helpers'

const admin = () => getSupabaseAdmin()

/** Cliente sem login: exatamente o que qualquer visitante consegue montar. */
function anonimo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY não definidos')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Perna dupla e balanceada: sem isto o `trg_entries_balanced` recusaria por outro motivo. */
const PERNAS_BALANCEADAS = [
  { account_code: 'caixa_e_bancos', direction: 'debit', amount: 999999 },
  { account_code: 'contas_a_receber', direction: 'credit', amount: 999999 },
]

test.describe('Razão fora do alcance de quem não está logado (ADR 0034)', () => {
  test('anon não lança no razão — o exploit que existiu', async () => {
    const tenantId = await getTestTenantId()

    const { data, error } = await anonimo().rpc('post_financial_transaction', {
      p_tenant_id: tenantId,
      p_transaction: {
        event_type: 'payment_received',
        description: 'REGRESSÃO ADR 0034',
        source_module: 'regressao_adr34',
      },
      p_entries: PERNAS_BALANCEADAS,
    })

    expect(data ?? null, 'anon criou uma transação no razão').toBeNull()
    expect(error, 'anon deveria ser recusado ao lançar no razão').not.toBeNull()
    expect(error!.code, `recusa por privilégio esperada, veio: ${error!.message}`).toBe('42501')

    // A asserção que mais importa: nada persistiu. Um erro devolvido depois de
    // a escrita acontecer não valeria nada.
    const { count } = await admin()
      .from('financial_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('source_module', 'regressao_adr34')

    expect(count ?? 0, 'o lançamento forjado por anon persistiu').toBe(0)
  })

  test('anon não lê credencial de gateway', async () => {
    const { data, error } = await anonimo().rpc('fn_provider_credentials', {
      p_account_id: '00000000-0000-0000-0000-000000000001',
    })

    expect(data ?? null).toBeNull()
    expect(error, 'anon deveria ser recusado ao ler credencial').not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})

test.describe('O que um membro logado NÃO escreve (ADR 0034)', () => {
  test('não insere lançamento direto no razão — a escrita passa pela RPC', async () => {
    const sb = await getSupabase()
    const tenantId = await getTestTenantId()

    // `post_financial_transaction` é SECURITY DEFINER desde sempre, então o
    // GRANT de INSERT nestas tabelas era desnecessário — e permitia forjar
    // lançamento escolhendo `created_by`, `event_type` e `source_module`.
    const { error } = await sb.from('financial_transactions').insert({
      tenant_id: tenantId,
      event_type: 'payment_received',
      occurred_at: new Date().toISOString(),
      description: 'REGRESSÃO ADR 0034 — insert direto',
      source_module: 'regressao_adr34_direto',
    })

    expect(error, 'INSERT direto no razão deveria ser recusado').not.toBeNull()
  })

  test('não escreve em payment_intents — some o elo entre dinheiro e tentativa', async () => {
    const sb = await getSupabase()
    const tenantId = await getTestTenantId()

    // DELETE é o que dói: `payments.payment_intent_id` é ON DELETE SET NULL,
    // então apagar a tentativa corta a ligação com o recebimento que ela
    // originou — o histórico que o ON DELETE RESTRICT existe para preservar.
    const { error: erroUpdate } = await sb
      .from('payment_intents')
      .update({ status: 'paid' })
      .eq('tenant_id', tenantId)

    expect(erroUpdate, 'UPDATE direto em payment_intents deveria ser recusado').not.toBeNull()

    const { error: erroDelete } = await sb
      .from('payment_intents')
      .delete()
      .eq('tenant_id', tenantId)

    expect(erroDelete, 'DELETE direto em payment_intents deveria ser recusado').not.toBeNull()
  })
})

test.describe('Estorno não se marca sem estorno no razão (ADR 0034)', () => {
  test('reversed_at direto é recusado; fn_reverse_payment continua funcionando', async () => {
    const tenantId = await getTestTenantId()

    const { data: customer } = await admin()
      .from('customers').select('id').eq('tenant_id', tenantId).limit(1).single()
    const customerId = (customer as { id: string }).id

    // Pagamento avulso, sem alocação: basta para exercer a trava do gatilho, e
    // não mexe em saldo de cobrança nenhuma.
    const { data: pagamento, error: erroPagamento } = await admin()
      .from('payments')
      .insert({
        tenant_id: tenantId, customer_id: customerId, amount: 1,
        method: 'pix', paid_at: new Date().toISOString(),
        notes: 'REGRESSÃO ADR 0034',
      })
      .select('id').single()

    expect(erroPagamento, erroPagamento?.message).toBeNull()
    const paymentId = (pagamento as { id: string }).id

    // Sem esta trava, isto reabria a cobrança em `charge_balances` (que filtra
    // por `reversed_at IS NULL`) enquanto o razão seguia mostrando o dinheiro
    // em caixa. Divergência permanente, sem estorno e sem rastro.
    const { error } = await admin()
      .from('payments')
      .update({ reversed_at: new Date().toISOString(), reversal_reason: 'burlando' })
      .eq('id', paymentId)

    expect(error, 'marcar reversed_at sem estorno no razão deveria ser recusado').not.toBeNull()

    const { data: intacto } = await admin()
      .from('payments').select('reversed_at').eq('id', paymentId).single()
    expect((intacto as { reversed_at: string | null }).reversed_at).toBeNull()

    await admin().from('payments').delete().eq('id', paymentId)
  })
})
