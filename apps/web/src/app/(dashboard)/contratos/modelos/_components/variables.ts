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
  // Veículo
  { key: 'marca_veiculo',        label: 'Marca',                      category: 'Veículo',       sample: 'HONDA' },
  { key: 'modelo_veiculo',       label: 'Marca + Modelo',             category: 'Veículo',       sample: 'HONDA CG 160 START' },
  { key: 'ano_fabricacao_veiculo', label: 'Ano de fabricação',        category: 'Veículo',       sample: '2024' },
  { key: 'ano_modelo_veiculo',   label: 'Ano do modelo',              category: 'Veículo',       sample: '2025' },
  { key: 'ano_fab_mod_veiculo',  label: 'Fabricação/Modelo (ex: 2024/2025)', category: 'Veículo', sample: '2024/2025' },
  { key: 'renavam_veiculo',      label: 'RENAVAM',                    category: 'Veículo',       sample: '00123456789' },
  { key: 'placa_veiculo',        label: 'Placa',                      category: 'Veículo',       sample: 'ABC-1D23' },
  { key: 'chassi_veiculo',       label: 'Chassi',                     category: 'Veículo',       sample: '9C2JC4110SR500001' },
  { key: 'cor_veiculo',          label: 'Cor',                        category: 'Veículo',       sample: 'Vermelho' },
  { key: 'combustivel_veiculo',  label: 'Combustível',                category: 'Veículo',       sample: 'Flex' },
  { key: 'km_inicial',        label: 'KM no início do contrato',   category: 'Veículo',       sample: '12.540' },
  // Financeiro e datas
  { key: 'valor_semanal',     label: 'Valor semanal por extenso',  category: 'Financeiro', sample: '350,00 (trezentos e cinquenta reais)' },
  { key: 'data_inicio',       label: 'Data de início por extenso', category: 'Datas',      sample: '1 de julho de 2026' },
  { key: 'data_hoje',         label: 'Data atual por extenso',     category: 'Datas',      sample: '6 de julho de 2026' },
  // Empresa
  { key: 'nome_empresa',      label: 'Nome da empresa',            category: 'Empresa',    sample: 'GoMoto Locações LTDA' },
]

export const VARIABLE_CATEGORIES = [
  'Cliente',
  'Veículo',
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
