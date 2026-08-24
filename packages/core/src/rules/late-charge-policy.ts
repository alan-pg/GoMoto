/**
 * Política de encargo por atraso: conversão entre a unidade do CONTRATO e a
 * unidade do BANCO.
 *
 * O operador e o contrato falam "multa de 2%, juros de 1% ao mês". O banco
 * guarda fração e taxa DIÁRIA: 0.02 e 0.000333. Essa tradução já foi feita
 * errada duas vezes nesta base — `calculateLateCharges` (removida) dividia o
 * percentual por 100, tratando `2` como 2%, enquanto a regra viva
 * (`calculateAccruedCharges`) multiplica direto, tratando `0.02` como 2%. As
 * duas convenções conviveram, e a tela de manutenção chegou a montar
 * `late_fee_value: 0.02` na convenção errada — o que ali significava 0,02%.
 *
 * Por isso a conversão mora aqui, testada, e não em `onChange` de formulário.
 */

import { z } from 'zod'
import type { LateChargePolicy } from './allocation'

/** Base de conversão mês → dia. Convenção comercial: todo mês tem 30 dias. */
export const DAYS_PER_MONTH = 30

function round(n: number, casas: number): number {
  const f = 10 ** casas
  return Math.round(n * f) / f
}

/**
 * O que o formulário coleta — nas unidades em que o operador pensa.
 *
 * `fee_value` é percentual quando `fee_type = 'percentage'` (2 = 2%) e reais
 * quando `fixed`. `monthly_interest_percent` é sempre ao mês.
 */
export const LateChargePolicyInputSchema = z.object({
  fee_type:                 z.enum(['fixed', 'percentage']),
  fee_value:                z.number().min(0, 'A multa não pode ser negativa'),
  monthly_interest_percent: z.number().min(0, 'Os juros não podem ser negativos'),
  grace_period_days:        z.number().int().min(0).max(365),
  min_amount:               z.number().min(0),
  effective_from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
}).refine((d) => d.fee_type !== 'percentage' || d.fee_value <= 100, {
  message: 'Multa em percentual não pode passar de 100%',
  path: ['fee_value'],
}).refine((d) => d.monthly_interest_percent <= 100, {
  message: 'Juros não podem passar de 100% ao mês',
  path: ['monthly_interest_percent'],
})

export type LateChargePolicyInput = z.infer<typeof LateChargePolicyInputSchema>

/** Colunas de `late_charge_policies`, nas unidades da tabela. */
export type LateChargePolicyRow = LateChargePolicy & { effective_from: string }

/**
 * Unidade do contrato → unidade do banco.
 *
 * `daily_interest_rate` é NUMERIC(10,6): arredondar aqui evita que o banco
 * trunque por conta própria e o valor lido de volta não bata com o gravado.
 */
export function toPolicyRow(input: LateChargePolicyInput): LateChargePolicyRow {
  return {
    fee_type:  input.fee_type,
    // Percentual vira fração — é o que o CHECK `late_charge_percentage_is_fraction`
    // cobra. Valor fixo é em reais e passa direto.
    fee_value: input.fee_type === 'percentage'
      ? round(input.fee_value / 100, 6)
      : round(input.fee_value, 2),
    daily_interest_rate: round(input.monthly_interest_percent / 100 / DAYS_PER_MONTH, 6),
    grace_period_days:   input.grace_period_days,
    min_amount:          round(input.min_amount, 2),
    effective_from:      input.effective_from,
  }
}

/**
 * Unidade do banco → unidade do contrato, para preencher o formulário.
 *
 * Não é o inverso exato de `toPolicyRow`: 1% ao mês grava 0.000333 e volta como
 * 0,999%. Arredondar em 2 casas devolve 1,00 — e a política semeada, 0.00033,
 * volta como 0,99%, que é o que ela de fato é. Exibir o número verdadeiro
 * importa mais do que fingir um round-trip perfeito.
 */
export function toPolicyInput(row: LateChargePolicy): Omit<LateChargePolicyInput, 'effective_from'> {
  return {
    fee_type:  row.fee_type,
    fee_value: row.fee_type === 'percentage'
      ? round(row.fee_value * 100, 2)
      : round(row.fee_value, 2),
    monthly_interest_percent: round(row.daily_interest_rate * DAYS_PER_MONTH * 100, 2),
    grace_period_days:        row.grace_period_days,
    min_amount:               row.min_amount,
  }
}
