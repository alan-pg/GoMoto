import { describe, expect, it } from 'vitest'
import { parseCRLVText, crlvSuccessRate } from './crlv'

/**
 * Texto sintético reproduzindo o layout do CRLV-e:
 *  - Bloco 1: labels (descartados pelo parser).
 *  - Marcador "QRCode" indica o início do bloco de valores.
 *  - Bloco 2: valores na ordem fixa observada no documento real.
 */
const SAMPLE_TEXT = [
  'REPÚBLICA FEDERATIVA DO BRASIL',
  'MINISTÉRIO DA INFRAESTRUTURA',
  'DEPARTAMENTO NACIONAL DE TRÂNSITO',
  'RENAVAM',
  'PLACA EXERCÍCIO',
  'CRV',
  'CPF/CNPJ',
  'MARCA/MODELO/VERSÃO',
  'ESPÉCIE/TIPO',
  'PLACA ANTERIOR/UF CHASSI',
  'COR COMBUSTÍVEL',
  'CATEGORIA',
  'POTÊNCIA/CILINDRADA',
  'PROPRIETÁRIO',
  'CPF/CNPJ',
  'MUNICÍPIO UF DATA',
  'OBSERVAÇÕES',
  'QRCode',
  '12345678901',
  'ABC1D23 2025',
  '2023 2024',
  '987654321012',
  '123.456.789-09',
  'HONDA/CG 160 FAN',
  'PASSAGEIRO AUTOMOVEL',
  'XYZ9999/SP 9C2KC2220NR654321',
  'PRETA GASOLINA',
  'PARTICULAR',
  '111CV/162',
  'JOSE DA SILVA',
  '123.456.789-09',
  'SAO PAULO SP 10/06/2025',
  'SEM OBSERVACOES',
].join('\n')

describe('parseCRLVText', () => {
  const result = parseCRLVText(SAMPLE_TEXT)

  it('extrai RENAVAM como linha de 9-11 dígitos', () => {
    expect(result.renavam).toBe('12345678901')
  })

  it('extrai placa Mercosul', () => {
    expect(result.placa).toBe('ABC1D23')
  })

  it('extrai exercício do licenciamento (ano após a placa)', () => {
    expect(result.exercicio).toBe('2025')
  })

  it('extrai ano de fabricação e modelo da linha "AAAA AAAA"', () => {
    expect(result.anoFabricacao).toBe('2023')
    expect(result.anoModelo).toBe('2024')
  })

  it('extrai número do CRV como bloco de 12 dígitos diferente do RENAVAM', () => {
    expect(result.numeroCrv).toBe('987654321012')
  })

  it('extrai CPF formatado do proprietário', () => {
    expect(result.cpfCnpj).toBe('123.456.789-09')
  })

  it('quebra MARCA/MODELO/VERSÃO em campos separados', () => {
    expect(result.marcaModeloVersao).toBe('HONDA/CG 160 FAN')
    expect(result.marca).toBe('HONDA')
    expect(result.modelo).toBe('CG')
    expect(result.versao).toBe('160 FAN')
  })

  it('extrai espécie/tipo', () => {
    expect(result.especieTipo).toBe('PASSAGEIRO AUTOMOVEL')
  })

  it('extrai placa anterior + UF + chassi (VIN 17)', () => {
    expect(result.placaAnterior).toBe('XYZ9999')
    expect(result.chassi).toBe('9C2KC2220NR654321')
    expect(result.uf).toBe('SP')
  })

  it('extrai cor e combustível do par "COR COMBUSTÍVEL"', () => {
    expect(result.cor).toBe('PRETA')
    expect(result.combustivel).toBe('GASOLINA')
  })

  it('extrai categoria', () => {
    expect(result.categoria).toBe('PARTICULAR')
  })

  it('extrai potência e cilindrada da forma "111CV/162"', () => {
    expect(result.potencia).toBe('111 CV')
    expect(result.cilindrada).toBe('162 cc')
  })

  it('extrai nome do proprietário', () => {
    expect(result.proprietario).toBe('JOSE DA SILVA')
  })

  it('extrai município, UF e data de emissão', () => {
    expect(result.municipio).toBe('SAO PAULO')
    expect(result.dataEmissao).toBe('10/06/2025')
  })

  it('extrai observações', () => {
    expect(result.observacoes).toBe('SEM OBSERVACOES')
  })

  it('não explode com texto vazio — devolve todos os campos null', () => {
    const empty = parseCRLVText('')
    expect(Object.values(empty).every((v) => v === null)).toBe(true)
  })

  it('crlvSuccessRate conta apenas campos preenchidos', () => {
    const rate = crlvSuccessRate(result)
    expect(rate.found).toBeGreaterThanOrEqual(15)
    expect(rate.total).toBeGreaterThanOrEqual(rate.found)
  })
})
