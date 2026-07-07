import { z } from 'zod'

export const ContractTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  content: z.record(z.string(), z.unknown()).optional().nullable(),
})

export type ContractTemplateInput = z.infer<typeof ContractTemplateSchema>
