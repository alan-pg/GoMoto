/**
 * @file rules/fines.ts
 * @description Regras puras do cadastro de multas (PRD 0013 / Spec 0013):
 * urgência calculada a partir dos prazos oficiais da NA/NP e detecção de
 * condutor não identificado.
 */

export type FineStatus = 'overdue' | 'due_soon' | 'pending' | 'paid'

export interface FineUrgencyInput {
  status: 'pending' | 'paid'
  due_date?: string | null
  prior_defense_deadline?: string | null
  driver_identification_deadline?: string | null
  appeal_deadline?: string | null
  discounted_payment_deadline?: string | null
}

const URGENCY_DEADLINE_FIELDS = [
  'driver_identification_deadline',
  'prior_defense_deadline',
  'appeal_deadline',
  'discounted_payment_deadline',
  'due_date',
] as const satisfies readonly (keyof FineUrgencyInput)[]

/**
 * RF-008: substitui o cálculo por `due_date` único — usa o prazo em aberto
 * mais próximo entre os prazos oficiais da multa (identificação de condutor,
 * defesa prévia, recurso, vencimento com desconto) e o vencimento genérico
 * já existente. Datas são strings `YYYY-MM-DD`: comparação lexicográfica já
 * é cronológica (mesma convenção de `rules/maintenance.ts`).
 *
 * `today` fica injetável para os testes não dependerem de relógio real.
 */
export function calcFineUrgency(fine: FineUrgencyInput, today: Date = new Date()): FineStatus {
  if (fine.status === 'paid') return 'paid'

  const dates = URGENCY_DEADLINE_FIELDS
    .map((field) => fine[field])
    .filter((d): d is string => !!d)

  if (dates.length === 0) return 'pending'

  const nearest = dates.reduce((min, d) => (d < min ? d : min))

  const ref = new Date(today)
  ref.setHours(0, 0, 0, 0)
  // T12:00:00 evita drift de fuso horário no parse (mesma convenção de rules/maintenance.ts).
  const dueDate = new Date(nearest + 'T12:00:00')

  if (dueDate < ref) return 'overdue'
  const diffDays = Math.ceil((dueDate.getTime() - ref.getTime()) / 86_400_000)
  if (diffDays <= 7) return 'due_soon'
  return 'pending'
}

export interface DriverIdentificationInput {
  driver_identification_deadline?: string | null
  driver_name?: string | null
  driver_cnh?: string | null
  driver_cpf?: string | null
}

export interface FineAttachmentTypeOnly {
  type: string
}

/**
 * RF-010: uma multa fica "condutor não identificado" quando tem prazo de
 * identificação registrado (só existe pra multa de órgão oficial via NA) e
 * ninguém ainda identificou o condutor — nem o próprio documento (NA/NP já
 * chegou com nome/CNH/CPF preenchidos, ex.: reincidência), nem um anexo
 * `driver_indication` registrado pelo operador. O simples vínculo com
 * `customer_id` (cliente da locação) não conta — é vínculo interno, não a
 * indicação formal ao órgão de trânsito.
 */
export function isDriverUnidentified(
  fine: DriverIdentificationInput,
  attachments: FineAttachmentTypeOnly[],
): boolean {
  if (!fine.driver_identification_deadline) return false
  const hasDocumentedDriver = !!(fine.driver_name || fine.driver_cnh || fine.driver_cpf)
  const hasIndicationAttachment = attachments.some((a) => a.type === 'driver_indication')
  return !hasDocumentedDriver && !hasIndicationAttachment
}
