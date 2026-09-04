import type { ExtractionDocumentType, ExtractionResult, CnhFields, FineNoticeFields } from '@gomoto/core'
import { summarize, type RegistryFieldsOf } from './shared'

/**
 * Fora de produção, a extração é SIMULADA por padrão.
 *
 * A regra era o contrário — real por padrão, mock só com
 * `DOCUMENT_EXTRACTION_MOCK=1`. Na prática ninguém lembra da variável: bastava
 * reiniciar o dev server sem ela para cinco testes E2E falharem por motivo
 * ambiental, e a suíte passava a mentir sobre o estado do código. Aconteceu
 * várias vezes nesta base.
 *
 * Padrão invertido, com uma trava: **produção nunca simula**. Mesmo que a
 * variável esteja setada por engano no deploy, `NODE_ENV === 'production'`
 * força a extração real — o modo de falha aqui seria cadastrar cliente com o
 * CPF fixo do fixture, e isso não pode depender de disciplina de configuração.
 *
 * Para exercitar a IA de verdade em desenvolvimento (custa chamada e exige
 * `AI_GATEWAY_API_KEY`): `DOCUMENT_EXTRACTION_REAL=1`.
 */
export function isMockEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.DOCUMENT_EXTRACTION_REAL !== '1'
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
  amount: { value: 293.47, confidence: 'high' },
  ait_number: { value: 'A123456789', confidence: 'high' },
  infraction_location: { value: null, confidence: 'low' },
  // PRD 0013 — RENAINF é sobrescrito por documento (ver mockRenainfNumber)
  // pra não colidir com a detecção de duplicidade (RF-007) entre os testes
  // desta suíte, que reusam a mesma fixture estática.
  renainf_number: { value: null, confidence: 'low' },
  notification_date: { value: '2026-06-10', confidence: 'high' },
  prior_defense_deadline: { value: '2026-07-20', confidence: 'high' },
  driver_identification_deadline: { value: '2026-07-20', confidence: 'high' },
  senatran_infraction_code: { value: '7455', confidence: 'high' },
  senatran_infraction_subcode: { value: '0', confidence: 'high' },
  issuing_agency_name: { value: 'PREF. DE RJ RIO DE JANEIRO — extração mockada', confidence: 'high' },
  issuing_agency_code: { value: '260010', confidence: 'high' },
  competent_agency_code: { value: '260010', confidence: 'high' },
  competent_agency_name: { value: 'PREF. DE RJ RIO DE JANEIRO — extração mockada', confidence: 'high' },
  driver_name: { value: null, confidence: 'low' },
  driver_cnh: { value: null, confidence: 'low' },
  driver_cpf: { value: null, confidence: 'low' },
  driver_document: { value: null, confidence: 'low' },
  infraction_time: { value: '14:18', confidence: 'high' },
  measurement_instrument_id: { value: null, confidence: 'low' },
  traffic_agent_id: { value: null, confidence: 'low' },
  measured_speed: { value: null, confidence: 'low' },
  considered_speed: { value: null, confidence: 'low' },
  speed_limit: { value: null, confidence: 'low' },
  original_renainf_number: { value: null, confidence: 'low' },
  infraction_municipality_code: { value: '6001', confidence: 'high' },
  infraction_municipality_name: { value: 'RIO DE JANEIRO', confidence: 'high' },
  infraction_state: { value: 'RJ', confidence: 'high' },
  senatran_message: { value: null, confidence: 'low' },
}

/** Deriva um RENAINF único por arquivo — evita colisão com RF-007 (dedup) entre testes da suíte. */
function mockRenainfNumber(file: File): string {
  let hash = 0
  for (let i = 0; i < file.name.length; i++) hash = (hash * 31 + file.name.charCodeAt(i)) >>> 0
  return `MOCK${hash}${Date.now()}`
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
  const fields: FineNoticeFields = {
    ...FINE_NOTICE_FIXTURE,
    ...(plateMatch ? { license_plate: { value: plateMatch[1].toUpperCase(), confidence: 'high' as const } } : {}),
    renainf_number: { value: mockRenainfNumber(file), confidence: 'high' },
  }

  return summarize('fine_notice', fields) as ExtractionResult<RegistryFieldsOf<T>>
}
