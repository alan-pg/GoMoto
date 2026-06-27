import { describe, it, expect } from 'vitest'
import { isPixActive, isPixExpired, canGeneratePix, validateWebhookSignature } from './payments'

describe('isPixActive', () => {
  it('retorna true para Pix gerado há 1 hora', () => {
    const createdAt = new Date(Date.now() - 1 * 60 * 60 * 1000)
    expect(isPixActive(createdAt)).toBe(true)
  })

  it('retorna false para Pix gerado há 25 horas', () => {
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    expect(isPixActive(createdAt)).toBe(false)
  })

  it('retorna false para Pix gerado exatamente 24 horas atrás', () => {
    const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(isPixActive(createdAt)).toBe(false)
  })
})

describe('isPixExpired', () => {
  it('retorna false para Pix gerado há 1 hora', () => {
    const createdAt = new Date(Date.now() - 1 * 60 * 60 * 1000)
    expect(isPixExpired(createdAt)).toBe(false)
  })

  it('retorna true para Pix gerado há 25 horas', () => {
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    expect(isPixExpired(createdAt)).toBe(true)
  })
})

describe('canGeneratePix', () => {
  it('retorna true para cobrança pendente com conexão ativa', () => {
    expect(canGeneratePix({ status: 'pending', original_amount: 350 }, true)).toBe(true)
  })

  it('retorna false para cobrança com status paid', () => {
    expect(canGeneratePix({ status: 'paid', original_amount: 350 }, true)).toBe(false)
  })

  it('retorna false para cobrança com status cancelled', () => {
    expect(canGeneratePix({ status: 'cancelled', original_amount: 350 }, true)).toBe(false)
  })

  it('retorna false quando tenant não tem conexão MP', () => {
    expect(canGeneratePix({ status: 'pending', original_amount: 350 }, false)).toBe(false)
  })

  it('retorna false para cobrança com valor líquido menor que R$0,01', () => {
    expect(canGeneratePix({ status: 'pending', original_amount: 0, discount_amount: 0 }, true)).toBe(false)
  })

  it('retorna true para cobrança vencida com conexão ativa', () => {
    expect(canGeneratePix({ status: 'overdue', original_amount: 200 }, true)).toBe(true)
  })

  it('respeita desconto ao calcular valor líquido', () => {
    expect(canGeneratePix({ status: 'pending', original_amount: 50, discount_amount: 50 }, true)).toBe(false)
  })
})

describe('validateWebhookSignature', () => {
  async function makeSignature(paymentId: string, requestId: string, ts: string, secret: string) {
    const data = `id:${paymentId};request-id:${requestId};ts:${ts}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
    return Array.from(new Uint8Array(computed))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  it('retorna true para assinatura válida', async () => {
    const secret = 'test-secret-key'
    const sig = await makeSignature('123', 'req-abc', '1700000000', secret)
    expect(await validateWebhookSignature('123', 'req-abc', '1700000000', sig, secret)).toBe(true)
  })

  it('retorna false para assinatura inválida', async () => {
    expect(await validateWebhookSignature('123', 'req-abc', '1700000000', 'invalida', 'secret')).toBe(false)
  })

  it('retorna false para payload modificado', async () => {
    const secret = 'test-secret-key'
    const sig = await makeSignature('123', 'req-abc', '1700000000', secret)
    expect(await validateWebhookSignature('999', 'req-abc', '1700000000', sig, secret)).toBe(false)
  })
})
