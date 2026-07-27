/**
 * @file utils/index.ts
 * @description Utilitários puros do domínio — sem dependências de UI ou framework.
 * Compartilhados entre web (Next.js) e mobile (Expo).
 */

/**
 * @function formatCurrency
 * @description Formata um valor numérico como moeda brasileira (BRL).
 * @param value - Valor a ser formatado.
 * @returns String formatada (ex: "R$ 1.250,00").
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/**
 * @function formatCurrencyPlain
 * @description Formata um valor numérico como moeda brasileira, sem o
 * símbolo "R$" (ex: "1.250,00") — usado ao lado do valor por extenso.
 * @param value - Valor a ser formatado.
 * @returns String formatada.
 */
export function formatCurrencyPlain(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * @function formatDate
 * @description Converte uma data em string curta (DD/MM/AAAA) no padrão pt-BR.
 * @param date - Objeto Date ou string ISO/date.
 * @returns String formatada.
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR').format(new Date(date))
}

export * from './currency-words'
export * from './date-words'
