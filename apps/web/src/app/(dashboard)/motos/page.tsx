/**
 * @file src/app/(dashboard)/motos/page.tsx
 * @description Página de gestão de frota do sistema GoMoto.
 * 
 * @summary
 * Esta página é o centro de controle dos ativos físicos da empresa (as motocicletas).
 * O "porquê" desta página é fornecer uma visão completa e controle total sobre cada
 * veículo, desde seu cadastro inicial até seu status operacional diário.
 * 
 * @funcionalidades
 * 1.  **Visualização da Frota**: Exibe todas as motocicletas cadastradas em um formato de grade (cards).
 * 2.  **Filtros Rápidos**: Permite filtrar a frota por status (Disponível, Alugada, Manutenção).
 * 3.  **Busca Detalhada**: Oferece pesquisa por placa, modelo ou marca.
 * 4.  **Cadastro Guiado (Wizard)**: Um fluxo de 2 passos para registrar novas motos, garantindo
 *     que dados técnicos e de manutenção inicial sejam coletados corretamente.
 * 5.  **Edição e Detalhes**: Permite editar informações e visualizar uma ficha técnica completa de cada veículo.
 * 
 * @arquitetura
 * - **Client Component**: A página é interativa, usando estado do React para filtros, modais e formulários.
 * - **Integração Real com Supabase**: Consome a tabela `motos` real do banco PostgreSQL via cliente Supabase.
 * - **Componentização**: A ficha técnica e os cards são componentizados para reutilização e clareza.
 * - **Cores Semânticas**: O status de cada moto é refletido visualmente na borda do card,
 *   permitindo uma identificação rápida do estado operacional da frota.
 */

'use client' // Diretiva para indicar que este é um Client Component (interatividade React)

// Importação de hooks do React para gerenciamento de estado local e efeitos colaterais
import { useState, useMemo } from 'react'
// Importação dinâmica para componentes que não suportam SSR (como mapas com Leaflet)
import dynamic from 'next/dynamic'
import Link from 'next/link'
// Importação de ícones da biblioteca Lucide para auxílio visual na interface
import {
  Plus,          // Ícone de adição para novo cadastro
  Edit2,         // Ícone de lápis para edição
  Trash2,        // Ícone de lixeira para exclusão
  Eye,           // Ícone de olho para visualização de detalhes
  Bike,          // Ícone representativo de motocicleta
  CheckCircle,   // Ícone de sucesso (manutenção em dia)
  AlertCircle,   // Ícone de alerta (revisão pendente)
  Search,        // Ícone de lupa para o campo de busca
  MapPin,        // Ícone de localização para o mapa
  User,          // Ícone de usuário para o cliente
  Upload,        // Ícone de upload para importar CRLV (PDF)
} from 'lucide-react'

// Importação de componentes de layout e UI personalizados do projeto
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

// Importação de hooks compartilhados e contexto Supabase (multi-tenant) do @gomoto/data
import {
  useMotorcycles,
  useActiveContracts,
  useCreateMotorcycle,
  useUpdateMotorcycle,
  useDeleteMotorcycle,
  useSupabaseContext,
  useRequiredTenantId,
  useMaintenancePlans,
  useMaintenancePlan,
} from '@gomoto/data'

// Importação de funções utilitárias
import { formatCurrency } from '@/lib/utils'

// Importação de definições de tipos TypeScript globais
import type { Motorcycle, MotorcycleStatus, Contract, Customer, MaintenancePlanItem } from '@gomoto/core'
import { parseCRLVText, crlvSuccessRate } from '@gomoto/core'

/**
 * Importação dinâmica do mapa Leaflet sem SSR.
 * O "porquê": Leaflet depende do objeto `window` do browser, que não existe no servidor.
 */
const DynamicMotorcycleMap = dynamic(() => import('@/components/MotorcycleMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#181818]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
            <p className="text-[12px] text-[#9e9e9e]">Carregando mapa...</p>
      </div>
    </div>
  ),
})

/** Tipo de contrato com customer embutido via join */
type ContractWithCustomer = Contract & { customer?: Customer }

/**
 * @constant filterOptions
 * @description Define os botões de filtro rápido acima da listagem.
 */
// Filtros padrão excluem Vendido e Desativado (RF-003)
const filterOptions = [
  { label: 'Ativas',        value: 'active' },   // virtual: available+rented+reserved+maintenance+sinister
  { label: 'Disponíveis',   value: 'available' },
  { label: 'Alugadas',      value: 'rented' },
  { label: 'Reservadas',    value: 'reserved' },
  { label: 'Manutenção',    value: 'maintenance' },
  { label: 'Sinistradas',   value: 'sinister' },
  { label: 'Vendidas',      value: 'sold' },
  { label: 'Desativadas',   value: 'inactive' },
  { label: 'Todas',         value: 'all' },
]

const ACTIVE_STATUSES = ['available', 'rented', 'reserved', 'maintenance', 'sinister']

/**
 * @constant statusOptions
 * @description Opções para o campo Select do formulário de cadastro (wizard).
 */
const statusOptions = [
  { value: 'available',   label: 'Disponível' },
  { value: 'reserved',    label: 'Reservado' },
  { value: 'maintenance', label: 'Em Manutenção' },
  { value: 'sinister',    label: 'Sinistrado' },
]

/**
 * @constant fuelOptions
 * @description Tipos de combustíveis suportados pelo sistema.
 */
const fuelOptions = [
  { value: 'GASOLINA', label: 'Gasolina' },
  { value: 'ÁLCOOL/GASOLINA', label: 'Álcool/Gasolina (Flex)' },
  { value: 'ELÉTRICO', label: 'Elétrico' },
]

/**
 * @constant acquisitionTypeOptions
 * @description Como a empresa adquiriu o veículo (PRD 0002).
 * `zero_km` esconde os campos de dono anterior no Passo 2 (D5).
 */
const acquisitionTypeOptions = [
  { value: 'zero_km',     label: 'Zero KM' },
  { value: 'used',        label: 'Compra (usada)' },
  { value: 'settled',     label: 'Quitada' },
  { value: 'financed',    label: 'Financiada' },
  { value: 'consignment', label: 'Consignação' },
  { value: 'donation',    label: 'Doação' },
  { value: 'other',       label: 'Outro' },
]

