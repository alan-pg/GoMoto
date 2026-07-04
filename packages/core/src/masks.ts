// ── License Plate ──────────────────��─────────────────��────────────────────────
// Pattern A (old):     3 letters + 4 digits    → ABC-1234
// Pattern B (Mercosul): 3 letters + digit + letter + 2 digits → ABC1D23
//
// Character rules per position:
//   0-2: A-Z only
//   3  : digit only
//   4  : A-Z (Mercosul) OR digit (old) — both accepted
//   5-6: digit only

export function applyPlateMask(raw: string): string {
  const clean = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  const result: string[] = []

  for (const c of clean) {
    const pos = result.length
    if (pos >= 7) break
    if (pos < 3  && /[A-Z]/.test(c))   { result.push(c); continue }
    if (pos === 3 && /\d/.test(c))      { result.push(c); continue }
    if (pos === 4 && /[A-Z0-9]/.test(c)){ result.push(c); continue }
    if (pos >= 5  && /\d/.test(c))      { result.push(c); continue }
    // invalid char for this position → skip
  }

  const r = result.join('')
  // Complete old-format plate gets a display dash
  if (r.length === 7 && /^[A-Z]{3}\d{4}$/.test(r)) return `${r.slice(0, 3)}-${r.slice(3)}`
  return r
}

export function stripPlate(masked: string): string {
  return masked.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

// ── RENAVAM ─────────────────────────────────────────────��─────────────────────
// Digits only, max 11. No progressive mask — user just types raw digits.

export function applyRenavamMask(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11)
}

export function stripRenavam(masked: string): string {
  return masked.replace(/\D/g, '')
}

// Keep this for the detail page (formatted display of stored value)
export function formatRenavam(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 9)  return `${d.slice(0, 1)}.${d.slice(1, 4)}.${d.slice(4, 7)}-${d.slice(7)}`
  return d
}

// ── CPF — live mask ────────────���──────────────────────────��───────────────────
// Digits only. Mask is applied progressively as user types.
//   1–3  digits: raw
//   4–6  digits: 000.
//   7–9  digits: 000.000.
//   10–11 digits: 000.000.000-00

export function applyCpfMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

// ── CNPJ — live mask ──────────────────────────────────────────────────��───────
// Digits only. Progressive mask as user types.
//   1–2  : raw
//   3–5  : 00.
//   6–8  : 00.000.
//   9–12 : 00.000.000/
//   13–14: 00.000.000/0000-00

export function applyCnpjMask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2)  return d
  if (d.length <= 5)  return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8)  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

// Keep for detail-page display (apply full mask to stored value)
export function formatDocument(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return applyCpfMask(d)
  if (d.length === 14) return applyCnpjMask(d)
  return d
}

export function stripDocument(masked: string): string {
  return masked.replace(/\D/g, '')
}

export function formatCNPJ(raw: string): string {
  return applyCnpjMask(raw)
}

// ── IMEI ──────────────────────���──────────────────────────────��────────────────
// Digits only, max 15. Detail page shows formatted 999999-99-999999-9.

export function formatIMEI(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 15) return d
  return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8, 14)}-${d.slice(14)}`
}

export function stripIMEI(masked: string): string {
  return masked.replace(/\D/g, '')
}

// ── Currency — live mask ──────────────────────────────────────────────────────
// Allows digits and ONE comma (decimal separator, pt-BR style).
// Thousand separators are applied live to the integer part.
// Examples: "1500"    → "1.500"
//           "1500,"   → "1.500,"
//           "1500,5"  → "1.500,5"
//           "1500,50" → "1.500,50"

export function applyCurrencyMask(raw: string): string {
  // Strip everything except digits and the first comma
  const commaIdx   = raw.indexOf(',')
  const hasComma   = commaIdx !== -1
  const intDigits  = (hasComma ? raw.slice(0, commaIdx) : raw).replace(/\D/g, '')
  const decDigits  = hasComma ? raw.slice(commaIdx + 1).replace(/\D/g, '').slice(0, 2) : null

  if (!intDigits && !hasComma) return ''

  const n           = parseInt(intDigits || '0', 10)
  const formattedInt = isNaN(n) ? (intDigits || '0') : n.toLocaleString('pt-BR')

  if (decDigits !== null) return `${formattedInt},${decDigits}`
  return formattedInt
}

// Converts masked currency string to a parseable decimal string ("1.500,50" → "1500.50")
export function stripCurrencyInput(masked: string): string {
  if (!masked) return ''
  const commaIdx = masked.indexOf(',')
  if (commaIdx === -1) return masked.replace(/\D/g, '')
  const intPart = masked.slice(0, commaIdx).replace(/\D/g, '')
  const decPart = masked.slice(commaIdx + 1).replace(/\D/g, '')
  return decPart ? `${intPart}.${decPart}` : intPart
}

// Formats a raw number string or JS number string for display in a currency input.
// Used to convert DB values (e.g., "1500.5") to masked display ("1.500,50").
export function formatCurrencyInput(raw: string): string {
  if (!raw) return ''
  const hasDot   = raw.includes('.')
  const hasComma = raw.includes(',')
  let normalized: string
  if (hasDot && hasComma) normalized = raw.replace(/\./g, '').replace(',', '.')
  else if (hasComma)      normalized = raw.replace(',', '.')
  else                    normalized = raw
  const num = parseFloat(normalized)
  if (isNaN(num)) return raw
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}
