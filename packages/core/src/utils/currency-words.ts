/**
 * @file utils/currency-words.ts
 * @description Conversão de valores numéricos e monetários para texto por
 * extenso em português (pt-BR) — usado na geração de contratos.
 */

const UNITS = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
]
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const HUNDREDS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
]
const SCALES = [
  { value: 1_000_000_000, singular: 'bilhão', plural: 'bilhões' },
  { value: 1_000_000, singular: 'milhão', plural: 'milhões' },
  { value: 1_000, singular: 'mil', plural: 'mil' },
] as const

function threeDigitsToWords(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]!)
  if (rest > 0) {
    if (rest < 20) {
      parts.push(UNITS[rest]!)
    } else {
      const tens = Math.floor(rest / 10)
      const units = rest % 10
      parts.push(units > 0 ? `${TENS[tens]} e ${UNITS[units]}` : TENS[tens]!)
    }
  }
  return parts.join(' e ')
}

/**
 * @function numberToWordsPtBr
 * @description Converte um número inteiro não-negativo para texto por
 * extenso em português (ex: 350 → "trezentos e cinquenta").
 */
export function numberToWordsPtBr(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('numberToWordsPtBr: número inválido')
  }
  const value = Math.floor(n)
  if (value === 0) return 'zero'

  let remaining = value
  const segments: string[] = []
  for (const scale of SCALES) {
    const count = Math.floor(remaining / scale.value)
    if (count > 0) {
      remaining -= count * scale.value
      if (scale.value === 1000) {
        segments.push(count === 1 ? 'mil' : `${threeDigitsToWords(count)} mil`)
      } else {
        segments.push(`${threeDigitsToWords(count)} ${count === 1 ? scale.singular : scale.plural}`)
      }
    }
  }
  if (remaining > 0) segments.push(threeDigitsToWords(remaining))

  if (segments.length === 1) return segments[0]!
  const last = segments[segments.length - 1]
  const head = segments.slice(0, -1)
  // "e" só liga o último segmento quando ele é uma dezena/unidade (< 100) —
  // caso contrário as escalas se justapõem sem conectivo (ex: "mil duzentos").
  const needsE = remaining > 0 && remaining < 100
  return needsE ? `${head.join(', ')} e ${last}` : `${head.join(', ')} ${last}`
}

/**
 * @function currencyToExtensoPtBr
 * @description Converte um valor monetário (BRL) para texto por extenso
 * (ex: 350 → "trezentos e cinquenta reais").
 */
export function currencyToExtensoPtBr(value: number): string {
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const reais = Math.floor(rounded)
  const cents = Math.round((rounded - reais) * 100)

  const reaisWords = reais === 1 ? 'um real' : `${numberToWordsPtBr(reais)} reais`
  if (cents === 0) return reaisWords

  const centsWords = cents === 1 ? 'um centavo' : `${numberToWordsPtBr(cents)} centavos`
  return reais === 0 ? centsWords : `${reaisWords} e ${centsWords}`
}