const ownerTypeOptions = [
  { value: 'cpf',  label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
]

const obligationStatusOptions = [
  { value: 'pending', label: 'Pendente' },
  { value: 'paid',    label: 'Pago' },
  { value: 'exempt',  label: 'Isento' },
]

const ownershipTransferredOptions = [
  { value: 'false', label: 'Ainda em nome do vendedor' },
  { value: 'true',  label: 'Transferida para a empresa' },
]

/**
 * Decide se o item do plano é "por km" ou "por data" para fins de UI e cálculo
 * do agendamento bootstrap. Preferência: `interval_km` quando presente. CHECK
 * no banco garante que pelo menos um dos dois está definido.
 */
function planItemMetric(item: MaintenancePlanItem): 'km' | 'date' {
  return item.interval_km != null ? 'km' : 'date'
}

/**
 * Frase curta com a periodicidade do item, mostrada abaixo do nome no Passo 3.
 */
function planItemHint(item: MaintenancePlanItem): string {
  if (item.interval_km != null) return `a cada ${item.interval_km.toLocaleString('pt-BR')} km`
  if (item.interval_days != null) return `a cada ${item.interval_days} dia${item.interval_days === 1 ? '' : 's'}`
  return ''
}

/**
 * @constant defaultFormState
 * @description Define os valores padrão para o formulário de criação de moto.
 * O "porquê": Garante que todos os campos controlados do formulário tenham um valor inicial
 * definido, evitando erros de "uncontrolled to controlled component" no React.
 */
const defaultFormState = {
  licensePlate: '',         // Placa do veículo
  model: '',                // Modelo (Ex: Titan 160)
  make: '',                 // Marca (Ex: Honda)
  yearManufacture: '',      // Ano de fabricação (Ex: 2024)
  yearModel: '',            // Ano do modelo (Ex: 2025)
  color: '',                // Cor (Ex: Azul)
  renavam: '',              // Código RENAVAM
  chassis: '',              // Número do Chassi
  fuel: 'GASOLINA',         // Combustível padrão
  engineCapacity: '',       // CC/Potência
  previousOwnerName: '',    // Nome do vendedor anterior
  previousOwnerDocument: '',// CPF do vendedor anterior
  purchaseDate: '',         // Data de aquisição
  fipeValue: '',            // Valor de mercado FIPE (referência)
  currentKm: '',            // Quilometragem atual de entrada
  maintenanceUpToDate: 'true', // Status de manutenção inicial
  status: 'available',      // Status operacional inicial
  observations: '',         // Observações de vistoria de entrada
  // PRD 0002 — aquisição
  acquisitionType: 'used' as 'zero_km' | 'used' | 'settled' | 'financed' | 'consignment' | 'donation' | 'other',
  acquisitionAmount: '',    // Valor pago pela empresa (≠ FIPE)
  // PRD 0002 — identidade documental atual (CRV/CRLV vigente)
  registeredOwnerName: '',
  registeredOwnerDocument: '',
  registeredOwnerType: 'cnpj' as 'cpf' | 'cnpj',
  registrationState: '',    // UF (texto livre, D7)
  ownershipTransferred: 'false' as 'true' | 'false',
  ownershipTransferDate: '',
  // PRD 0002 — CRV no Passo 2 (vira vehicle_documents)
  crvNumber: '',
  crvExerciseYear: '',
}

/**
 * @constant defaultObligationsState
 * @description Bloco "Documentação anual" do Passo 2 (opcional).
 * Cada linha vira 1 INSERT em vehicle_obligations se `amount` for preenchido.
 */
const defaultObligationsState = {
  ipva:      { amount: '', dueDate: '', status: 'pending' as 'pending' | 'paid' | 'exempt' },
  licensing: { amount: '', dueDate: '', status: 'pending' as 'pending' | 'paid' | 'exempt' },
  dpvat:     { amount: '', dueDate: '', status: 'exempt'  as 'pending' | 'paid' | 'exempt' },
}

/**
 * @constant statusColorMap
 * @description Associa cada status de moto a uma cor hex pura para o ponto indicador na tabela.
 */
const statusColorMap: Record<string, string> = {
  available:   '#28b438',
  rented:      '#a880ff',
  reserved:    '#818cf8',
  maintenance: '#e65e24',
  sinister:    '#f87171',
  sold:        '#9e9e9e',
  inactive:    '#474747',
}

/**
 * Mapeia o combustível extraído do CRLV para uma das opções do select.
 * O CRLV usa "GASOLINA", "FLEX", "ÁLCOOL", "ETANOL", "DIESEL", "ELÉTRICO".
 * Nosso select tem 3 opções; tudo que não casa vira null → mantém o valor anterior.
 */
function mapCombustivelToFuel(combustivel: string | null | undefined): string | null {
  if (!combustivel) return null
  const upper = combustivel.toUpperCase()
  if (upper.includes('ELÉTR') || upper.includes('ELETR')) return 'ELÉTRICO'
  if (upper.includes('FLEX') || upper.includes('ÁLCOOL') || upper.includes('ALCOOL') || upper.includes('ETANOL')) {
    return 'ÁLCOOL/GASOLINA'
  }
  if (upper.includes('GASOLINA')) return 'GASOLINA'
  return null
}

/**
 * Detecta se o documento do proprietário é CPF (11 dígitos) ou CNPJ (14 dígitos).
 * Aceita formatado ou só dígitos.
 */
function detectOwnerType(doc: string | null | undefined): 'cpf' | 'cnpj' | null {
  if (!doc) return null
  const digits = doc.replace(/\D/g, '')
  if (digits.length === 11) return 'cpf'
  if (digits.length === 14) return 'cnpj'
  return null
}

/**
 * @function motorcycleToForm
 * @description Converte um objeto Moto (formato do banco) para o formato esperado pelo formulário (Strings).
 * O "porquê": Essencial para popular os campos durante a edição de um registro existente,
 * adaptando os tipos de dados (ex: number para string) para os inputs HTML.
 */
/**
 * @function describeMotorcycleError
 * @description Traduz erros do Supabase em mensagens claras para o usuário.
 * O Supabase joga `PostgrestError` cru ({ code, message, details, hint }),
 * que não é instance de Error e cujo `.message` em inglês raramente ajuda
 * o operador. Mapeamos os códigos mais comuns no fluxo de cadastro de moto.
 */
function describeMotorcycleError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' ? err : 'Erro desconhecido.'
  }
  const e = err as { code?: string; message?: string; details?: string }

  // 23505 = unique_violation. Inferimos a coluna pela mensagem/detalhes.
  // license_plate, renavam e chassis são UNIQUE por (tenant_id, ·) — então a
  // duplicação é sempre dentro da empresa atual.
  if (e.code === '23505') {
    const blob = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase()
    if (blob.includes('license_plate')) {
      return 'Já existe uma moto cadastrada com essa placa nesta empresa.'
    }
    if (blob.includes('renavam')) {
      return 'Já existe uma moto cadastrada com esse RENAVAM nesta empresa.'
    }
    if (blob.includes('chassis')) {
      return 'Já existe uma moto cadastrada com esse chassi nesta empresa.'
    }
    return 'Já existe um registro com esses dados (campo duplicado).'
  }
  if (e.code === '23502') {
    return `Campo obrigatório não preenchido${e.message ? `: ${e.message}` : '.'}`
  }
  if (e.code === '23503') return 'Referência inválida — algum campo aponta para um registro inexistente.'
  if (e.code === '23514') return 'Valor fora do permitido em algum dos campos.'
  if (e.code === 'PGRST204') return e.message ?? 'Estrutura do banco fora de sincronia. Avise o time técnico.'

  return e.message ?? 'Erro desconhecido.'
}

function motorcycleToForm(motorcycle: Motorcycle): typeof defaultFormState {
  return {
    licensePlate: motorcycle.license_plate,
    model: motorcycle.model,
    make: motorcycle.make,
    yearManufacture: motorcycle.year_manufacture,
    yearModel: motorcycle.year_model ?? '',
    color: motorcycle.color,
    renavam: motorcycle.renavam,
    chassis: motorcycle.chassis,
    fuel: motorcycle.fuel ?? 'GASOLINA',
    engineCapacity: motorcycle.engine_capacity ?? '',
    previousOwnerName: motorcycle.previous_owner ?? '',
    previousOwnerDocument: motorcycle.previous_owner_cpf ?? '',
    purchaseDate: motorcycle.purchase_date ?? '',
    fipeValue: motorcycle.fipe_value ? String(motorcycle.fipe_value) : '',
    currentKm: '', // KM atual não vem do objeto moto base (geralmente vem de logs de manutenção)
    maintenanceUpToDate: motorcycle.maintenance_up_to_date !== false ? 'true' : 'false',
    status: motorcycle.status,
    observations: motorcycle.observations ?? '',
    // PRD 0002
    acquisitionType: (motorcycle.acquisition_type ?? 'used') as typeof defaultFormState.acquisitionType,
    acquisitionAmount: motorcycle.acquisition_amount ? String(motorcycle.acquisition_amount) : '',
    registeredOwnerName: motorcycle.registered_owner_name ?? '',
    registeredOwnerDocument: motorcycle.registered_owner_document ?? '',
    registeredOwnerType: (motorcycle.registered_owner_type ?? 'cnpj') as typeof defaultFormState.registeredOwnerType,
    registrationState: motorcycle.registration_state ?? '',
    ownershipTransferred: motorcycle.ownership_transferred ? ('true' as const) : ('false' as const),
    ownershipTransferDate: motorcycle.ownership_transfer_date ?? '',
    crvNumber: '',
    crvExerciseYear: '',
  }
}

/**
 * @component MotorcyclesPage
 * @description Gerencia toda a lógica e renderização da tela de frota.
 */
