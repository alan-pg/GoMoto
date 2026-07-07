export interface TemplateVariable {
  key: string
  label: string
  category: string
  sample: string
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  // Cliente
  { key: 'nome_cliente',      label: 'Nome completo',              category: 'Cliente',    sample: 'João Silva Santos' },
  { key: 'cpf_cliente',       label: 'CPF',                        category: 'Cliente',    sample: '123.456.789-00' },
  { key: 'rg_cliente',        label: 'RG + órgão emissor',         category: 'Cliente',    sample: '12.488.178 DETRAN RJ' },
  { key: 'cnh_cliente',       label: 'Número da habilitação',      category: 'Cliente',    sample: '00123456789' },
  { key: 'categoria_cnh',     label: 'Categoria CNH',              category: 'Cliente',    sample: 'AB' },
  { key: 'endereco_cliente',  label: 'Endereço completo',          category: 'Cliente',    sample: 'Rua das Flores, 123, Bairro Centro, Rio de Janeiro — RJ, 20040-020' },
  { key: 'cep_cliente',       label: 'CEP',                        category: 'Cliente',    sample: '20040-020' },
  // Motocicleta
  { key: 'marca_moto',        label: 'Marca',                      category: 'Moto',       sample: 'HONDA' },
  { key: 'modelo_moto',       label: 'Marca + Modelo',             category: 'Moto',       sample: 'HONDA CG 160 START' },
  { key: 'ano_fabricacao_moto', label: 'Ano de fabricação',        category: 'Moto',       sample: '2024' },
  { key: 'ano_modelo_moto',   label: 'Ano do modelo',              category: 'Moto',       sample: '2025' },
  { key: 'ano_fab_mod_moto',  label: 'Fabricação/Modelo (ex: 2024/2025)', category: 'Moto', sample: '2024/2025' },
  { key: 'renavam_moto',      label: 'RENAVAM',                    category: 'Moto',       sample: '00123456789' },
  { key: 'placa_moto',        label: 'Placa',                      category: 'Moto',       sample: 'ABC-1D23' },
  { key: 'chassi_moto',       label: 'Chassi',                     category: 'Moto',       sample: '9C2JC4110SR500001' },
  { key: 'cor_moto',          label: 'Cor',                        category: 'Moto',       sample: 'Vermelho' },
  { key: 'combustivel_moto',  label: 'Combustível',                category: 'Moto',       sample: 'Flex' },
  { key: 'km_inicial',        label: 'KM no início do contrato',   category: 'Moto',       sample: '12.540' },
  // Financeiro e datas
  { key: 'valor_semanal',     label: 'Valor semanal por extenso',  category: 'Financeiro', sample: '350,00 (trezentos e cinquenta reais)' },
  { key: 'data_inicio',       label: 'Data de início por extenso', category: 'Datas',      sample: '1 de julho de 2026' },
  { key: 'data_hoje',         label: 'Data atual por extenso',     category: 'Datas',      sample: '6 de julho de 2026' },
  // Empresa
  { key: 'nome_empresa',      label: 'Nome da empresa',            category: 'Empresa',    sample: 'GoMoto Locações LTDA' },
]

export const VARIABLE_CATEGORIES = [
  'Cliente',
  'Moto',
  'Financeiro',
  'Datas',
  'Empresa',
] as const

export function buildSampleData(): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARIABLES.map(v => [v.key, v.sample]))
}

export function substituteVariables(html: string, data: Record<string, string>): string {
  return html.replace(/\{\{([\w_]+)\}\}/g, (match, key) => data[key] ?? match)
}
