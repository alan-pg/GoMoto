/**
 * @file utils/date-words.ts
 * @description Conversão de data ISO para texto por extenso em português
 * (ex: "2026-07-01" → "1 de julho de 2026") — usado na geração de contratos.
 */

const MONTHS_PT_BR = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/**
 * @function formatDateExtensoPtBr
 * @description Formata uma data (YYYY-MM-DD) como "D de mês de AAAA".
 */
export function formatDateExtensoPtBr(isoDate: string): string {
  const parts = isoDate.split('-').map(Number)
  const year = parts[0]!
  const month = parts[1]!
  const day = parts[2]!
  return `${day} de ${MONTHS_PT_BR[month - 1]} de ${year}`
}
