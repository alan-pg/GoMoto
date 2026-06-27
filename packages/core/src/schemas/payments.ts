import { z } from 'zod'

export const GeneratePixSchema = z.object({
  billing_id: z.string().uuid('ID de cobrança inválido'),
})
export type GeneratePix = z.infer<typeof GeneratePixSchema>

export const PixResultSchema = z.object({
  qr_code:        z.string().min(1),
  qr_code_base64: z.string().min(1),
  expires_at:     z.string().datetime(),
  is_reused:      z.boolean(),
})
export type PixResult = z.infer<typeof PixResultSchema>

export const PaymentConnectionStatusSchema = z.object({
  is_connected:     z.boolean(),
  mp_account_email: z.string().email().nullable(),
})
export type PaymentConnectionStatus = z.infer<typeof PaymentConnectionStatusSchema>

export const PixStatusSchema = z.enum(['none', 'active', 'expired', 'paid'])
export type PixStatus = z.infer<typeof PixStatusSchema>
