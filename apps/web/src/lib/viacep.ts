/**
 * Cliente ViaCEP — https://viacep.com.br/
 *
 * Uso: chamada direta do browser (CORS liberado pela API).
 * Não usar em Server Components / Server Actions — a consulta não
 * carrega dados sensíveis e não precisa de proxy.
 */

export interface ViaCepAddress {
  street: string       // logradouro
  complement: string   // complemento (pode ser string vazia)
  neighborhood: string // bairro
  city: string         // localidade
  state: string        // uf (2 letras)
}

export type CepLookupError =
  | 'not_found'   // CEP válido mas não existe na base
  | 'invalid'     // formato inválido (não são 8 dígitos)
  | 'network'     // falha de rede / timeout

export type CepLookupResult =
  | { ok: true;  address: ViaCepAddress }
  | { ok: false; error: CepLookupError }

/**
 * Consulta um CEP na API ViaCEP.
 * Aceita CEP com ou sem máscara (ex: "01001-000" ou "01001000").
 */
export async function lookupCep(cep: string): Promise<CepLookupResult> {
  const digits = cep.replace(/\D/g, '')

  if (digits.length !== 8) {
    return { ok: false, error: 'invalid' }
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 400) {
      return { ok: false, error: 'invalid' }
    }

    if (!res.ok) {
      return { ok: false, error: 'network' }
    }

    const data = await res.json()

    // CEP válido na forma mas inexistente retorna { erro: true }
    if (data.erro === true || data.erro === 'true') {
      return { ok: false, error: 'not_found' }
    }

    return {
      ok: true,
      address: {
        street:       data.logradouro  ?? '',
        complement:   data.complemento ?? '',
        neighborhood: data.bairro      ?? '',
        city:         data.localidade  ?? '',
        state:        data.uf          ?? '',
      },
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}
