/**
 * @file identity/index.ts
 * @description Helpers de identidade do cliente final (ADR 0004).
 *
 * Regras:
 * - CPF é a identidade canônica: armazenamos 11 dígitos sem máscara.
 * - O login do mobile é por CPF + senha. Como o Supabase Auth exige
 *   um email único, sintetizamos um "shell email" determinístico a
 *   partir do CPF: `${digitos}@cliente.gomoto.app`. Esse email não
 *   recebe mensagens — é só uma chave técnica.
 * - O `customers.email` continua existindo como contato real do
 *   cliente (opcional). Nunca confundir com o shell email.
 */

export const CPF_SHELL_EMAIL_DOMAIN = 'cliente.gomoto.app'

/**
 * Remove tudo que não for dígito e devolve a string crua.
 * Não valida tamanho — use `assertCpfDigits` se precisar de garantia.
 */
export function normalizeCpf(input: string | null | undefined): string {
  if (!input) return ''
  return input.replace(/\D+/g, '')
}

export function isCpfDigits(value: string): boolean {
  return /^[0-9]{11}$/.test(value)
}

/**
 * Normaliza e exige 11 dígitos. Lança erro se inválido — use em
 * fronteiras (Server Actions) onde queremos falhar cedo com mensagem
 * clara. Em validação de formulário prefira o schema zod.
 */
export function assertCpfDigits(input: string | null | undefined): string {
  const digits = normalizeCpf(input)
  if (!isCpfDigits(digits)) {
    throw new Error('CPF inválido: precisa ter 11 dígitos')
  }
  return digits
}

/** Aplica máscara apenas para exibição. Entrada deve ser 11 dígitos. */
export function formatCpf(digits: string): string {
  if (!isCpfDigits(digits)) return digits
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`
}

/**
 * Gera o shell email do cliente a partir do CPF.
 * Trabalha sempre com a forma normalizada (digits-only) para garantir
 * idempotência: chamar duas vezes com formatos diferentes do mesmo
 * CPF produz o mesmo email.
 */
export function cpfShellEmail(cpf: string): string {
  const digits = assertCpfDigits(cpf)
  return `${digits}@${CPF_SHELL_EMAIL_DOMAIN}`
}

export function isCpfShellEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return new RegExp(`^[0-9]{11}@${CPF_SHELL_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`).test(email)
}

/** Devolve os 11 dígitos a partir de um shell email, ou null se não for. */
export function cpfFromShellEmail(email: string | null | undefined): string | null {
  if (!email || !isCpfShellEmail(email)) return null
  return email.split('@')[0] ?? null
}
