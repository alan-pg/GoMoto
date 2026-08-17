/**
 * Busca em lotes — o defeito que só aparece com volume.
 *
 * `listChargesForCockpit` enriquecia a listagem passando TODOS os ids de
 * cobrança num único `in.(...)`. PostgREST recebe esse filtro na query string,
 * e o Kong recusa URI acima de ~8 KB com **414**. Um UUID ocupa ~37 bytes
 * codificado: passando de ~200 ids, a requisição estoura.
 *
 * O resultado era lido com `?? []`, então o 414 virava lista vazia em silêncio.
 * Na tela de cobranças, TODA linha perdia descrição, nome do cliente e placa,
 * exibindo apenas o rótulo genérico "Cobrança" — sem erro, sem log, sem pista.
 *
 * Não é escala distante: apareceu com 258 cobranças, e foi confirmado no log do
 * Kong (`414` em `/rest/v1/charge_items`) e reproduzido por curl com 10 KB de
 * URL. Nenhum portão pegava: typecheck não vê tamanho de URL, e a suíte E2E só
 * quebrou quando o banco de teste cresceu o bastante.
 */

import { describe, it, expect } from 'vitest'
import { fetchByIdsInChunks } from './ledger'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('fetchByIdsInChunks', () => {
  it('quebra em lotes que cabem na URI, em vez de mandar tudo de uma vez', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i))
    const lotes: string[][] = []

    await fetchByIdsInChunks<{ id: string }>(ids, 'charge_id', async (chunk) => {
      lotes.push(chunk)
      return { data: chunk.map((id) => ({ id })), error: null }
    })

    expect(lotes.length, '250 ids precisam virar mais de uma requisição').toBeGreaterThan(1)

    // O limite do Kong é sobre BYTES, não sobre quantidade: o que precisa valer
    // é que nenhum lote chegue perto de 8 KB depois de codificado.
    for (const lote of lotes) {
      const querystring = encodeURIComponent(lote.join(','))
      expect(querystring.length, 'lote grande demais para a query string').toBeLessThan(6000)
    }
  })

  it('devolve todos os registros, sem perder nem duplicar lote', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i))

    const out = await fetchByIdsInChunks<{ id: string }>(ids, 'charge_id', async (chunk) => ({
      data: chunk.map((id) => ({ id })),
      error: null,
    }))

    expect(out).toHaveLength(250)
    expect(new Set(out.map((r) => r.id)).size, 'lote repetido ou perdido').toBe(250)
  })

  it('lista vazia não dispara requisição alguma', async () => {
    let chamadas = 0
    const out = await fetchByIdsInChunks<{ id: string }>([], 'charge_id', async (chunk) => {
      chamadas++
      return { data: chunk.map((id) => ({ id })), error: null }
    })

    expect(chamadas).toBe(0)
    expect(out).toEqual([])
  })

  it('erro de um lote sobe, em vez de virar lista vazia', async () => {
    // O ponto do defeito: `?? []` transformava 414 em "nenhum item", e a tela
    // degradava sem sinal. Falhar alto é o comportamento correto.
    const ids = Array.from({ length: 150 }, (_, i) => uuid(i))

    await expect(
      fetchByIdsInChunks<{ id: string }>(ids, 'charge_id', async (chunk) =>
        chunk.includes(uuid(120))
          ? { data: null, error: { message: 'URI Too Long' } }
          : { data: chunk.map((id) => ({ id })), error: null }),
    ).rejects.toThrow(/URI Too Long/)
  })
})
