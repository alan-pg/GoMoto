import type { ExtractionDocumentType, ExtractionResult, CnhFields, FineNoticeFields } from '@gomoto/core'
import { summarize, type RegistryFieldsOf } from './shared'

/**
 * `DOCUMENT_EXTRACTION_MOCK` só existe no ambiente de teste E2E (Spec 0012
 * §2.2/§9.2) — nunca setada em produção. Substitui a chamada real ao Gemini
 * por um `ExtractionResult` fixo, sem gastar chamada de IA nem exigir
 * `AI_GATEWAY_API_KEY` local.
 */
export function isMockEnabled(): boolean {
  return process.env.DOCUMENT_EXTRACTION_MOCK === '1'
}

const CNH_FIXTURE: CnhFields = {
  name: { value: 'Maria Extração Teste', confidence: 'high' },
  cpf: { value: '52998224725', confidence: 'high' },
  rg: { value: null, confidence: 'low' },
  birth_date: { value: '1990-05-12', confidence: 'high' },
  drivers_license: { value: '02650306461', confidence: 'high' },
  drivers_license_category: { value: 'AB', confidence: 'high' },
  drivers_license_validity: { value: '2030-05-12', confidence: 'high' },
}

const FINE_NOTICE_FIXTURE: FineNoticeFields = {
  license_plate: { value: 'ABC1234', confidence: 'high' },
  description: { value: 'Excesso de velocidade — extração mockada', confidence: 'high' },
  infraction_date: { value: '2026-06-01', confidence: 'high' },
  due_date: { value: '2026-07-01', confidence: 'high' },
  amount: { value: 293.47, confidence: 'high' },
  ait_number: { value: 'A123456789', confidence: 'high' },
  infraction_location: { value: null, confidence: 'low' },
}

/**
 * O nome do arquivo enviado dirige o cenário mockado — simples o bastante
 * pro E2E sem precisar de infra de mock por request:
 *   - contém "mock-fail"            → simula falha do provedor (retorna null)
 *   - contém "mock-plate-<PLACA>"   → usa `<PLACA>` como placa extraída, pra
 *     o teste E2E poder casar com um veículo criado dinamicamente (RF-008)
 *   - qualquer outro nome           → fixture padrão (placa "ABC1234", que não
 *     bate com nenhum veículo de teste — exercita o caminho sem match, RN-006)
 */
export function buildMockResult<T extends ExtractionDocumentType>(
  documentType: T,
  file: File,
): ExtractionResult<RegistryFieldsOf<T>> | null {
  if (file.name.includes('mock-fail')) return null

  if (documentType === 'cnh') {
    return summarize('cnh', CNH_FIXTURE) as ExtractionResult<RegistryFieldsOf<T>>
  }

  const plateMatch = file.name.match(/mock-plate-([A-Za-z0-9]+)/)
  const fields: FineNoticeFields = plateMatch
    ? { ...FINE_NOTICE_FIXTURE, license_plate: { value: plateMatch[1].toUpperCase(), confidence: 'high' } }
    : FINE_NOTICE_FIXTURE

  return summarize('fine_notice', fields) as ExtractionResult<RegistryFieldsOf<T>>
}
