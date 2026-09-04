/**
 * @file parsers/crlv.ts
 * @description Parser puro do CRLV-e (Certificado de Registro e Licenciamento
 * de Veículo, edição digital). Recebe o texto já extraído de um PDF e devolve
 * os campos identificados.
 *
 * Por que aqui:
 *  - É lógica de domínio (mapear texto bruto → entidade Veículo).
 *  - Roda em qualquer runtime (não depende de fs, Buffer ou pdf-parse).
 *  - Testável com Vitest a partir de strings fixas — sem PDF real.
 *
 * O CRLV-e tem estrutura de dois blocos no texto extraído:
 *   BLOCO 1: labels do formulário ("RENAVAM", "PLACA", "CHASSI", ...)
 *   BLOCO 2: valores reais, começando após o marcador "QRCode"
 *
 * Por isso o parser primeiro corta tudo antes de "QRCode" e só depois aplica
 * as heurísticas — assim os regexes não confundem labels com valores.
 */

export interface CRLVFields {
  renavam: string | null
  placa: string | null
  exercicio: string | null
  anoFabricacao: string | null
  anoModelo: string | null
  numeroCrv: string | null
  cpfCnpj: string | null
  marca: string | null
  modelo: string | null
  versao: string | null
  marcaModeloVersao: string | null
  especieTipo: string | null
  placaAnterior: string | null
  uf: string | null
  chassi: string | null
  cor: string | null
  combustivel: string | null
  categoria: string | null
  potencia: string | null
  cilindrada: string | null
  proprietario: string | null
  municipio: string | null
  dataEmissao: string | null
  observacoes: string | null
}

const EMPTY_FIELDS: CRLVFields = {
  renavam: null,
  placa: null,
  exercicio: null,
  anoFabricacao: null,
  anoModelo: null,
  numeroCrv: null,
  cpfCnpj: null,
  marca: null,
  modelo: null,
  versao: null,
  marcaModeloVersao: null,
  especieTipo: null,
  placaAnterior: null,
  uf: null,
  chassi: null,
  cor: null,
  combustivel: null,
  categoria: null,
  potencia: null,
  cilindrada: null,
  proprietario: null,
  municipio: null,
  dataEmissao: null,
  observacoes: null,
}

const COMBUSTIVEL_TOKENS = /(GASOLINA|ALCOOL|ÁLCOOL|ETANOL|DIESEL|GAS\s+NATURAL|ELÉTRICO|ELETRICO|FLEX|HÍBRIDO|HIBRIDO)/i
const COR_TOKENS = /^(BRANCA|PRETA|VERMELHA|AZUL|VERDE|AMARELA|CINZA|PRATA|BEGE|MARROM|LARANJA|VINHO|DOURADA|ROSA|ROXA)$/i
const COR_OR_COMB =
  /(BRANCA|PRETA|VERMELHA|AZUL|VERDE|AMARELA|CINZA|PRATA|BEGE|MARROM|LARANJA|VINHO|DOURADA|ROSA|ROXA)\s+([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\/]+)/i

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * O bloco de dados começa após "QRCode" no texto extraído.
 * Se não encontra o marcador, devolve o texto completo (fallback).
 */
function extractDataBlock(text: string): string {
  const idx = text.search(/QRCode\s*\n/i)
  if (idx === -1) return text
  return text.slice(idx).replace(/QRCode\s*\n/i, '')
}

function splitLines(dataBlock: string): string[] {
  return dataBlock
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== '--' && !/^-+\s*\d+\s+of\s+\d+\s*-+$/i.test(l))
}

/**
 * Divide a string "MARCA/MODELO VERSAO" em três campos.
 * Convenção do CRLV-e: o primeiro "/" separa marca de (modelo + versão);
 * o restante após o primeiro espaço pertence à versão.
 */
