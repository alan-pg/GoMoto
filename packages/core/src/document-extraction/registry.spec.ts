import { describe, it, expect } from 'vitest'
import {
  CnhFieldsSchema,
  FineNoticeFieldsSchema,
  documentExtractionRegistry,
} from './registry'

describe('CnhFieldsSchema', () => {
  it('aceita objeto bem formado (RF-003)', () => {
    const result = CnhFieldsSchema.safeParse({
      name: { value: 'João da Silva', confidence: 'high' },
      cpf: { value: '12345678901', confidence: 'high' },
      rg: { value: '123456789', confidence: 'low' },
      birth_date: { value: '1990-01-01', confidence: 'high' },
      drivers_license: { value: '12345678900', confidence: 'high' },
      drivers_license_category: { value: 'AB', confidence: 'high' },
      drivers_license_validity: { value: '2030-01-01', confidence: 'high' },
    })
    expect(result.success).toBe(true)
  })

  it('rejeita confidence fora de high/low (RF-004)', () => {
    const result = CnhFieldsSchema.safeParse({
      name: { value: 'João da Silva', confidence: 'medium' },
      cpf: { value: null, confidence: 'low' },
      rg: { value: null, confidence: 'low' },
      birth_date: { value: null, confidence: 'low' },
      drivers_license: { value: null, confidence: 'low' },
      drivers_license_category: { value: null, confidence: 'low' },
      drivers_license_validity: { value: null, confidence: 'low' },
    })
    expect(result.success).toBe(false)
  })
})

describe('FineNoticeFieldsSchema', () => {
  it('aceita objeto bem formado, incluindo amount numérico e campos da NA (PRD 0013)', () => {
    const result = FineNoticeFieldsSchema.safeParse({
      license_plate: { value: 'ABC1234', confidence: 'high' },
      description: { value: 'Excesso de velocidade', confidence: 'high' },
      infraction_date: { value: '2026-01-01', confidence: 'high' },
      amount: { value: 293.47, confidence: 'high' },
      ait_number: { value: 'A123456789', confidence: 'high' },
      infraction_location: { value: 'Av. Paulista', confidence: 'low' },
      renainf_number: { value: '10581781538', confidence: 'high' },
      notification_date: { value: '2026-02-01', confidence: 'high' },
      prior_defense_deadline: { value: '2026-03-01', confidence: 'high' },
      driver_identification_deadline: { value: '2026-03-01', confidence: 'high' },
      senatran_infraction_code: { value: '7455', confidence: 'high' },
      senatran_infraction_subcode: { value: '0', confidence: 'high' },
      issuing_agency_name: { value: 'PREF. DE RJ RIO DE JANEIRO', confidence: 'high' },
      issuing_agency_code: { value: '260010', confidence: 'high' },
      competent_agency_code: { value: '260010', confidence: 'high' },
      competent_agency_name: { value: 'PREF. DE RJ RIO DE JANEIRO', confidence: 'high' },
      driver_name: { value: null, confidence: 'low' },
      driver_cnh: { value: null, confidence: 'low' },
      driver_cpf: { value: null, confidence: 'low' },
      driver_document: { value: null, confidence: 'low' },
      infraction_time: { value: '14:18', confidence: 'high' },
      measurement_instrument_id: { value: '0580541121 - 1', confidence: 'high' },
      traffic_agent_id: { value: '15515063', confidence: 'high' },
      measured_speed: { value: 89, confidence: 'high' },
      considered_speed: { value: 82, confidence: 'high' },
      speed_limit: { value: 80, confidence: 'high' },
      original_renainf_number: { value: null, confidence: 'low' },
      infraction_municipality_code: { value: '6001', confidence: 'high' },
      infraction_municipality_name: { value: 'RIO DE JANEIRO', confidence: 'high' },
      infraction_state: { value: 'RJ', confidence: 'high' },
      senatran_message: { value: null, confidence: 'low' },
    })
    expect(result.success).toBe(true)
  })
})

describe('documentExtractionRegistry', () => {
  it('tem uma entrada para cnh e fine_notice (RN-005)', () => {
    expect(Object.keys(documentExtractionRegistry).sort()).toEqual(['cnh', 'fine_notice'])
  })

  it('cnh aponta pro schema e prompt certos', () => {
    expect(documentExtractionRegistry.cnh.fieldsSchema).toBe(CnhFieldsSchema)
    expect(documentExtractionRegistry.cnh.targetEntity).toBe('customer')
    expect(documentExtractionRegistry.cnh.promptBuilder()).toContain('CNH')
  })

  it('fine_notice aponta pro schema e prompt certos', () => {
    expect(documentExtractionRegistry.fine_notice.fieldsSchema).toBe(FineNoticeFieldsSchema)
    expect(documentExtractionRegistry.fine_notice.targetEntity).toBe('fine')
    expect(documentExtractionRegistry.fine_notice.promptBuilder()).toContain('AIT')
  })
})
