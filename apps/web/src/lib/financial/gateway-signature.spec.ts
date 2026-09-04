/**
 * Assinatura do webhook de gateway — a única barreira entre a internet e uma
 * confirmação de pagamento.
 *
 * O arquivo sob teste vive em `supabase/functions/_shared/` porque é a Edge
 * Function que o usa; a spec mora aqui porque `packages/core` declara
 * `rootDir: ./src` — fronteira proposital, core não depende de nada fora de si.
 * O import é por caminho relativo de propósito: garante que o teste exercita o
 * MESMO módulo que roda em produção, não uma reimplementação que diverge no
 * primeiro ajuste.
 *
 * O defeito que motivou tudo isto:
 *
 *     let signatureValid = true
 *     if (webhookSecret && parsedSig) { ...valida, 401 se inválida... }
 *
 * Sem o cabeçalho `x-signature`, `parsedSig` era nulo, o bloco inteiro pulado, e
 * `signatureValid` permanecia `true` por inicialização. Bastava OMITIR o
 * cabeçalho: a requisição era aceita e gravada em `gateway_events` como
 * assinatura válida. Quem alcançasse a URL forjava confirmação de pagamento —
 * e o registro dizia que estava tudo conferido.
 */

import { describe, it, expect } from 'vitest'
import {
  verifyWebhookSignature,
  parseXSignature,
  buildManifest,
  signManifest,
  timingSafeEqualHex,
} from '../../../../../supabase/functions/_shared/signature'

const SECRET = 'segredo-do-webhook'
const DATA_ID = '1234567890'
const REQUEST_ID = 'req-abc-123'

async function assinaturaValida(ts = '1700000000'): Promise<string> {
  const v1 = await signManifest(buildManifest(DATA_ID, REQUEST_ID, ts), SECRET)
  return `ts=${ts},v1=${v1}`
}

describe('verifyWebhookSignature', () => {
  it('aceita e marca como verificada quando a assinatura confere', async () => {
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: await assinaturaValida(),
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept).toBe(true)
    expect(verdict.accept && verdict.signatureValid).toBe(true)
  })

  it('RECUSA quando o cabeçalho está ausente e há segredo configurado', async () => {
    // O defeito. Antes isto era aceito COM `signature_valid: true`.
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: null,
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept, 'omitir x-signature deixava passar como válida').toBe(false)
    expect(verdict.accept === false && verdict.reason).toBe('missing_signature')
  })

  it('recusa cabeçalho malformado — sem ts, sem v1, ou vazio', async () => {
    for (const header of ['', 'lixo', 'ts=123', 'v1=abc', 'ts=,v1=']) {
      const verdict = await verifyWebhookSignature({
        secret: SECRET, signatureHeader: header, dataId: DATA_ID, requestId: REQUEST_ID,
      })
      expect(verdict.accept, `aceitou "${header}"`).toBe(false)
    }
  })

  it('recusa assinatura que não confere', async () => {
    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: 'ts=1700000000,v1=' + 'a'.repeat(64),
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept).toBe(false)
    expect(verdict.accept === false && verdict.reason).toBe('invalid_signature')
  })

  it('assinatura de OUTRO payload não vale para este', async () => {
    // Replay com assinatura legítima capturada de outro evento.
    const outra = await signManifest(buildManifest('9999', REQUEST_ID, '1700000000'), SECRET)

    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: `ts=1700000000,v1=${outra}`,
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept, 'assinatura de outro data.id foi aceita').toBe(false)
  })

  it('segredo de terceiro não abre a porta', async () => {
    const v1 = await signManifest(buildManifest(DATA_ID, REQUEST_ID, '1700000000'), 'outro-segredo')

    const verdict = await verifyWebhookSignature({
      secret: SECRET,
      signatureHeader: `ts=1700000000,v1=${v1}`,
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept).toBe(false)
  })

  it('sem segredo configurado processa, mas NUNCA afirma que verificou', async () => {
    // Ambiente local sem a variável. Seguir é aceitável; mentir no registro não
    // — `gateway_events.signature_valid` é o que uma auditoria vai ler depois.
    const verdict = await verifyWebhookSignature({
      secret: undefined,
      signatureHeader: null,
      dataId: DATA_ID,
      requestId: REQUEST_ID,
    })

    expect(verdict.accept).toBe(true)
    expect(
      verdict.accept && verdict.signatureValid,
      'registrou como verificada uma assinatura que ninguém conferiu',
    ).toBe(false)
    expect(verdict.accept && verdict.reason).toBe('unverified_no_secret')
  })
})

describe('parseXSignature', () => {
  it('lê ts e v1 com espaços e ordem invertida', () => {
    expect(parseXSignature(' v1=abc , ts=123 ')).toEqual({ ts: '123', v1: 'abc' })
  })

  it('devolve nulo para o que não é assinatura', () => {
    for (const h of [null, undefined, '', 'ts=1', 'v1=1', 'nada']) {
      expect(parseXSignature(h), `aceitou ${JSON.stringify(h)}`).toBeNull()
    }
  })
})

describe('buildManifest', () => {
  it('omite os campos ausentes, preservando a ordem do contrato', () => {
    expect(buildManifest('ABC', 'req1', '99')).toBe('id:abc;request-id:req1;ts:99;')
    expect(buildManifest('', 'req1', '99')).toBe('request-id:req1;ts:99;')
    expect(buildManifest('ABC', '', '99')).toBe('id:abc;ts:99;')
  })

  it('normaliza o id para minúsculas — o provedor assina assim', () => {
    expect(buildManifest('AbC', 'r', '1')).toBe(buildManifest('abc', 'r', '1'))
  })
})

describe('timingSafeEqualHex', () => {
  it('compara todos os bytes mesmo quando o primeiro já difere', () => {
    // `===` sairia no primeiro byte, vazando quanto do prefixo o atacante
    // acertou. Aqui o que se garante é o resultado; o tempo constante vem da
    // ausência de saída antecipada.
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'zbcd')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(true)
  })
})
