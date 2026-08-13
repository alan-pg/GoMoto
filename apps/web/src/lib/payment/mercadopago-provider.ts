/**
 * Mercado Pago como implementação de `PaymentProvider` (Spec 0014 / ADR 0024).
 *
 * O provedor passa a ser uma implementação de interface, não o formato do
 * schema. Somar um segundo gateway é escrever outro arquivo como este e
 * cadastrar a conta — nenhuma migration (F-13).
 */

import { createPixCharge } from './mercadopago'
import type { PaymentProvider } from './intents'

export const mercadoPagoProvider: PaymentProvider = {
  name: 'mercadopago',

  async createIntent({ amount, chargeId, credentials, customer }) {
    const accessToken = (credentials as { access_token?: string }).access_token
    if (!accessToken) {
      throw Object.assign(new Error('Credencial do provedor ausente'), { code: 'FORBIDDEN' })
    }

    const nameParts = (customer.name ?? '').trim().split(/\s+/)
    const firstName = nameParts[0] || 'Cliente'
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName

    const charge = await createPixCharge({
      amount,
      billingId: chargeId,
      customerEmail: customer.email ?? 'cliente@gomoto.app',
      customerFirstName: firstName,
      customerLastName: lastName,
      customerCpf: customer.document,
      accessToken,
    })

    return {
      providerIntentId: charge.mp_payment_id,
      expiresAt: charge.expires_at,
      payload: {
        qr_code: charge.qr_code,
        qr_code_base64: charge.qr_code_base64,
      },
    }
  },
}