function splitMarcaModeloVersao(joined: string): { marca: string | null; modelo: string | null; versao: string | null } {
  const slashIdx = joined.indexOf('/')
  if (slashIdx === -1) return { marca: null, modelo: joined, versao: null }
  const marca = joined.slice(0, slashIdx).trim()
  const rest = joined.slice(slashIdx + 1).trim()
  const firstSpace = rest.indexOf(' ')
  if (firstSpace === -1) return { marca, modelo: rest, versao: null }
  const modelo = rest.slice(0, firstSpace).trim()
  const versao = rest.slice(firstSpace + 1).trim()
  return { marca, modelo, versao: versao || null }
}

/**
 * @function parseCRLVText
 * @description Aplica heurísticas posicionais e regex sobre o texto extraído
 * de um CRLV-e. Cada campo é independente: o parser nunca explode — campos
 * não encontrados ficam null e o caller decide o que fazer.
 */
export function parseCRLVText(rawText: string): CRLVFields {
  const text = normalize(rawText)
  const dataBlock = extractDataBlock(text)
  const lines = splitLines(dataBlock)
  const fields: CRLVFields = { ...EMPTY_FIELDS }

  // RENAVAM: 9 a 11 dígitos isolados em uma linha.
  const renavamLine = lines.find((l) => /^\d{9,11}$/.test(l))
  if (renavamLine) fields.renavam = renavamLine

  // PLACA: padrão Mercosul (AAA1A23) ou antigo (AAA1234).
  const placaMatch = dataBlock.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/)
  if (placaMatch) fields.placa = placaMatch[1] ?? null

  // CHASSI (VIN): 17 caracteres alfanuméricos sem I, O, Q.
  const chassiMatch = dataBlock.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)
  if (chassiMatch) fields.chassi = chassiMatch[1] ?? null

  // POTÊNCIA / CILINDRADA aparecem grudados como "111CV/1499".
  const potMatch = dataBlock.match(/(\d+)\s*CV\s*\/\s*(\d+)/i)
  if (potMatch) {
    fields.potencia = `${potMatch[1]} CV`
    fields.cilindrada = `${potMatch[2]} cc`
  }

  // CPF formatado vence CNPJ formatado — geralmente o documento do
  // proprietário aparece formatado, enquanto o CPF de operação fica mascarado.
  const cpfFormatted = dataBlock.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/)
  if (cpfFormatted) {
    fields.cpfCnpj = cpfFormatted[1] ?? null
  } else {
    const cnpjFormatted = dataBlock.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)
    if (cnpjFormatted) fields.cpfCnpj = cnpjFormatted[1] ?? null
  }

  // Número do CRV: 12 dígitos contíguos diferentes do RENAVAM.
  const crvMatches = dataBlock.match(/\b\d{12}\b/g)
  if (crvMatches) {
    const found = crvMatches.find((m) => m !== fields.renavam)
    if (found) fields.numeroCrv = found
  }

  // Data de emissão: DD/MM/AAAA.
  const dateMatch = dataBlock.match(/(\d{2}\/\d{2}\/\d{4})/)
  if (dateMatch) fields.dataEmissao = dateMatch[1] ?? null

  // Linha exclusiva com dois anos: "2013 2014" → fabricação + modelo.
  const anosLine = lines.find((l) => /^(20\d{2}|19\d{2})\s+(20\d{2}|19\d{2})$/.test(l))
  if (anosLine) {
    const anos = anosLine.split(/\s+/)
    fields.anoFabricacao = anos[0] ?? null
    fields.anoModelo = anos[1] ?? null
  }

  // Exercício do licenciamento: ano logo após a placa.
  if (fields.placa) {
    const exercicio = dataBlock.match(new RegExp(`${fields.placa}\\s+(\\d{4})`))
    if (exercicio) fields.exercicio = exercicio[1] ?? null
  }

  // MARCA/MODELO/VERSÃO: linha com "/", maiúsculas, não é placa.
  const marcaLine = lines.find(
    (l) =>
      /^[A-Z]{2,}\/[A-Z0-9\s\/.\-]+$/i.test(l) &&
      !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(l) &&
      l.length > 5,
  )
  if (marcaLine) {
    fields.marcaModeloVersao = marcaLine
    const split = splitMarcaModeloVersao(marcaLine)
    fields.marca = split.marca
    fields.modelo = split.modelo
    fields.versao = split.versao
  }

  // ESPÉCIE/TIPO: duas palavras maiúsculas sem dígitos. Ex: "PASSAGEIRO AUTOMOVEL".
  const especieLine = lines.find(
    (l) => /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{4,}\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]{4,}$/.test(l) && !/\d/.test(l),
  )
  if (especieLine) fields.especieTipo = especieLine

  // Cor isolada (lista comum). Senão, par "COR COMBUSTÍVEL".
  const corLine = lines.find((l) => COR_TOKENS.test(l))
  if (corLine) fields.cor = corLine

  if (!fields.cor) {
    const m = dataBlock.match(COR_OR_COMB)
    if (m) {
      fields.cor = m[1] ?? null
      fields.combustivel = m[2] ?? null
    }
  }

  if (!fields.combustivel) {
    const combLine = lines.find((l) => COMBUSTIVEL_TOKENS.test(l))
    if (combLine) {
      const m = combLine.match(COMBUSTIVEL_TOKENS)
      fields.combustivel = m ? (m[1] ?? null) : combLine
    }
  }

  // Categoria oficial do CONTRAN.
  const catLine = lines.find((l) =>
    /^(PARTICULAR|ALUGUEL|OFICIAL|APRENDIZAGEM|DIPLOMÁTICO|DIPLOMATICO|COLETIVO)$/i.test(l),
  )
  if (catLine) fields.categoria = catLine

  // Proprietário: nome em maiúsculas, sem dígitos nem "/", excluindo
  // palavras-chave de header/rodapé, cores e combustíveis (que também
  // são linhas só-maiúsculas e poderiam casar a heurística).
  const nomeLine = lines.find(
    (l) =>
      /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇÀÈÌÒÙÄËÏÖÜ\s]{8,}$/.test(l) &&
      !/\d/.test(l) &&
      !/\//.test(l) &&
      !COR_TOKENS.test(l) &&
      !COMBUSTIVEL_TOKENS.test(l) &&
      !/(BRANCA|PRETA|VERMELHA|AZUL|VERDE|AMARELA|CINZA|PRATA|BEGE|MARROM|LARANJA|VINHO|DOURADA|ROSA|ROXA)\s+/i.test(l) &&
      !/(REPÚBLICA|MINISTÉRIO|DEPARTAMENTO|DENATRAN|CERTIFIC|DIGITAL|CARTEIRA|TRÂNSITO|OBSERVA|MENSAGENS|SEGURO|DPVAT|DADOS|PASSAGEIRO|AUTOMOVEL|PARTICULAR|SEM\s+OBSERV)/i.test(l),
  )
  if (nomeLine) fields.proprietario = nomeLine

  // "MUNICÍPIO UF DD/MM/AAAA" — captura simultânea de cidade, UF e data.
  const localMatch = dataBlock.match(/([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ\s]{3,})\s+([A-Z]{2})\s+\d{2}\/\d{2}\/\d{4}/)
  if (localMatch) {
    fields.municipio = localMatch[1]?.trim() ?? null
    fields.uf = localMatch[2] ?? null
  }

  // Observações livres.
  const obsLine = lines.find((l) => /SEM\s+OBSERVA|OBSERVA/i.test(l))
  if (obsLine) fields.observacoes = obsLine

  // Placa anterior/UF (ex: "ABC1234/SP <chassi>").
  const placaAnt = dataBlock.match(/([A-Z]{3}\d[A-Z0-9]\d{2})\/([A-Z]{2})\s+[A-HJ-NPR-Z0-9]{17}/)
  if (placaAnt) {
    fields.placaAnterior = placaAnt[1] ?? null
    if (!fields.uf) fields.uf = placaAnt[2] ?? null
  }

  return fields
}

/**
 * @function crlvSuccessRate
 * @description Quantos campos não-nulos foram extraídos.
 * Útil para UI mostrar "X de Y campos importados".
 */
export function crlvSuccessRate(fields: CRLVFields): { found: number; total: number } {
  const total = Object.keys(fields).length
  const found = Object.values(fields).filter((v) => v !== null && v !== '').length
  return { found, total }
}
