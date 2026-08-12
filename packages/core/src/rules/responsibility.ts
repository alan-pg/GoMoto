/**
 * Rateio de responsabilidade financeira.
 *
 * Spec 0014 / ADR 0024, Princípio 7: dinheiro se reparte em VALORES, nunca em
 * percentuais. `maintenances.effective_customer_payer_pct` era `integer` — um
 * rateio de 1/3 sobre R$ 1.000 não é representável, e os valores derivados não
 * fecham, sobrando centavo sem dono (F-17).
 *
 * Percentual continua sendo entrada de UI: `splitByPercentage` converte para
 * valores e garante que a soma feche exatamente, atribuindo o resto de forma
 * explícita em vez de deixá-lo sumir no arredondamento.
 */

export type Responsibility = 'company' | 'customer' | 'shared'
export type ReimbursementMode = 'none' | 'charge' | 'credit'

export type ResponsibilitySplit = {
  responsibility: Responsibility
  /** Parte da empresa, em reais. */
  company_amount: number
  /** Parte do cliente, em reais. */
  customer_amount: number
}

/**
 * Valida e normaliza um rateio.
 *
 * Espelha as CHECK de `payables` (migration 10) — falhar aqui dá erro legível
 * no formulário em vez de violação de constraint vinda do banco.
 */
export function splitResponsibility(
  amount: number,
  responsibility: Responsibility,
  customerAmount = 0,
): ResponsibilitySplit {
  if (!(amount > 0)) {
    throw new Error(`Valor deve ser positivo, recebido ${amount}`)
  }

  const total = round2(amount)
  const customer = round2(customerAmount)

  if (customer < 0) {
    throw new Error(`Parte do cliente não pode ser negativa, recebido ${customer}`)
  }
  if (customer > total) {
    throw new Error(`Parte do cliente (${customer}) excede o total (${total})`)
  }

  switch (responsibility) {
    case 'company':
      if (customer !== 0) {
        throw new Error('Responsabilidade da empresa não admite parte do cliente')
      }
      return { responsibility, company_amount: total, customer_amount: 0 }

    case 'customer':
      if (customer !== total) {
        throw new Error(`Responsabilidade do cliente exige parte igual ao total (${total}), recebido ${customer}`)
      }
      return { responsibility, company_amount: 0, customer_amount: total }

    case 'shared':
      if (customer === 0 || customer === total) {
        throw new Error('Rateio compartilhado exige parte do cliente entre zero e o total (exclusive)')
      }
      return { responsibility, company_amount: round2(total - customer), customer_amount: customer }
  }
}

/**
 * Converte percentual da UI em valores que somam exatamente o total.
 *
 * O resto do arredondamento vai para a EMPRESA — decisão explícita: o cliente
 * nunca paga centavo a mais por artefato de arredondamento.
 *
 * @param percentage Fração de 0 a 1 que cabe ao cliente (0.5 = metade).
 */
export function splitByPercentage(amount: number, percentage: number): ResponsibilitySplit {
  if (!(amount > 0)) {
    throw new Error(`Valor deve ser positivo, recebido ${amount}`)
  }
  if (percentage < 0 || percentage > 1) {
    throw new Error(`Percentual deve estar entre 0 e 1, recebido ${percentage}`)
  }

  const total = round2(amount)

  if (percentage === 0) return splitResponsibility(total, 'company', 0)
  if (percentage === 1) return splitResponsibility(total, 'customer', total)

  // Arredonda para baixo a parte do cliente; o resto fica com a empresa.
  const customer = Math.floor(total * percentage * 100) / 100
  return splitResponsibility(total, 'shared', customer)
}

/**
 * Modo de reembolso coerente com o rateio.
 *
 * Regra dos requisitos: manutenção executada pela EMPRESA com participação do
 * cliente vira cobrança; executada pelo CLIENTE com participação da empresa
 * vira crédito.
 */
export function resolveReimbursementMode(
  split: ResponsibilitySplit,
  executor: 'company' | 'customer',
): ReimbursementMode {
  if (split.customer_amount === 0) return 'none'
  return executor === 'company' ? 'charge' : 'credit'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
