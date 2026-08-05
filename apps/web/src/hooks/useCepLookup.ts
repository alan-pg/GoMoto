'use client'

import { useState, useCallback, useRef } from 'react'
import { lookupCep, type ViaCepAddress, type CepLookupError } from '@/lib/viacep'

const ERROR_MESSAGES: Record<CepLookupError, string> = {
  not_found: 'CEP não encontrado.',
  invalid:   'CEP inválido — deve ter 8 dígitos.',
  network:   'Erro ao consultar o CEP. Verifique a conexão.',
}

interface UseCepLookupReturn {
  /** Consulta o CEP e retorna o endereço, ou null em caso de erro. */
  lookup: (cep: string) => Promise<ViaCepAddress | null>
  /** True enquanto a requisição está em andamento. */
  loading: boolean
  /** Mensagem de erro traduzida, ou null quando não há erro. */
  error: string | null
  /** Limpa o estado de erro manualmente. */
  clearError: () => void
}

/**
 * Hook para consulta de CEP via ViaCEP.
 *
 * @example
 * const { lookup, loading, error } = useCepLookup()
 *
 * // Chamar quando o CEP atingir 8 dígitos:
 * const address = await lookup(cepValue)
 * if (address) {
 *   setStreet(address.street)
 *   setCity(address.city)
 *   // ...
 * }
 */
export function useCepLookup(): UseCepLookupReturn {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  // Cancela lookup anterior se o usuário continuar digitando
  const abortRef = useRef<AbortController | null>(null)

  const lookup = useCallback(async (cep: string): Promise<ViaCepAddress | null> => {
    // Cancela qualquer consulta anterior ainda pendente
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setError(null)
    setLoading(true)

    const result = await lookupCep(cep)

    setLoading(false)

    if (!result.ok) {
      setError(ERROR_MESSAGES[result.error])
      return null
    }

    return result.address
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { lookup, loading, error, clearError }
}