export default function MotorcyclesPage() {
  /*
   * GERENCIAMENTO DE ESTADOS (React State):
   * Leitura via hooks de @gomoto/data (TanStack Query gerencia cache + invalidação).
   */
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const motorcyclesQuery = useMotorcycles()
  const contractsQuery = useActiveContracts()
  const createMotorcycleMutation = useCreateMotorcycle()
  const updateMotorcycleMutation = useUpdateMotorcycle()
  const deleteMotorcycleMutation = useDeleteMotorcycle()
  // PRD 0003 F2.3 — planos de manutenção para o Passo 3 do wizard.
  const maintenancePlansQuery = useMaintenancePlans()
  const maintenancePlans = (maintenancePlansQuery.data ?? []).filter((p) => !p.archived_at)

  const motorcycles = (motorcyclesQuery.data ?? []) as Motorcycle[]
  const contracts = (contractsQuery.data ?? []) as ContractWithCustomer[]
  const loading = motorcyclesQuery.isLoading
  const fetchError = motorcyclesQuery.error
    ? 'Não foi possível carregar a frota. Verifique a conexão e tente novamente.'
    : null
  const saving =
    createMotorcycleMutation.isPending ||
    updateMotorcycleMutation.isPending ||
    deleteMotorcycleMutation.isPending
  // Filtro padrão 'active' oculta Vendido e Desativado (RF-003)
  const [filter, setFilter] = useState('active')
  // Texto digitado no campo de busca para filtragem dinâmica.
  const [search, setSearch] = useState('')
  // Controla se o modal de formulário está visível.
  const [modalOpen, setModalOpen] = useState(false)
  // Armazena o ID da moto sendo editada. Se for `null`, o modal funciona como "Novo Cadastro".
  const [editingId, setEditingId] = useState<string | null>(null)
  // Objeto contendo os dados atuais digitados no formulário do modal.
  const [form, setForm] = useState(defaultFormState)
  // Objeto da moto selecionada para visualização detalhada no modal de leitura.
  const [motorcycleDetails, setMotorcycleDetails] = useState<Motorcycle | null>(null)
  // Objeto da moto marcada para exclusão definitiva.
  const [deletingMotorcycle, setDeletingMotorcycle] = useState<Motorcycle | null>(null)
  // Passo atual do Wizard de cadastro (PRD 0002):
  //   1 = Identificação técnica
  //   2 = Documentação e aquisição (CRV + obrigações anuais)
  //   3 = Bootstrap de manutenção preventiva
  const [step, setStep] = useState<1 | 2 | 3>(1)
  // ID da moto selecionada na tabela para centralizar no mapa.
  const [selectedMotoId, setSelectedMotoId] = useState<string | null>(null)
  // Mapa de valores (KM ou Data) informados no Passo 3 do cadastro.
  const [bootstrapItems, setBootstrapItems] = useState<Record<string, string>>({})
  // PRD 0003 F2.3 — plano de manutenção selecionado no Passo 3.
  // Pré-selecionado no openNewMotorcycle quando há plano default.
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  // Carrega os itens do plano selecionado (consumido pelo Passo 3 e pelo submit).
  const selectedPlanQuery = useMaintenancePlan(selectedPlanId || undefined)
  const selectedPlanItems = (selectedPlanQuery.data?.items ?? []) as MaintenancePlanItem[]
  // Estado do bloco "Documentação anual" do Passo 2.
  const [obligationsForm, setObligationsForm] = useState(defaultObligationsState)
  // Anexo do CRV (Passo 2). Vai para storage.vehicle-documents no submit.
  const [crvFile, setCrvFile] = useState<File | null>(null)
  // Estado do botão "Importar CRLV (PDF)" do Passo 1.
  const [crlvImporting, setCrlvImporting] = useState(false)
  // Feedback inline do import: nº de campos aplicados ou mensagem de erro.
  const [crlvImportMessage, setCrlvImportMessage] = useState<
    | { kind: 'success'; found: number; total: number; fileName: string }
    | { kind: 'error'; text: string }
    | null
  >(null)
  // Erro do submit final do wizard — exibido no Passo 3 sem fechar o modal,
  // para o usuário ler o motivo e tentar de novo sem perder o que digitou.
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Avisos pós-cadastro: a moto foi criada com sucesso, mas algum bloco
  // opcional (upload do CRV, obrigações, bootstrap de manutenção) falhou.
  // Exibido como banner dismissível no topo da página.
  const [postSubmitNotice, setPostSubmitNotice] = useState<string[] | null>(null)

  /**
   * @const contractByMotoId
   * @description Dicionário de lookup: motorcycle_id → contrato ativo com cliente.
   *
   * Por que useMemo + objeto (Map) em vez de Array.find() no render:
   * - Array.find() dentro de um map() = O(N²) — cada linha da tabela percorre todos os contratos
   * - Objeto como hash map = O(1) por lookup — independente do tamanho da frota
   * - useMemo garante que o objeto só é recriado quando `contracts` muda de fato
   */
  const contractByMotoId = useMemo(
    () => contracts.reduce<Record<string, ContractWithCustomer>>(
      (acc, c) => { acc[c.motorcycle_id] = c; return acc },
      {}
    ),
    [contracts]
  )

  // PRD 0003 F2 — contagem de motos sem plano de manutenção atribuído.
  // Usado pelo banner discreto no topo da página e pelo badge "Sem plano" na linha.
  const motorcyclesWithoutPlanCount = useMemo(
    () => motorcycles.filter((m) => !m.maintenance_plan_id).length,
    [motorcycles]
  )

  /**
   * @const filteredMotorcycles
   * @description Filtra a lista de motos em tempo real com base no status e busca.
   * O "porquê" de ser um useMemo: recalcula apenas quando motorcycles, filter ou search mudam,
   * evitando reprocessar toda a lista a cada render causado por outros estados (ex: modal aberto).
   */
  const filteredMotorcycles = useMemo(
    () => motorcycles.filter((m) => {
      let passesFilter: boolean
      if (filter === 'all') {
        passesFilter = true
      } else if (filter === 'active') {
        passesFilter = ACTIVE_STATUSES.includes(m.status)
      } else {
        passesFilter = m.status === filter
      }
      const passesSearch = !search || [m.license_plate, m.model, m.make, m.color].some(
        (v) => v?.toLowerCase().includes(search.toLowerCase())
      )
      return passesFilter && passesSearch
    }),
    [motorcycles, filter, search]
  )

  /**
   * @function openNewMotorcycle
   * @description Prepara o estado para abrir o modal de criação de um novo veículo.
   */
  function openNewMotorcycle() {
    setEditingId(null)           // Modo: Criação
    setForm(defaultFormState)    // Limpa os campos
    setBootstrapItems({})        // Limpa manutenções
    setObligationsForm(defaultObligationsState)
    setCrvFile(null)
    setCrlvImportMessage(null)
    setSubmitError(null)
    // Pré-seleciona o plano default (se existir) — tenant geralmente tem 1 só.
    const defaultPlan = maintenancePlans.find((p) => p.is_default) ?? maintenancePlans[0]
    setSelectedPlanId(defaultPlan?.id ?? '')
    setStep(1)                   // Volta ao passo 1
    setModalOpen(true)           // Abre o modal
  }

  /**
   * @function closeModal
   * @description Reseta os estados auxiliares e fecha o modal.
   */
  function closeModal() {
    setModalOpen(false)
    setStep(1)
    setBootstrapItems({})
    setObligationsForm(defaultObligationsState)
    setCrvFile(null)
    setCrlvImportMessage(null)
    setSubmitError(null)
    setSelectedPlanId('')
  }

  /**
   * @function openEditMotorcycle
   * @description Prepara o estado para abrir o modal de edição de um veículo existente.
   */
  function openEditMotorcycle(motorcycle: Motorcycle) {
    setEditingId(motorcycle.id)                  // Modo: Edição
    setForm(motorcycleToForm(motorcycle))        // Popula com dados atuais
    setModalOpen(true)                           // Abre o modal
  }

  async function handleCrlvImport(file: File) {
    setCrlvImporting(true)
    setCrlvImportMessage(null)

    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'

      const buffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise

      let rawText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        for (const item of content.items) {
          if (!('str' in item)) continue
          rawText += item.str + (item.hasEOL ? '\n' : ' ')
        }
        rawText += '\n'
      }

      const fields = parseCRLVText(rawText)
      const stats = crlvSuccessRate(fields)

      setForm((prev) => ({
        ...prev,
        licensePlate: fields.placa ?? prev.licensePlate,
        renavam: fields.renavam ?? prev.renavam,
        make: fields.marca ?? prev.make,
        model: [fields.modelo, fields.versao].filter(Boolean).join(' ') || prev.model,
        yearManufacture: fields.anoFabricacao ?? prev.yearManufacture,
        yearModel: fields.anoModelo ?? prev.yearModel,
        color: fields.cor ?? prev.color,
        chassis: fields.chassi ?? prev.chassis,
        engineCapacity: fields.cilindrada ?? prev.engineCapacity,
        fuel: mapCombustivelToFuel(fields.combustivel) ?? prev.fuel,
        registeredOwnerName: fields.proprietario ?? prev.registeredOwnerName,
        registeredOwnerDocument: fields.cpfCnpj ?? prev.registeredOwnerDocument,
        registeredOwnerType: detectOwnerType(fields.cpfCnpj) ?? prev.registeredOwnerType,
        registrationState: fields.uf ?? prev.registrationState,
        crvNumber: fields.numeroCrv ?? prev.crvNumber,
        crvExerciseYear: fields.exercicio ?? prev.crvExerciseYear,
      }))

      setCrvFile(file)

      setCrlvImportMessage({ kind: 'success', found: stats.found, total: stats.total, fileName: file.name })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro desconhecido'
      setCrlvImportMessage({ kind: 'error', text: `Erro ao processar o PDF: ${message}` })
    } finally {
      setCrlvImporting(false)
    }
  }

  /**
   * @function handleStep1
   * @description Processa a submissão do passo 1. Se for edição, finaliza. Se for criação, avança.
   */
  function handleStep1(e: React.FormEvent) {
    e.preventDefault() // Evita recarregamento da página
    if (editingId) {
      handleSubmitFinal() // Edição salva direto com os dados do form completo
    } else {
      setStep(2) // Avança para Documentação + Aquisição
    }
  }

  /**
   * @function handleStep2
   * @description Valida o Passo 2 (documentação/aquisição) e avança para o
   * Passo 3 (bootstrap manutenção). Todos os campos do Passo 2 são opcionais,
   * mas se `acquisitionType !== 'zero_km'` esperamos pelo menos o nome do
   * vendedor — caso contrário o operador pode pular.
   */
  function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    setStep(3)
  }

  /**
   * @function handleSubmitFinal
   * @description Consolida os dados do formulário e salva via hooks de @gomoto/data.
   * O `tenant_id` é injetado automaticamente pelos hooks de mutação.
   */
  async function handleSubmitFinal() {
    /**
     * Sanitização robusta do valor FIPE:
     * Remove separadores de milhar (pontos) antes de converter a vírgula decimal,
     * evitando NaN em entradas como "15.500,00" → correto: 15500.00.
     */
    const parsedFipeValue = form.fipeValue
      ? parseFloat(form.fipeValue.replace(/\./g, '').replace(',', '.'))
      : null
    const parsedAcquisitionAmount = form.acquisitionAmount
      ? parseFloat(form.acquisitionAmount.replace(/\./g, '').replace(',', '.'))
      : null

    const motorcycleData = {
      license_plate: form.licensePlate.toUpperCase(),
      model: form.model,
      make: form.make.toUpperCase(),
      year_manufacture: form.yearManufacture,
      year_model: form.yearModel || undefined,
      color: form.color.toUpperCase(),
      renavam: form.renavam,
      chassis: form.chassis.toUpperCase(),
      fuel: form.fuel,
      engine_capacity: form.engineCapacity || undefined,
      previous_owner: form.previousOwnerName || undefined,
      previous_owner_cpf: form.previousOwnerDocument || undefined,
      purchase_date: form.purchaseDate || undefined,
      fipe_value: isNaN(parsedFipeValue as number) ? undefined : parsedFipeValue ?? undefined,
      maintenance_up_to_date: form.maintenanceUpToDate === 'true',
      status: form.status as MotorcycleStatus,
      observations: form.observations || undefined,
      // PRD 0002 — aquisição e identidade documental
      acquisition_type: form.acquisitionType,
      acquisition_amount: isNaN(parsedAcquisitionAmount as number) ? undefined : parsedAcquisitionAmount ?? undefined,
      registered_owner_name: form.registeredOwnerName || undefined,
      registered_owner_document: form.registeredOwnerDocument || undefined,
      registered_owner_type: form.registeredOwnerDocument ? form.registeredOwnerType : undefined,
      registration_state: form.registrationState || undefined,
      ownership_transferred: form.ownershipTransferred === 'true',
      ownership_transfer_date: form.ownershipTransferDate || undefined,
      // PRD 0003 F2.3 — plano de manutenção atribuído (Passo 3).
      // Pode ficar undefined se o tenant não tem plano cadastrado ainda.
      maintenance_plan_id: selectedPlanId || undefined,
    }

    setSubmitError(null)
    const warnings: string[] = []

    // ───────────────────────────────────────────────────────────────
    // ETAPA PRINCIPAL: criar/atualizar a moto.
    // Se isso falhar, NÃO fechamos o modal — usuário vê o erro inline
    // e tenta de novo sem perder o que digitou.
    // ───────────────────────────────────────────────────────────────
    let newMotoId: string | null = null
    try {
      if (editingId) {
        /**
         * EDIÇÃO: não inclui km_current — currentKm é zerado ao abrir o modal de edição,
         * então salvar km_current: 0 causaria regressão de quilometragem.
         */
        await updateMotorcycleMutation.mutateAsync({ id: editingId, payload: motorcycleData })
      } else {
        const newMoto = await createMotorcycleMutation.mutateAsync({
          ...motorcycleData,
          km_current: form.currentKm ? parseInt(form.currentKm, 10) : 0,
        })
        newMotoId = newMoto.id
      }
    } catch (err) {
      setSubmitError(describeMotorcycleError(err))
      return // mantém o modal aberto para o usuário corrigir
    }

    // Edição não tem bootstrap nem anexos — encerra aqui.
    if (editingId || !newMotoId) {
      closeModal()
      return
    }

    // ───────────────────────────────────────────────────────────────
    // ETAPAS SECUNDÁRIAS (apenas no cadastro). Cada bloco falha de forma
    // isolada e vira um aviso pós-cadastro — a moto principal já existe,
    // então NÃO bloqueamos o usuário no modal.
    // ───────────────────────────────────────────────────────────────
    const currentKm = form.currentKm ? parseInt(form.currentKm, 10) : 0
    const today = new Date().toISOString().split('T')[0]
    const tenantId = getTenantId()

    // ─── upload do CRV + insert em vehicle_documents ───
    let crvFileUrl: string | null = null
    if (crvFile) {
      const ext = crvFile.name.split('.').pop()?.toLowerCase() || 'pdf'
      const path = `${tenantId}/${newMotoId}/crv-${Date.now()}.${ext}`
      try {
        const { error: uploadError } = await supabase
          .storage
          .from('vehicle-documents')
          .upload(path, crvFile, { upsert: false, contentType: crvFile.type })
        if (uploadError) {
          warnings.push(`Anexo do CRV não foi salvo: ${uploadError.message}`)
        } else {
          crvFileUrl = path
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'erro desconhecido'
        warnings.push(`Anexo do CRV não foi salvo: ${message}`)
      }
    }

    const hasCrvData =
      form.crvNumber || form.crvExerciseYear || form.registeredOwnerName || crvFileUrl
    if (hasCrvData) {
      const { error: crvError } = await supabase.from('vehicle_documents').insert({
        tenant_id: tenantId,
        motorcycle_id: newMotoId,
        type: 'crv',
        exercise_year: form.crvExerciseYear ? parseInt(form.crvExerciseYear, 10) : null,
        document_number: form.crvNumber || null,
        registered_owner_name: form.registeredOwnerName || null,
        registered_owner_document: form.registeredOwnerDocument || null,
        registered_owner_type: form.registeredOwnerDocument ? form.registeredOwnerType : null,
        file_url: crvFileUrl,
        is_current: true,
      })
      if (crvError) {
        warnings.push(`Registro do CRV não foi criado: ${crvError.message}`)
      }
    }

    // ─── inserts em vehicle_obligations (IPVA/Licenciamento/DPVAT) ───
    const obligationRows: Record<string, unknown>[] = []
    const fallbackYear = new Date().getFullYear()
    const isExempt = (s: 'pending' | 'paid' | 'exempt') => s === 'exempt'
    const obligationEntries: { key: 'ipva' | 'licensing' | 'dpvat'; type: 'ipva' | 'licensing' | 'dpvat' }[] = [
      { key: 'ipva',      type: 'ipva' },
      { key: 'licensing', type: 'licensing' },
      { key: 'dpvat',     type: 'dpvat' },
    ]
    for (const entry of obligationEntries) {
      const row = obligationsForm[entry.key]
      // Skip se nada útil foi informado (exempt + nenhum valor = nada para gravar).
      if (!row.amount && !row.dueDate && !isExempt(row.status)) continue
      // Sem dueDate e não isento: ainda assim grava se houver amount,
      // mas precisa de uma data — usa hoje como fallback (operador pode editar depois).
      const dueDate = row.dueDate || today
      const refYear = dueDate ? parseInt(dueDate.slice(0, 4), 10) : fallbackYear
      const parsedAmount = row.amount
        ? parseFloat(row.amount.replace(/\./g, '').replace(',', '.'))
        : 0
      obligationRows.push({
        tenant_id: tenantId,
        motorcycle_id: newMotoId,
        type: entry.type,
        reference_year: refYear,
        amount: isNaN(parsedAmount) ? 0 : parsedAmount,
        due_date: dueDate,
        status: row.status,
        paid_at: row.status === 'paid' ? dueDate : null,
      })
    }
    if (obligationRows.length > 0) {
      const { error: obligationsError } = await supabase
        .from('vehicle_obligations')
        .insert(obligationRows)
      if (obligationsError) {
        warnings.push(`Obrigações anuais não foram salvas: ${obligationsError.message}`)
      }
    }

    // ─── bootstrap de manutenção a partir dos itens do plano selecionado ───
    // PRD 0003 F2.3 — substituímos a lista hardcoded por itens do plano que o
    // operador escolheu. Tenant sem plano (selectedPlanItems vazio) gera 0
    // manutenções no bootstrap, mas a moto é criada normalmente.
    const maintenanceRecords: Record<string, unknown>[] = []
    for (const item of selectedPlanItems) {
      if (planItemMetric(item) === 'km' && item.interval_km != null) {
        const lastKm = bootstrapItems[item.id] ? parseInt(bootstrapItems[item.id], 10) : 0
        const nextDueKm = lastKm + item.interval_km
        maintenanceRecords.push({
          tenant_id: tenantId,
          motorcycle_id: newMotoId,
          type: 'preventive',
          description: item.name,
          predicted_km: nextDueKm,
          completed: false,
          observations: nextDueKm <= currentKm
            ? `Vencida — deveria ter sido feita aos ${nextDueKm.toLocaleString('pt-BR')} km`
            : lastKm === 0
              ? 'Sem histórico anterior — calculado a partir de 0 km na entrada da frota'
              : `Última realizada aos ${lastKm.toLocaleString('pt-BR')} km`,
        })
      } else if (item.interval_days != null) {
        const lastDateStr = bootstrapItems[item.id] || today
        const lastDate = new Date(lastDateStr + 'T12:00:00')
        const nextDueDate = new Date(lastDate)
        nextDueDate.setDate(nextDueDate.getDate() + item.interval_days)
        const nextDueDateStr = nextDueDate.toISOString().split('T')[0]
        maintenanceRecords.push({
          tenant_id: tenantId,
          motorcycle_id: newMotoId,
          type: 'inspection',
          description: item.name,
          scheduled_date: nextDueDateStr,
          completed: false,
          observations: `Última realizada em ${lastDateStr === today ? 'data não informada (assumido hoje)' : lastDateStr}`,
        })
      }
    }

    if (maintenanceRecords.length > 0) {
      const { error: maintenanceError } = await supabase
        .from('maintenances')
        .insert(maintenanceRecords)
      if (maintenanceError) {
        warnings.push(`Bootstrap de manutenção não foi salvo: ${maintenanceError.message}`)
      }
    }

    if (warnings.length > 0) setPostSubmitNotice(warnings)
    closeModal()
  }

  /**
   * @function confirmDeletion
   * @description Executa a remoção definitiva da moto via hook compartilhado.
   */
  async function confirmDeletion() {
    if (!deletingMotorcycle) return
    try {
      await deleteMotorcycleMutation.mutateAsync(deletingMotorcycle.id)
    } finally {
      setDeletingMotorcycle(null)
    }
  }

  // Renderização principal do componente
  return (
    <div className='min-h-screen bg-[#121212]'>
      <div className='sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-20 flex items-center gap-4'>
        <h1 className='text-[28px] font-bold text-[#f5f5f5]'>Motocicletas</h1>
        <span className='text-[13px] font-normal text-[#9e9e9e]'>{motorcycles.length} motos na frota</span>
        <div className='ml-auto flex gap-3'>
          <Button onClick={openNewMotorcycle}><Plus className='w-4 h-4' />Nova Moto</Button>
        </div>
      </div>

      <div className='px-6 py-4 space-y-4'>

        {/* BANNER DE ERRO — exibido quando a busca de dados falha (rede, Supabase, etc) */}
        {fetchError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ff9c9a] flex-shrink-0" />
            <p className="text-[13px] text-[#ff9c9a]">{fetchError}</p>
            {/* Botão de nova tentativa para o usuário não precisar recarregar a página */}
            <button onClick={() => motorcyclesQuery.refetch()} className="ml-auto text-[12px] text-[#BAFF1A] hover:underline font-medium">
              Tentar novamente
            </button>
          </div>
        )}

        {/* BANNER — motos sem plano de manutenção atribuído (PRD 0003 F2).
            Aparece só quando há pelo menos uma moto com maintenance_plan_id NULL.
            CTA leva para /planos-manutencao. */}
        {!loading && motorcyclesWithoutPlanCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[#2d2300] border border-[#ffd166] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ffd166] flex-shrink-0" />
            <p className="text-[13px] text-[#ffd166] flex-1">
              <strong>{motorcyclesWithoutPlanCount}</strong>{' '}
              {motorcyclesWithoutPlanCount === 1 ? 'moto está sem plano' : 'motos estão sem plano'} de manutenção atribuído — as previsões usam o legado até você atribuir.
            </p>
            <Link
              href="/planos-manutencao"
              className="text-[12px] text-[#ffd166] hover:underline font-medium whitespace-nowrap"
            >
              Gerenciar planos →
            </Link>
          </div>
        )}

        {/* BANNER DE AVISOS PÓS-CADASTRO — a moto foi criada mas algum bloco
            secundário (anexo CRV, obrigações, manutenções) falhou. Dismissível. */}
        {postSubmitNotice && postSubmitNotice.length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 bg-[#3a2f00] border border-[#ffd166] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ffd166] flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-[13px] text-[#ffd166] font-medium">
                Moto cadastrada, mas alguns itens não foram salvos:
              </p>
              <ul className="list-disc list-inside text-[12px] text-[#ffd166] space-y-0.5">
                {postSubmitNotice.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
            <button
              onClick={() => setPostSubmitNotice(null)}
              className="text-[12px] text-[#ffd166] hover:underline font-medium"
            >
              Fechar
            </button>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────
          * SEÇÃO: MAPA DA FROTA
          * Exibe as motos em posições geográficas (simuladas até integração GPS).
          * Futuramente: integração com rastreadores para posição em tempo real.
          * ────────────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[#323232] overflow-hidden" style={{ height: 460 }}>
          {loading ? (
            <div className="w-full h-full flex items-center justify-center bg-[#181818]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
                <p className="text-[12px] text-[#9e9e9e]">Carregando mapa da frota...</p>
              </div>
            </div>
          ) : (
            <DynamicMotorcycleMap
              items={motorcycles.map((m) => ({
                motorcycle: m,
                contract: contractByMotoId[m.id],
              }))}
              selectedMotoId={selectedMotoId}
              visibleMotoIds={filteredMotorcycles.map((m) => m.id)}
            />
          )}
        </div>

        {/* FILTROS E BUSCA — acima do grid */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap border-b border-[#616161]">
            {filterOptions.map((opt) => {
              const isActive = filter === opt.value
              const count = opt.value === 'all'
                ? motorcycles.length
                : opt.value === 'active'
                  ? motorcycles.filter((m) => ACTIVE_STATUSES.includes(m.status)).length
                  : motorcycles.filter((m) => m.status === opt.value).length
              return (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${isActive ? 'border-[#BAFF1A] text-[#f5f5f5]' : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'}`}
                >
                  {opt.label}
                  <span className="ml-1.5 text-[#616161]">({count})</span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616161]" />
            <input
              type="text"
              placeholder="Buscar placa, modelo, marca ou cor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='w-full h-10 pl-10 pr-4 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'
            />
          </div>
        </div>
      </div>

      <div className='px-6 pb-10'>
        <div className="overflow-hidden rounded-xl bg-[#202020]"><div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] text-[#f5f5f5]">
            <thead className="text-[#9e9e9e] border-b border-[#323232]">
              <tr>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e] w-10" />
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Placa</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Motocicleta</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Cliente</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Valor/Semana</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Status</th>
                <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><div className='flex items-center justify-center py-16'><div className='w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin' /></div></td></tr>
              ) : filteredMotorcycles.length === 0 ? (
                <tr><td colSpan={7}><div className='flex flex-col items-center justify-center py-16 gap-3 text-[#9e9e9e]'><div className='w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center'><Bike className='w-6 h-6 text-[#9e9e9e]' /></div><p className='text-[13px] text-[#9e9e9e]'>Nenhum veículo encontrado.</p><button onClick={() => { setFilter('active'); setSearch('') }} className='text-[13px] text-[#BAFF1A] hover:underline'>Limpar filtros</button></div></td></tr>
              ) : (
                filteredMotorcycles.map((moto) => {
                  const contract = contractByMotoId[moto.id]
                  const customer = contract?.customer
                  const weeklyValue = contract?.monthly_amount ? formatCurrency(contract.monthly_amount) : null
                  return (
                    <tr key={moto.id} onClick={() => setSelectedMotoId(moto.id === selectedMotoId ? null : moto.id)} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer">
                      {/* Foto principal (placeholder se ausente) */}
                      <td className="px-2">
                        {moto.photo_url ? (
                          <img src={moto.photo_url} alt="" className="w-7 h-7 rounded object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-[#323232] flex items-center justify-center">
                            <Bike className="w-3.5 h-3.5 text-[#616161]" />
                          </div>
                        )}
                      </td>
                      <td className="px-4"><div className='flex items-center gap-2'><div className='w-2 h-2 rounded-full flex-shrink-0' style={{ background: statusColorMap[moto.status] ?? '#9e9e9e' }} /><span className='font-mono font-bold text-[#f5f5f5]'>{moto.license_plate}</span></div></td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[#f5f5f5]">{moto.make} {moto.model}</p>
                          {!moto.maintenance_plan_id && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-[#ffd166] bg-[#3a2f00] border border-[#ffd166]/40"
                              title="Sem plano de manutenção atribuído"
                            >
                              Sem plano
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4">{customer ? (<div className="flex items-center gap-1.5"><User className="w-4 h-4 text-[#a880ff] flex-shrink-0" /><p className="font-medium text-[#f5f5f5] truncate">{customer.name}</p></div>) : (<p className="text-[#9e9e9e]">Sem locatário</p>)}</td>
                      <td className="px-4">{weeklyValue ? (<span className='text-[#BAFF1A] font-medium'>{weeklyValue}</span>) : (<span className='text-[#9e9e9e]'>—</span>)}</td>
                      <td className="px-4"><StatusBadge status={moto.status} /></td>
                      <td className="px-4 text-right"><div className="flex items-center justify-end gap-1"><Link href={`/motos/${moto.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors" title="Ver detalhes"><Eye className="h-4 w-4" /></Link><Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Editar" onClick={(e) => { e.stopPropagation(); openEditMotorcycle(moto) }}><Edit2 className="h-4 w-4" /></Button><Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Excluir" onClick={(e) => { e.stopPropagation(); setDeletingMotorcycle(moto) }}><Trash2 className="h-4 w-4" /></Button></div></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* 
        * MODAL: FORMULÁRIO DE CADASTRO / EDIÇÃO
        * Implementa o wizard de 2 passos para novos cadastros.
        */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingId
            ? 'Editar Dados da Moto'
            : step === 1
              ? 'Cadastrar Moto — Passo 1: Identificação'
              : step === 2
                ? 'Cadastrar Moto — Passo 2: Documentação e aquisição'
                : 'Cadastrar Moto — Passo 3: Configurar Revisões'
        }
        size="lg"
      >
        {/* ── SEÇÃO: PASSO 1 - DADOS BÁSICOS E TÉCNICOS ──────────────────────────────── */}
        {(editingId || step === 1) && (
        <form onSubmit={handleStep1} className="space-y-5 p-1">
          {/* IMPORTAR CRLV (PDF) — só aparece em cadastro novo */}
          {!editingId && (
            <div className="bg-[#282828] border border-[#474747] rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 bg-[#2d0363] border border-[#a880ff] rounded-full flex items-center justify-center flex-shrink-0">
                <Upload className="w-4 h-4 text-[#a880ff]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#f5f5f5]">Importar CRLV (PDF)</p>
                <p className="text-[12px] text-[#9e9e9e]">
                  Acelere o cadastro enviando o CRLV-e — placa, RENAVAM, chassi, proprietário e demais campos são preenchidos automaticamente.
                </p>
                {crlvImportMessage?.kind === 'success' && (
                  <p className="text-[12px] text-[#BAFF1A] mt-1.5">
                    ✔ {crlvImportMessage.fileName} — {crlvImportMessage.found} de {crlvImportMessage.total} campos importados.
                  </p>
                )}
                {crlvImportMessage?.kind === 'error' && (
                  <p className="text-[12px] text-[#ff9c9a] mt-1.5">✘ {crlvImportMessage.text}</p>
                )}
              </div>
              <label className={`flex-shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#a880ff] text-[#121212] text-[13px] font-bold cursor-pointer hover:bg-[#9166ff] transition-colors ${crlvImporting ? 'opacity-60 pointer-events-none' : ''}`}>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={crlvImporting}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleCrlvImport(file)
                    e.target.value = ''
                  }}
                />
                {crlvImporting ? 'Lendo PDF...' : 'Selecionar PDF'}
              </label>
            </div>
          )}

          {/* Identificação Legal */}
          <div className="grid grid-cols-2 gap-5">
            <Input
              label="Placa do Veículo"
              placeholder="Ex: ABC1D23"
              value={form.licensePlate}
              onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
              required
              
            />
            <Input
              label="Código RENAVAM"
              placeholder="Digite os 11 dígitos"
              value={form.renavam}
              onChange={(e) => setForm({ ...form, renavam: e.target.value })}
              required
            />
          </div>

          {/* Dados de Fabricação */}
          <div className="grid grid-cols-2 gap-5">
            <Input
              label="Marca / Fabricante"
              placeholder="Ex: HONDA"
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              required
            />
            <Input
              label="Modelo Comercial"
              placeholder="Ex: CG 160 FAN"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              required
            />
          </div>

          {/* Características Físicas e Motorização */}
          <div className="grid grid-cols-4 gap-5">
            <Input
              label="Ano de Fabricação"
              placeholder="Ex: 2024"
              value={form.yearManufacture}
              onChange={(e) => setForm({ ...form, yearManufacture: e.target.value })}
              required
            />
            <Input
              label="Ano do Modelo"
              placeholder="Ex: 2025"
              value={form.yearModel}
              onChange={(e) => setForm({ ...form, yearModel: e.target.value })}
            />
            <Input
              label="Cor Predominante"
              placeholder="Ex: PRETA"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              required
            />
            <Select
              label="Combustível"
              options={fuelOptions}
              value={form.fuel}
              onChange={(e) => setForm({ ...form, fuel: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <Input
              label="Número do Chassi"
              placeholder="Digite o código gravado no chassi"
              value={form.chassis}
              onChange={(e) => setForm({ ...form, chassis: e.target.value })}
              required
            />
            <Input
              label="Cilindrada do Motor (CC)"
              placeholder="Ex: 162cc"
              value={form.engineCapacity}
              onChange={(e) => setForm({ ...form, engineCapacity: e.target.value })}
            />
          </div>

          {/* STATUS OPERACIONAL E USO ATUAL */}
          <div className="grid grid-cols-2 gap-5 border-t border-[#323232] pt-4">
            <Select
              label="Status Atual na Frota"
              options={statusOptions}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            />
            <Input
              label="Quilometragem de Entrada"
              type="number"
              placeholder="KM atual indicado no painel"
              value={form.currentKm}
              onChange={(e) => setForm({ ...form, currentKm: e.target.value })}
            />
          </div>

          {/* CAMPO DE TEXTO LIVRE PARA VISTORIA */}
          <Textarea
            label="Laudo de Vistoria / Observações Adicionais"
            placeholder="Descreva arranhões, avarias ou detalhes observados na entrega do veículo..."
            rows={4}
            value={form.observations}
            onChange={(e) => setForm({ ...form, observations: e.target.value })}
          />

          {/* BOTÕES DE NAVEGAÇÃO DO MODAL */}
          <div className="flex gap-4 justify-end pt-4 border-t border-[#323232]">
            <Button type="button" variant="ghost" onClick={closeModal}>
              CANCELAR
            </Button>
            <Button type="submit" className="min-w-[180px]" loading={saving}>
              {editingId ? (
                /* Botão se estiver editando */
                <>
                  <Edit2 className="w-4 h-4" />
                  SALVAR ALTERAÇÕES
                </>
              ) : (
                /* Botão se estiver criando nova moto */
                <>
                  PRÓXIMO PASSO: DOCUMENTAÇÃO →
                </>
              )}
            </Button>
          </div>
        </form>
        )}

        {/* ── SEÇÃO: PASSO 2 - DOCUMENTAÇÃO E AQUISIÇÃO (PRD 0002) ─────────────────── */}
        {!editingId && step === 2 && (
          <form onSubmit={handleStep2} className="space-y-6 p-1">
            <div className="bg-[#243300] border border-[#6b9900] rounded-xl p-4">
              <p className="text-[13px] text-[#9e9e9e] leading-relaxed">
                Registre a <strong className="text-[#f5f5f5]">documentação atual</strong> e como o veículo foi adquirido.
                <br /><span className="text-[12px] text-[#616161]">DICA: campos do dono anterior aparecem só quando a aquisição não é Zero KM. Tudo no Passo 2 é opcional e pode ser completado depois.</span>
              </p>
            </div>

            {/* BLOCO: AQUISIÇÃO */}
            <div className="space-y-4">
              <h5 className="text-[14px] font-bold text-[#BAFF1A]">Aquisição</h5>
              <div className="grid grid-cols-2 gap-5">
                <Select
                  label="Tipo de aquisição"
                  options={acquisitionTypeOptions}
                  value={form.acquisitionType}
                  onChange={(e) => setForm({ ...form, acquisitionType: e.target.value as typeof form.acquisitionType })}
                />
                <Input
                  label="Data da compra"
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <Input
                  label="Valor pago pela empresa (R$)"
                  placeholder="0,00"
                  value={form.acquisitionAmount}
                  onChange={(e) => setForm({ ...form, acquisitionAmount: e.target.value })}
                />
                <Input
                  label="Valor FIPE de referência (R$)"
                  placeholder="0,00"
                  value={form.fipeValue}
                  onChange={(e) => setForm({ ...form, fipeValue: e.target.value })}
                />
              </div>
            </div>

            {/* BLOCO: DONO ANTERIOR (condicional — D5 do PRD) */}
            {form.acquisitionType !== 'zero_km' && (
              <div className="space-y-4 border-t border-[#323232] pt-4">
                <h5 className="text-[14px] font-bold text-[#BAFF1A]">Dono anterior</h5>
                <div className="grid grid-cols-2 gap-5">
                  <Input
                    label="Nome do vendedor"
                    placeholder="Nome conforme documento"
                    value={form.previousOwnerName}
                    onChange={(e) => setForm({ ...form, previousOwnerName: e.target.value })}
                  />
                  <Input
                    label="CPF / CNPJ do vendedor"
                    placeholder="000.000.000-00"
                    value={form.previousOwnerDocument}
                    onChange={(e) => setForm({ ...form, previousOwnerDocument: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* BLOCO: CRV ATUAL */}
            <div className="space-y-4 border-t border-[#323232] pt-4">
              <h5 className="text-[14px] font-bold text-[#BAFF1A]">CRV atual</h5>
              <div className="grid grid-cols-2 gap-5">
                <Input
                  label="Proprietário registrado (nome)"
                  placeholder="Quem consta no CRV"
                  value={form.registeredOwnerName}
                  onChange={(e) => setForm({ ...form, registeredOwnerName: e.target.value })}
                />
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <Select
                    label="Tipo doc."
                    options={ownerTypeOptions}
                    value={form.registeredOwnerType}
                    onChange={(e) => setForm({ ...form, registeredOwnerType: e.target.value as typeof form.registeredOwnerType })}
                  />
                  <Input
                    label="CPF / CNPJ"
                    placeholder="Documento do proprietário"
                    value={form.registeredOwnerDocument}
                    onChange={(e) => setForm({ ...form, registeredOwnerDocument: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-5">
                <Input
                  label="UF de registro"
                  placeholder="SP"
                  value={form.registrationState}
                  onChange={(e) => setForm({ ...form, registrationState: e.target.value.toUpperCase() })}
                />
                <Input
                  label="Número do CRV"
                  placeholder="Ex: 1234567890"
                  value={form.crvNumber}
                  onChange={(e) => setForm({ ...form, crvNumber: e.target.value })}
                />
                <Input
                  label="Ano-exercício"
                  placeholder="Ex: 2025"
                  value={form.crvExerciseYear}
                  onChange={(e) => setForm({ ...form, crvExerciseYear: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <Select
                  label="Transferência já realizada?"
                  options={ownershipTransferredOptions}
                  value={form.ownershipTransferred}
                  onChange={(e) => setForm({ ...form, ownershipTransferred: e.target.value as typeof form.ownershipTransferred })}
                />
                {form.ownershipTransferred === 'true' && (
                  <Input
                    label="Data da transferência"
                    type="date"
                    value={form.ownershipTransferDate}
                    onChange={(e) => setForm({ ...form, ownershipTransferDate: e.target.value })}
                  />
                )}
              </div>
              <div>
                <label className="block text-[13px] font-normal text-[#9e9e9e] mb-1.5">
                  Anexo do CRV (PDF, JPG, PNG ou WebP — até 10MB)
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setCrvFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-[13px] text-[#9e9e9e] file:mr-3 file:h-9 file:px-3 file:rounded-full file:border-0 file:bg-[#323232] file:text-[13px] file:text-[#f5f5f5] hover:file:bg-[#474747] cursor-pointer"
                />
                {crvFile && (
                  <p className="text-[12px] text-[#a880ff] mt-1.5">
                    {crvFile.name} ({Math.round(crvFile.size / 1024)} KB)
                  </p>
                )}
              </div>
            </div>

            {/* BLOCO: DOCUMENTAÇÃO ANUAL (opcional) */}
            <div className="space-y-3 border-t border-[#323232] pt-4">
              <h5 className="text-[14px] font-bold text-[#BAFF1A]">Documentação anual <span className="text-[12px] font-normal text-[#616161]">(opcional)</span></h5>
              {([
                { key: 'ipva',      label: 'IPVA'         },
                { key: 'licensing', label: 'Licenciamento'},
                { key: 'dpvat',     label: 'DPVAT'        },
              ] as const).map((row) => (
                <div key={row.key} className="grid grid-cols-[110px_1fr_1fr_150px] gap-3 items-end bg-[#282828] rounded-xl px-4 py-3">
                  <span className="text-[13px] font-bold text-[#f5f5f5] pb-2.5">{row.label}</span>
                  <Input
                    label="Valor (R$)"
                    placeholder="0,00"
                    value={obligationsForm[row.key].amount}
                    onChange={(e) => setObligationsForm((prev) => ({
                      ...prev,
                      [row.key]: { ...prev[row.key], amount: e.target.value },
                    }))}
                  />
                  <Input
                    label="Vencimento"
                    type="date"
                    value={obligationsForm[row.key].dueDate}
                    onChange={(e) => setObligationsForm((prev) => ({
                      ...prev,
                      [row.key]: { ...prev[row.key], dueDate: e.target.value },
                    }))}
                  />
                  <Select
                    label="Status"
                    options={obligationStatusOptions}
                    value={obligationsForm[row.key].status}
                    onChange={(e) => setObligationsForm((prev) => ({
                      ...prev,
                      [row.key]: { ...prev[row.key], status: e.target.value as 'pending' | 'paid' | 'exempt' },
                    }))}
                  />
                </div>
              ))}
            </div>

            {/* AÇÕES DE NAVEGAÇÃO DO WIZARD */}
            <div className="flex gap-4 justify-between pt-4 border-t border-[#323232]">
              <Button type="button" variant="ghost" onClick={() => setStep(1)} className="px-6">
                ← VOLTAR À IDENTIFICAÇÃO
              </Button>
              <Button type="submit" className="px-10">
                PRÓXIMO PASSO: REVISÕES →
              </Button>
            </div>
          </form>
        )}

        {/* ── SEÇÃO: PASSO 3 - PLANO DE MANUTENÇÃO + BOOTSTRAP (APENAS PARA NOVAS MOTOS) ─────────── */}
        {!editingId && step === 3 && (
          <div className="space-y-6 p-1">
            {/* CASO LIMITE: tenant sem nenhum plano cadastrado.
                Bloqueia a finalização e leva o operador a criar um plano. */}
            {maintenancePlans.length === 0 ? (
              <div className="bg-[#3a2f00] border border-[#ffd166] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-[#ffd166] flex-shrink-0" />
                  <p className="text-[14px] font-bold text-[#ffd166]">Nenhum plano de manutenção cadastrado</p>
                </div>
                <p className="text-[13px] text-[#ffd166] leading-relaxed">
                  Antes de finalizar o cadastro da moto, crie ao menos um plano de manutenção para o tenant.
                  O plano define quais itens (óleo, filtro, freio…) serão programados automaticamente para cada moto.
                </p>
                <Link
                  href="/planos-manutencao"
                  className="inline-flex items-center h-9 px-4 rounded-full bg-[#ffd166] text-[#121212] text-[13px] font-bold hover:bg-[#f5c14e] transition-colors"
                >
                  Criar plano de manutenção →
                </Link>
              </div>
            ) : (
              <>
                {/* SELETOR DE PLANO — Select simples com os planos ativos do tenant. */}
                <div className="bg-[#282828] border border-[#474747] rounded-xl p-4">
                  <Select
                    label="Plano de manutenção atribuído"
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    options={maintenancePlans.map((p) => ({
                      value: p.id,
                      label: p.is_default ? `${p.name} (padrão)` : p.name,
                    }))}
                  />
                  <p className="text-[12px] text-[#9e9e9e] mt-2">
                    Os itens abaixo vêm do plano selecionado.
                    <Link href="/planos-manutencao" className="ml-1 text-[#BAFF1A] hover:underline">
                      Gerenciar planos →
                    </Link>
                  </p>
                </div>

                <div className="bg-[#243300] border border-[#6b9900] rounded-xl p-4">
                  <p className="text-[13px] text-[#9e9e9e] leading-relaxed">
                    Para o sistema prever as próximas revisões, informe a <strong className="text-[#f5f5f5]">última vez</strong> que cada item abaixo foi trocado ou revisado.
                    <br /><span className="text-[12px] text-[#616161]">DICA: Se não souber, deixe em branco e o sistema marcará como "Revisão Imediata".</span>
                  </p>
                </div>

                {/* LISTAGEM DOS ITENS DO PLANO. Loader enquanto o detalhe do plano carrega. */}
                {selectedPlanQuery.isLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : selectedPlanItems.length === 0 ? (
                  <div className="bg-[#282828] border border-[#474747] rounded-xl p-5 text-center">
                    <p className="text-[13px] text-[#9e9e9e]">Este plano ainda não tem itens.</p>
                    <Link
                      href={`/planos-manutencao`}
                      className="inline-block mt-2 text-[13px] text-[#BAFF1A] hover:underline"
                    >
                      Adicionar itens em /planos-manutencao →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                    {selectedPlanItems.map((item) => {
                      const metric = planItemMetric(item)
                      return (
                        <div key={item.id} className="flex items-center gap-4 bg-[#282828] rounded-xl px-4 py-3 hover:bg-[#323232] transition-colors border border-transparent hover:border-[#323232]">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-[#f5f5f5]">{item.name}</p>
                            <p className="text-[12px] text-[#616161] font-medium">{planItemHint(item)}</p>
                          </div>

                          {/* INPUT DINÂMICO: KM ou DATA conforme o item tenha interval_km ou só interval_days. */}
                          <div className="flex-shrink-0">
                            {metric === 'km' ? (
                              <div className="relative">
                                <input
                                  type="number"
                                  placeholder="KM da Última Troca"
                                  value={bootstrapItems[item.id] ?? ''}
                                  onChange={(e) => setBootstrapItems((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  className="w-36 h-10 px-4 py-2 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder-[#616161] focus:outline-none focus:border-[#BAFF1A] text-right font-mono"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-[#616161] font-bold">KM</span>
                              </div>
                            ) : (
                              <input
                                type="date"
                                value={bootstrapItems[item.id] ?? ''}
                                onChange={(e) => setBootstrapItems((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-44 h-10 px-4 py-2 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] focus:outline-none focus:border-[#BAFF1A]"
                              />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* FEEDBACK DE CONFIGURAÇÃO */}
            {Object.keys(bootstrapItems).filter((k) => bootstrapItems[k]).length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 bg-[#2d0363] border border-[#a880ff] rounded-xl">
                <div className="w-2 h-2 bg-[#a880ff] rounded-full animate-pulse" />
                <p className="text-[12px] text-[#a880ff] font-medium">
                  {Object.keys(bootstrapItems).filter((k) => bootstrapItems[k]).length} itens de manutenção serão programados automaticamente.
                </p>
              </div>
            )}

            {/* FEEDBACK DE ERRO DO SUBMIT — exibido inline para o usuário corrigir
                sem fechar o modal e sem perder o que digitou. */}
            {submitError && (
              <div className="flex items-start gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
                <AlertCircle className="w-4 h-4 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-[#ff9c9a] flex-1">{submitError}</p>
              </div>
            )}

            {/* AÇÕES DE NAVEGAÇÃO DO WIZARD.
                Bloqueia CONCLUIR quando o tenant ainda não tem plano cadastrado —
                operador é redirecionado para /planos-manutencao via empty state acima. */}
            <div className="flex gap-4 justify-between pt-4 border-t border-[#323232]">
              <Button variant="ghost" onClick={() => setStep(2)} className="px-6" disabled={saving}>
                ← VOLTAR À DOCUMENTAÇÃO
              </Button>
              <Button
                onClick={handleSubmitFinal}
                className="px-10"
                loading={saving}
                disabled={saving || maintenancePlans.length === 0}
                title={maintenancePlans.length === 0 ? 'Crie um plano de manutenção antes de finalizar.' : undefined}
              >
                <Plus className="w-4 h-4" />
                CONCLUIR CADASTRO
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 
        * MODAL: CONFIRMAÇÃO DE EXCLUSÃO
        * Medida de segurança para evitar exclusão acidental.
        */}
      <Modal open={!!deletingMotorcycle} onClose={() => setDeletingMotorcycle(null)} title="Confirmar Exclusão Permanente" size="sm">
        <div className="space-y-6">
          <div className="p-4 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
            <p className="text-[#9e9e9e] text-[13px] leading-relaxed text-center">
              Você está prestes a remover a moto <br />
              <strong className="text-[#f5f5f5] text-base font-bold">{deletingMotorcycle?.make} {deletingMotorcycle?.model} — Placa {deletingMotorcycle?.license_plate}</strong>
              <br /><br />
              Esta operação <span className="text-[#ff9c9a] font-bold underline">não pode ser desfeita</span> e todos os históricos vinculados serão perdidos.
            </p>
          </div>
          
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDeletingMotorcycle(null)} className="flex-1">
              CANCELAR
            </Button>
            <Button variant="danger" onClick={confirmDeletion} className="flex-1" loading={saving}>
              <Trash2 className="w-4 h-4" />
              CONFIRMAR EXCLUSÃO
            </Button>
          </div>
        </div>
      </Modal>

      {/* 
        * MODAL: VISUALIZAÇÃO DETALHADA (FICHA TÉCNICA)
        * Exibe todas as informações de forma organizada e apenas para leitura.
        */}
      {motorcycleDetails && (
        <Modal
          open={!!motorcycleDetails}
          onClose={() => setMotorcycleDetails(null)}
          title="Ficha Técnica do Veículo"
          size="lg"
        >
          <div className="space-y-8 p-1">
            {/* CABEÇALHO DO MODAL: Título e Status Principal */}
            <div className="flex items-start justify-between gap-6 pb-6 border-b border-[#323232]">
              <div>
                <h3 className="text-[28px] font-bold text-[#f5f5f5]">
                  {motorcycleDetails.make} {motorcycleDetails.model}
                </h3>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[13px] font-bold text-[#616161] bg-[#323232] px-2 py-0.5 rounded">
                    {motorcycleDetails.year_manufacture}{motorcycleDetails.year_model ? `/${motorcycleDetails.year_model}` : ''}
                  </span>
                  <span className="text-[13px] font-bold text-[#616161] bg-[#323232] px-2 py-0.5 rounded">{motorcycleDetails.color}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <StatusBadge status={motorcycleDetails.status} />
                
                {motorcycleDetails.status === 'rented' && (() => {
                  const contract = contracts.find(c => c.motorcycle_id === motorcycleDetails.id && c.status === 'active')
                  if (!contract) return null;
                  const customerName = contract.customer?.name || 'Cliente desconhecido'
                  const weeklyValue = contract.monthly_amount ? formatCurrency(contract.monthly_amount) : 'N/A'
                  return (
                    <div className="flex flex-col items-end gap-1 mt-2">
                      <div className="flex items-center gap-1.5 text-[13px] text-[#f5f5f5]">
                        <User className="w-4 h-4 text-[#a880ff]" />
                        <span className="font-medium">{customerName}</span>
                      </div>
                      <span className="text-[13px] font-medium text-[#BAFF1A]">{weeklyValue} / semana</span>
                    </div>
                  )
                })()}

                {/* Repetição do selo de manutenção para ênfase */}
                {motorcycleDetails.maintenance_up_to_date ? (
                  <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0e2f13] border border-[#28b438] text-[#229731] text-[12px] font-medium">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Manutenção em Dia
                  </span>
                ) : (
                  <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#3a180f] border border-[#e65e24] text-[#e65e24] text-[12px] font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Revisão Pendente
                  </span>
                )}
              </div>
            </div>

            {/* SEÇÃO: INFORMAÇÕES TÉCNICAS E LEGAIS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <section className="space-y-4">
                <h5 className="text-[14px] font-bold text-[#BAFF1A] mb-4">Dados de Registro</h5>
                <div className="space-y-4">
                  <DetailRow label="Placa do Veículo" value={motorcycleDetails.license_plate} mono />
                  <DetailRow label="Código RENAVAM" value={motorcycleDetails.renavam} mono />
                  <DetailRow label="Número do Chassi" value={motorcycleDetails.chassis} mono />
                </div>
              </section>

              <section className="space-y-4">
                <h5 className="text-[14px] font-bold text-[#BAFF1A] mb-4">Especificações do Motor</h5>
                <div className="space-y-4">
                  <DetailRow label="Tipo de Combustível" value={motorcycleDetails.fuel} />
                  <DetailRow label="Potência / Cilindrada" value={motorcycleDetails.engine_capacity} />
                  <DetailRow label="Identificador de Frota" value={`ID-#${motorcycleDetails.id}`} />
                </div>
              </section>
            </div>

            {/* SEÇÃO: HISTÓRICO DE PROPRIEDADE (Renderização Condicional) */}
            {(motorcycleDetails.previous_owner || motorcycleDetails.purchase_date || motorcycleDetails.fipe_value) && (
              <div className="bg-[#282828] rounded-xl p-6 border border-[#323232]">
                <h5 className="text-[14px] font-bold text-[#BAFF1A] mb-6">Informações de Aquisição GoMoto</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
                  {motorcycleDetails.previous_owner && (
                    <DetailRow label="Vendedor / Dono Anterior" value={motorcycleDetails.previous_owner} fullWidth />
                  )}
                  {motorcycleDetails.previous_owner_cpf && (
                    <DetailRow label="CPF do Vendedor" value={motorcycleDetails.previous_owner_cpf} mono />
                  )}
                  {motorcycleDetails.purchase_date && (
                    <DetailRow
                      label="Data da Transferência"
                      value={new Date(motorcycleDetails.purchase_date + 'T12:00:00').toLocaleDateString('pt-BR', { dateStyle: 'long' })}
                    />
                  )}
                  {motorcycleDetails.fipe_value && (
                    <DetailRow
                      label="Avaliação FIPE na Compra"
                      value={formatCurrency(motorcycleDetails.fipe_value)}
                      highlight
                    />
                  )}
                </div>
              </div>
            )}

            {/* SEÇÃO: OBSERVAÇÕES E NOTAS DE VISTORIA */}
            {motorcycleDetails.observations && (
              <div className="space-y-3">
                <h5 className="text-[14px] font-bold text-[#BAFF1A]">Notas do Veículo & Vistoria</h5>
                <div className="bg-[#282828] rounded-xl p-5 border border-[#323232]">
                  <p className="text-[13px] text-[#9e9e9e] leading-relaxed italic">
                    "{motorcycleDetails.observations}"
                  </p>
                </div>
              </div>
            )}

            {/* AÇÕES DE RODAPÉ DO MODAL */}
            <div className="flex justify-end gap-4 pt-6 border-t border-[#323232]">
              <Button
                variant="ghost"
                onClick={() => setMotorcycleDetails(null)}
                className="px-8"
              >
                FECHAR
              </Button>
              <Button
                onClick={() => {
                  setMotorcycleDetails(null)
                  openEditMotorcycle(motorcycleDetails)
                }}
                className="px-8"
              >
                <Edit2 className="w-4 h-4" />
                EDITAR INFORMAÇÕES
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * @component DetailRow
 * @description Sub-componente para exibição padronizada de pares Rótulo/Valor na Ficha Técnica.
 * Evita repetição de classes CSS e centraliza a lógica de ocultação de campos vazios.
 *
 * ATENÇÃO — Bug corrigido: a verificação anterior `if (!value)` ocultava valores
 * numericamente falsy como `0` (ex: "0 KM" ou "R$ 0,00"). A verificação explícita
 * abaixo garante que apenas undefined, null e string vazia suprimem a renderização.
 */
function DetailRow({
  label,
  value,
  mono = false,
  highlight = false,
  fullWidth = false,
}: {
  label: string
  value?: string | number | null
  mono?: boolean
  highlight?: boolean
  fullWidth?: boolean
}) {
  // Verificação explícita: permite o valor 0, mas oculta undefined, null e strings vazias
  if (value === undefined || value === null || value === '') return null
  
  return (
    <div className={fullWidth ? 'col-span-full' : ''}>
      <p className="text-[13px] font-normal text-[#9e9e9e] mb-1.5">{label}</p>
      <p
        className={`text-[13px] leading-tight ${mono ? 'font-mono tracking-tighter' : 'font-medium'} ${
          highlight ? 'text-[#BAFF1A]' : 'text-[#f5f5f5]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
