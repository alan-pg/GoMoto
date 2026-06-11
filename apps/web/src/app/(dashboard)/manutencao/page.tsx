'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Wrench, CheckCircle2, AlertTriangle, Clock, Trash2, Edit2, Eye,
  Search, Camera, FileText, ChevronDown, Gauge, Info, DollarSign,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { uploadMaintenancePhoto } from './actions'
import type { Maintenance } from '@/types'

import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Header } from '@/components/layout/Header'

// ─── TIPOS ──────────────────────────────────────────────────────────────────

/**
 * @type MaintenanceStatus
 * @description Define os possíveis estados de uma manutenção no ciclo de vida do sistema.
 * Por que existe: Facilita a categorização, filtragem e a estilização (cores, ícones) das manutenções na interface. Serve como base para alertas e priorização.
 * Onde é usado: Na tipagem estendida `MaintenanceWithMoto`, cálculos de status, filtros de busca e na renderização visual dos badges de status.
 */
type MaintenanceStatus = 'overdue' | 'upcoming' | 'scheduled' | 'completed'

/**
 * @type Responsibility
 * @description Enumeração para identificar o responsável financeiro por um item de manutenção.
 * Por que existe: O sistema lida com aluguel de motos, logo é necessário saber quem arca com os custos das peças/serviços (empresa, cliente ou ambos).
 * Onde é usado: No tipo `ItemFinancial` e no modal de conclusão (etapa 2) para cálculo do repasse de custos na fatura do cliente.
 */
type Responsibility = 'company' | 'customer' | 'split'

/**
 * @type ItemFinancial
 * @description Estrutura de dados que armazena os detalhes financeiros de um item de manutenção na etapa de conclusão.
 * Por que existe: Permite capturar o custo individual de múltiplos itens de manutenção realizados de uma só vez, além da responsabilidade e comprovação (fotos).
 * Onde é usado: No estado `completionFinancials` para controlar o formulário financeiro da segunda etapa da conclusão de manutenção.
 */
type ItemFinancial = {
  id: string
  description: string
  cost: string
  responsibility: Responsibility
  has_odometer_photo: boolean
  has_invoice_photo: boolean
  odometer_photo_file: File | null
  invoice_photo_file: File | null
}

/**
 * @type ContractInfo
 * @description Representa as informações básicas do contrato ativo de uma motocicleta.
 * Por que existe: Usado para definir a responsabilidade financeira padrão de uma manutenção corretiva (ex: contrato "promise" / promessa de compra pode cobrar do cliente, aluguel divide ou assume o custo).
 * Onde é usado: No estado `activeContract` para influenciar as regras de negócio no momento de conclusão da manutenção e aviso de descontos.
 */
type ContractInfo = {
  type: 'rental' | 'promise'
  client_name: string
  next_billing_date: string | null
}

/**
 * @type MaintenanceWithMoto
 * @description Tipo que estende a entidade `Maintenance` base, adicionando os dados relacionados da motocicleta e o status dinâmico calculado no front-end.
 * Por que existe: A API do Supabase retorna a manutenção fazendo um "join" com a tabela `motorcycles`. O front-end também injeta propriedades extras (`_status`) para facilitar renderização.
 * Onde é usado: Na listagem de manutenções, agrupamento por moto e passagem de propriedades para os modais e componentes filhos.
 */
type MaintenanceWithMoto = Maintenance & {
  motorcycles: {
    license_plate: string
    model: string
    make: string
    km_current: number
  } | null
  _status?: MaintenanceStatus
}

/**
 * @type MotorcycleOption
 * @description Representa os dados essenciais de uma motocicleta retornados do banco para popular as opções de seleção (Dropdowns/Selects).
 * Por que existe: Para não carregar dados desnecessários das motos quando só precisamos de placa, modelo e quilometragem para a interface de escolhas.
 * Onde é usado: Nos estados `motorcycles`, opções do formulário de criação/edição e no filtro de motocicletas.
 */
type MotorcycleOption = {
  id: string
  license_plate: string
  model: string
  make: string
  km_current: number
}

/**
 * @type MaintenanceFormData
 * @description Estrutura do formulário principal de criação e edição de manutenções.
 * Por que existe: Para centralizar todos os campos que o usuário preenche na criação/edição de uma manutenção, separando os tipos da API da lógica do formulário em React (onde tudo costuma iniciar como string).
 * Onde é usado: No estado `formData` para controlar as inputs controladas do React (controlled components).
 */
type MaintenanceFormData = {
  motorcycle_id: string
  type: 'preventive' | 'corrective' | 'inspection'
  description: string
  scheduled_date: string
  actual_km: string
  cost: string
  completed: boolean
  completed_date: string
  workshop: string
  observations: string
}

// ─── CONSTANTES ─────────────────────────────────────────────────────────────

/**
 * @constant supabase
 * @description Instância de cliente do Supabase inicializada para o componente (client-side).
 * Impacto se alterado: Quebra toda a comunicação com a base de dados (leitura, escrita, deleção).
 */
const supabase = createClient()

async function uploadMaintenanceFile(file: File, prefix: string): Promise<string | null> {
  const formData = new FormData()
  formData.append('file', file)
  return uploadMaintenancePhoto(formData, prefix)
}

/**
 * @constant INITIAL_FORM
 * @description Estado inicial do formulário de manutenção. Fornece valores em branco ou defaults sensatos.
 * Impacto se alterado: Modifica os campos padrões ao abrir o modal de "Nova Manutenção". Por exemplo, o tipo default começa como "corrective" e oficina como "Oficina do Careca".
 */
const INITIAL_FORM: MaintenanceFormData = {
  motorcycle_id: '',
  type: 'corrective',
  description: '',
  scheduled_date: '',
  actual_km: '',
  cost: '',
  completed: false,
  completed_date: '',
  workshop: 'Oficina do Careca',
  observations: '',
}

/**
 * @constant TYPE_LABEL_MAP
 * @description Mapa de tradução (dicionário) para converter o tipo em inglês da manutenção para a exibição (label) amigável em português na interface do usuário.
 * Impacto se alterado: Muda os textos de exibição da coluna "Tipo" nos selects e crachás de tipagem.
 */
const TYPE_LABEL_MAP: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Vistoria',
}

/**
 * @constant KM_POR_DIA
 * @description Estimativa média de quilômetros rodados por uma moto de aluguel/trabalho em um dia. É calculado dividindo 1000 km por 7 dias.
 * Impacto se alterado: Afeta as previsões de data para as próximas manutenções. Se aumentar, o sistema estimará que a manutenção ocorrerá mais cedo.
 */
const KM_POR_DIA = 1000 / 7

/**
 * @constant STANDARD_INTERVALS
 * @description Dicionário com os intervalos padrões (em quilometragem ou dias) para diferentes tipos de manutenções e vistorias de rotina.
 * Impacto se alterado: Afeta toda a lógica de alerta de manutenções próximas ou vencidas, além da sugestão automática de agendamento de novas manutenções quando uma é concluída.
 */
const STANDARD_INTERVALS: Record<string, { interval_km?: number; interval_days?: number }> = {
  // Óleo e filtros
  'Troca de óleo':              { interval_km: 1000 },
  'Troca de oleo':              { interval_km: 1000 },
  'Troca de óleo e filtro':     { interval_km: 1000 },
  'Filtro de óleo':             { interval_km: 4000 },
  'Filtro de ar':               { interval_km: 4000 },
  // Velas
  'Vela de ignição':            { interval_km: 4000 },
  'Velas de ignição':           { interval_km: 4000 },
  // Transmissão
  'Kit de transmissão':         { interval_km: 8000 },
  // Pneus
  'Pneu traseiro':              { interval_km: 8000 },
  'Pneu dianteiro':             { interval_km: 16000 },
  // Freios
  'Freio dianteiro':            { interval_km: 10000 },
  'Freio traseiro':             { interval_km: 8000 },
  'Pastilha de freio dianteira':{ interval_km: 10000 },
  'Pastilha de freio traseira': { interval_km: 8000 },
  'Lona de freio traseira':     { interval_km: 8000 },
  'Lona de freio dianteira':    { interval_km: 10000 },
  // Amortecedores
  'Amortecedor':                { interval_km: 15000 },
  'Amortecedores':              { interval_km: 15000 },
  // Revisão geral
  'Revisão geral':              { interval_km: 6000 },
  // Vistorias
  'Vistoria de entrega':        { interval_days: 180 },
  'Vistoria periódica':         { interval_days: 180 },
  'Vistoria mensal':            { interval_days: 30 },
}

/**
 * @constant STATUS_COLORS
 * @description Mapeamento centralizado de cores mágicas para uso consistente nos badges e textos de cada status de manutenção.
 * Impacto se alterado: Reflete em toda a página onde o status é renderizado de forma visual sem alterar as classes originais em linha.
 */
const STATUS_COLORS = {
  overdue:   { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]' },
  upcoming:  { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]' },
  scheduled: { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]' },
  completed: { bg: 'bg-[#0e2f13]', text: 'text-[#229731]' },
}

// ─── HELPERS DE CÁLCULO ─────────────────────────────────────────────────────

/**
 * @function normalize
 * @description Remove acentos e caracteres especiais, além de converter toda a string para letras minúsculas.
 * @param {string} s - String de entrada (ex: "Troca de óleo").
 * @returns {string} String normalizada e limpa (ex: "troca de oleo").
 * @example normalize('Atenção') // retorna 'atencao'
 */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * @function getInterval
 * @description Realiza uma busca tolerante a falhas no dicionário de intervalos. Ela verifica primeiro por match exato, depois ignorando maiúsculas e por último ignorando acentos/espaços em branco.
 * @param {string} description - Descrição da manutenção (ex: "troca de OLEO").
 * @returns {{ interval_km?: number; interval_days?: number } | undefined} Objeto contendo a quilometragem ou dias de intervalo, ou `undefined` se não encontrado.
 * @example getInterval('Troca de oleo') // retorna { interval_km: 1000 }
 */
function getInterval(description: string) {
  if (STANDARD_INTERVALS[description]) return STANDARD_INTERVALS[description]
  const lower = description.toLowerCase()
  const normalizedDesc = normalize(description)
  for (const key of Object.keys(STANDARD_INTERVALS)) {
    if (key.toLowerCase() === lower) return STANDARD_INTERVALS[key]
    if (normalize(key) === normalizedDesc) return STANDARD_INTERVALS[key]
  }
  return undefined
}

/**
 * @function fmtKm
 * @description Formata um número bruto representando uma quilometragem em uma string formatada no padrão brasileiro, anexando " km" ao final.
 * @param {number} km - Quilometragem numérica (ex: 15000).
 * @returns {string} Quilometragem formatada (ex: "15.000 km").
 * @example fmtKm(1234.5) // retorna "1.235 km"
 */
function fmtKm(km: number): string {
  return `${Math.round(km).toLocaleString('pt-BR')} km`
}

/**
 * @function diffKm
 * @description Calcula a diferença em quilômetros entre a KM prevista da manutenção e a KM atual da moto.
 * @param {MaintenanceWithMoto} m - Objeto de manutenção populado com os dados da motocicleta.
 * @returns {number | null} Valor numérico da diferença (negativo indica que a manutenção está vencida). Retorna null se não houver previsão em KM.
 * @example diffKm({ predicted_km: 15000, motorcycles: { km_current: 16000 } }) // retorna -1000
 */
function diffKm(m: MaintenanceWithMoto): number | null {
  if (m.predicted_km === null || m.predicted_km === undefined) return null
  return m.predicted_km - (m.motorcycles?.km_current ?? 0)
}

/**
 * @function diffDias
 * @description Calcula a diferença em dias entre a data atual e a data agendada para uma manutenção.
 * @param {MaintenanceWithMoto} m - Objeto de manutenção.
 * @returns {number | null} Diferença em dias (valores negativos indicam atraso). Retorna null se não houver data agendada.
 * @example diffDias({ scheduled_date: '2023-10-10' }) // retorna 5 (se hoje for 2023-10-05)
 */
function diffDias(m: MaintenanceWithMoto): number | null {
  if (!m.scheduled_date) return null
  const today = new Date()
  const due = new Date(m.scheduled_date + 'T12:00:00')
  return Math.floor((due.getTime() - today.getTime()) / 86400000)
}

/**
 * @function calcularStatus
 * @description Determina o status lógico de uma manutenção combinando as regras de distância em KM e/ou prazo em dias, além do status de finalização.
 * A função aplica um "limiar" (threshold) de 10% de antecedência para classificar uma manutenção como "Próxima" (`upcoming`), e a marca como `overdue` se ultrapassar as marcas.
 * @param {MaintenanceWithMoto} m - Objeto de manutenção com os dados da motocicleta.
 * @returns {MaintenanceStatus} O status correspondente (vencida, próxima, agendada, concluída).
 * @example calcularStatus(maintenanceObject) // retorna 'upcoming'
 */
function calcularStatus(m: MaintenanceWithMoto): MaintenanceStatus {
  // Se a manutenção já foi concluída, não precisa de cálculos adicionais.
  if (m.completed) return 'completed'
  const kmCurrent = m.motorcycles?.km_current ?? 0

  // Tratamento para manutenções controladas por odômetro (quilometragem)
  if (m.predicted_km !== null && m.predicted_km !== undefined) {
    if (kmCurrent >= m.predicted_km) return 'overdue'
    const interval = getInterval(m.description)
    // 10% do intervalo padrão ou 100km se não encontrar intervalo
    const threshold = interval?.interval_km ? Math.round(interval.interval_km * 0.10) : 100
    if (kmCurrent >= m.predicted_km - threshold) return 'upcoming'
    return 'scheduled'
  }

  // Tratamento para manutenções baseadas no tempo (datas)
  if (m.scheduled_date) {
    const today = new Date()
    const due = new Date(m.scheduled_date + 'T12:00:00')
    if (today >= due) return 'overdue'
    const interval = getInterval(m.description)
    // 10% dos dias do intervalo padrão ou 18 dias como tolerância padrão
    const thresholdDays = interval?.interval_days ? Math.round(interval.interval_days * 0.10) : 18
    const thresholdDate = new Date(due)
    thresholdDate.setDate(thresholdDate.getDate() - thresholdDays)
    if (today >= thresholdDate) return 'upcoming'
    return 'scheduled'
  }

  // Fallback seguro caso não haja data nem quilometragem (ex: adicionada sem previsão)
  return 'scheduled'
}

// ─── COMPONENTES AUXILIARES ─────────────────────────────────────────────────

/**
 * @function BadgeStatus
 * @description Um componente visual que renderiza uma etiqueta arredondada e colorida dependendo do status atual da manutenção.
 * @param {{ status: MaintenanceStatus }} props - O status semântico extraído ou calculado.
 * @returns {JSX.Element} Renderização do badge indicativo de status.
 */
function BadgeStatus({ status }: { status: MaintenanceStatus }) {
  const map: Record<MaintenanceStatus, { label: string; cls: string }> = {
    overdue:   { label: 'Vencida',   cls: `${STATUS_COLORS.overdue.bg} ${STATUS_COLORS.overdue.text}` },
    upcoming:  { label: 'Próxima',   cls: `${STATUS_COLORS.upcoming.bg} ${STATUS_COLORS.upcoming.text}` },
    scheduled: { label: 'Agendada',  cls: `${STATUS_COLORS.scheduled.bg} ${STATUS_COLORS.scheduled.text}` },
    completed: { label: 'Concluída', cls: `${STATUS_COLORS.completed.bg} ${STATUS_COLORS.completed.text}` },
  }
  const b = map[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${b.cls}`}>
      {b.label}
    </span>
  )
}

/**
 * @function SituacaoCell
 * @description Um sub-componente de tabela que desenha de forma amigável a situação da manutenção (ex: "Faltam 500km", "Vencida há 3 dias", "Vence hoje").
 * Isola a complexidade condicional dos retornos textuais da tabela principal.
 * @param {{ m: MaintenanceWithMoto }} props - A manutenção com os dados da motocicleta atrelados.
 * @returns {JSX.Element} Elemento formatado exibindo tempo/quilometragem faltante ou excedida.
 */
function SituacaoCell({ m }: { m: MaintenanceWithMoto }) {
  if (m.completed) {
    // Se a manutenção está completa, exibe o nome da oficina onde o serviço foi feito
    return <span className="text-[13px] text-[#9e9e9e]">{m.workshop ?? '—'}</span>
  }
  const km = diffKm(m)
  const dias = diffDias(m)

  // Prioriza exibir diferença quilométrica quando houver
  if (km !== null) {
    if (km <= 0) return <span className="text-[13px] font-medium text-[#ff9c9a]">Vencida há {fmtKm(Math.abs(km))}</span>
    return (
      <span className={`text-[13px] font-medium ${km <= 100 ? 'text-[#e65e24]' : 'text-[#9e9e9e]'}`}>
        Faltam {fmtKm(km)}
      </span>
    )
  }

  // Senão, analisa datas (temporal)
  if (dias !== null) {
    if (dias < 0) return <span className="text-[13px] font-medium text-[#ff9c9a]">Vencida há {Math.abs(dias)} dias</span>
    if (dias === 0) return <span className="text-[13px] font-medium text-[#e65e24]">Vence hoje</span>
    return (
      <span className={`text-[13px] font-medium ${dias <= 18 ? 'text-[#e65e24]' : 'text-[#9e9e9e]'}`}>
        Em {dias} dias
      </span>
    )
  }

  // Retorno neutro caso faltem ambos os indicadores
  return <span className="text-[#9e9e9e]">—</span>
}

// ─── COMPONENTE PRINCIPAL ───────────────────────────────────────────────────

/**
 * @function MaintenancePage
 * @description Ponto de entrada e centralizador (Página) para a tela de controle de Manutenções no painel do sistema GoMoto.
 * Organiza agrupamentos listados, KPI cards, form para novas manutenções e engloba o fluxo de conclusão avançada de 2 etapas.
 * @returns {JSX.Element} A interface principal de manutenções compilada com seus modais auxiliares.
 */
export default function MaintenancePage() {

  // ── ESTADOS: Dados ────────────────────────────────────────────────────────
  
  // [maintenances, setMaintenances]: Armazena a listagem em bruto de todos os registros de manutenções vindos da base.
  // Exemplo de valor: [{ id: '123', description: 'Troca de óleo', ... }]
  const [maintenances, setMaintenances] = useState<MaintenanceWithMoto[]>([])
  
  // [motorcycles, setMotorcycles]: Guarda lista leve (placa, modelo e KM) de todas as motos do sistema (para filtros e popular Selects).
  // Exemplo de valor: [{ id: '1', license_plate: 'ABC-1234', make: 'Honda', ... }]
  const [motorcycles, setMotorcycles] = useState<MotorcycleOption[]>([])

  // ── ESTADOS: UI e Carregamento ────────────────────────────────────────────

  // [loading, setLoading]: Informa se o componente está buscando dados primários iniciais na montagem para rodar o loading-spinner.
  const [loading, setLoading] = useState(true)
  
  // [saving, setSaving]: Indica se há uma requisição ao Supabase em andamento ao salvar o formulário.
  const [saving, setSaving] = useState(false)
  
  // [completing, setCompleting]: Bloqueia cliques excessivos no botão de confirmar conclusão enquanto a etapa 2 roda.
  const [completing, setCompleting] = useState(false)
  const [showPhotoWarning, setShowPhotoWarning] = useState(false)

  // ── ESTADOS: Filtros de Visualização ──────────────────────────────────────
  
  // [statusFilter, setStatusFilter]: Gerencia a aba/tab ativa ('all', 'overdue', 'upcoming', 'scheduled', 'completed').
  const [statusFilter, setStatusFilter] = useState('all')
  
  // [motorcycleFilter, setMotorcycleFilter]: Guarda o ID da moto selecionada no select filter para isolar as views para 1 moto.
  const [motorcycleFilter, setMotorcycleFilter] = useState('')
  
  // [typeFilter, setTypeFilter]: Refina a busca ('preventive', 'corrective', 'inspection').
  const [typeFilter, setTypeFilter] = useState('all')
  
  // [searchQuery, setSearchQuery]: Termo textual de busca dinâmica inserido no campo de lupa.
  const [searchQuery, setSearchQuery] = useState('')

  // ── ESTADOS: UI de Agrupamento das Tabelas (Accordion) ────────────────────
  
  // [collapsedMotos, setCollapsedMotos]: Guarda os IDs das motocicletas que estão fechadas/colapsadas no painel visual da lista.
  const [collapsedMotos, setCollapsedMotos] = useState<Set<string>>(new Set())
  
  // [historyMotos, setHistoryMotos]: Mantém registro dos IDs das motocicletas onde o histórico de manutenções passadas (concluídas) está sendo exibido.
  const [historyMotos, setHistoryMotos] = useState<Set<string>>(new Set())

  /**
   * @function toggleMoto
   * @description Alterna a visibilidade (expandido/colapsado) da sanfona (accordion) que lista os itens de uma motocicleta específica.
   * Pré-condição: Nenhuma.
   * Efeitos colaterais: Altera o estado `collapsedMotos` adicionando ou removendo o ID.
   * @param {string} id - O ID exclusivo da motocicleta.
   */
  function toggleMoto(id: string) {
    setCollapsedMotos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  /**
   * @function toggleHistory
   * @description Exibe ou oculta os itens de manutenção já concluídos (histórico) na área interna expandida de uma moto.
   * Pré-condição: O agrupamento da moto precisa estar expandido para ver isso.
   * Efeitos colaterais: Altera o estado `historyMotos` armazenando quais motos têm histórico exibido.
   * @param {string} id - O ID exclusivo da motocicleta.
   */
  function toggleHistory(id: string) {
    setHistoryMotos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  // ── ESTADOS: Controle de Modais ───────────────────────────────────────────
  
  // [isFormModalOpen, setIsFormModalOpen]: Visibilidade do Modal de nova manutenção / edição.
  const [isFormModalOpen, setIsFormModalOpen] = useState(false)
  
  // [isDeleteModalOpen, setIsDeleteModalOpen]: Visibilidade do Modal de confirmação para deletar o registro.
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  
  // [isCompleteModalOpen, setIsCompleteModalOpen]: Visibilidade do Modal inteligente da Conclusão.
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false)
  
  // [isKmModalOpen, setIsKmModalOpen]: Visibilidade do Modal focado estritamente na atualização rápida da KM da moto.
  const [isKmModalOpen, setIsKmModalOpen] = useState(false)
  
  // [editingMaintenance, setEditingMaintenance]: Objeto contendo os dados da manutenção caso o modo edição seja invocado (ao invés de inserção).
  const [editingMaintenance, setEditingMaintenance] = useState<MaintenanceWithMoto | null>(null)
  const [viewingMaintenance, setViewingMaintenance] = useState<MaintenanceWithMoto | null>(null)
  
  // [completingMaintenance, setCompletingMaintenance]: Armazena a linha raiz/principal que acionou o processo multi-passo de conclusão da manutenção.
  const [completingMaintenance, setCompletingMaintenance] = useState<MaintenanceWithMoto | null>(null)
  
  // [deletingId, setDeletingId]: Armazena temporariamente o ID do item focado para exclusão antes do aceite de confirmação.
  const [deletingId, setDeletingId] = useState<string | null>(null)
  
  // [kmForm, setKmForm]: Representa o mini-estado para o modal embutido de atualização ágil da KM atual de uma moto.
  const [kmForm, setKmForm] = useState({ motorcycle_id: '', km_current: '' })

  // ── ESTADOS: Dados do Formulário CRUD Genérico ────────────────────────────
  
  // [formData, setFormData]: Controle das "inputs" no formulário clássico de adição ou alteração. Inicia vazio / com padrão.
  const [formData, setFormData] = useState<MaintenanceFormData>(INITIAL_FORM)

  // ── ESTADOS: Fluxo de Conclusão Inteligente (2 Etapas) ────────────────────
  
  // [completionStep, setCompletionStep]: Guia qual 'página' do modal renderizar (1 ou 2).
  const [completionStep, setCompletionStep] = useState<1 | 2>(1)
  
  // [completionKm, setCompletionKm]: Quilometragem do odômetro no momento da conclusão da manutenção.
  const [completionKm, setCompletionKm] = useState('')
  
  // [completionWorkshop, setCompletionWorkshop]: A oficina que realizou o reparo. Inicia com um "default".
  const [completionWorkshop, setCompletionWorkshop] = useState('Oficina do Careca')
  
  // [completionObservations, setCompletionObservations]: Parecer técnico extra feito pelo mecânico ou analista.
  const [completionObservations, setCompletionObservations] = useState('')
  
  // [completionDate, setCompletionDate]: Momento ISO temporal estrito de quando ocorreu a finalização real deste trabalho.
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().split('T')[0])
  
  // [completionExtras, setCompletionExtras]: Array de manutenções irmãs (da mesma moto) que estão pendentes e sugeridas na mesma vez.
  const [completionExtras, setCompletionExtras] = useState<MaintenanceWithMoto[]>([])
  
  // [completionAllSiblings, setCompletionAllSiblings]: Todas as pendências de itens para a mesma moto, usado apenas para cálculos de previsão futura independente de ser marcada na checkbox ou não.
  const [completionAllSiblings, setCompletionAllSiblings] = useState<MaintenanceWithMoto[]>([])
  
  // [completionExtraIds, setCompletionExtraIds]: Array de IDs das manutenções adicionais selecionadas para conclusão conjunta.
  const [completionExtraIds, setCompletionExtraIds] = useState<string[]>([])
  
  // [completionFinancials, setCompletionFinancials]: Array de dados financeiros da etapa 2. Armazena custo, responsável e status das fotos dos comprovantes por item.
  const [completionFinancials, setCompletionFinancials] = useState<ItemFinancial[]>([])
  
  // [activeContract, setActiveContract]: Armazena o contrato ativo da moto para determinar a responsabilidade financeira padrão da manutenção.
  const [activeContract, setActiveContract] = useState<ContractInfo | null>(null)
  
  // [discountConfirmed, setDiscountConfirmed]: Estado do checkbox de confirmação do usuário sobre o repasse de custos para a fatura do cliente.
  const [discountConfirmed, setDiscountConfirmed] = useState(false)

  // ─── BUSCA DE DADOS ASSÍNCRONOS ───────────────────────────────────────────

  /**
   * @function fetchMaintenances
   * @description Realiza a query (via Supabase) para obter toda a tabela de manutenções combinada as dependências da moto (placa, marca).
   * Pré-condição: Cliente do Supabase disponível e autenticado.
   * Efeitos colaterais: Popula o array no estado `maintenances`.
   */
  const fetchMaintenances = useCallback(async () => {
    const { data, error } = await supabase
      .from('maintenances')
      .select('*, motorcycles(license_plate, model, make, km_current)')
      .order('created_at', { ascending: false })
    if (error) { console.error('[MANUTENCAO] fetch error:', error); return }
    setMaintenances((data as MaintenanceWithMoto[]) || [])
  }, [])

  /**
   * @function fetchMotorcycles
   * @description Busca dados parciais das motocicletas para preencher as opções dos selects da interface.
   * Pré-condição: Nenhuma.
   * Efeitos colaterais: Insere listagem no state `motorcycles`.
   */
  const fetchMotorcycles = useCallback(async () => {
    const { data, error } = await supabase
      .from('motorcycles')
      .select('id, license_plate, model, make, km_current')
      .order('license_plate')
    if (error) { return }
    setMotorcycles((data as MotorcycleOption[]) || [])
  }, [])

  // Hook primário de carregamento em massa da página
  // Chama as requisições de buscar motocicletas e manutenções concorrentemente e remove o loader ao resolver.
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchMaintenances(), fetchMotorcycles()])
      setLoading(false)
    }
    load()
  }, [fetchMaintenances, fetchMotorcycles])

  // ─── DADOS COMPUTADOS (USANDO MEMOIZAÇÃO) ─────────────────────────────────

  /**
   * Computação: Injeta a label interna `_status` via processamento lógico de forma preventiva
   * para não chamar essa rotina pesada a cada render dentro dos laços.
   */
  const withStatus = useMemo(() =>
    maintenances.map((m) => ({ ...m, _status: calcularStatus(m) })),
    [maintenances]
  )

  /**
   * Computação de Filtros em Cascata: Subtrai o array completo com base nas ações textuais, tabs de situação e selects do cabeçalho de busca.
   * Por fim, ordena para que sempre os problemas em aberto e mais graves subam para a linha visual do gestor.
   */
  const filtered = useMemo(() => {
    return withStatus
      .filter((m) => {
        if (statusFilter !== 'all' && m._status !== statusFilter) return false
        if (motorcycleFilter && m.motorcycle_id !== motorcycleFilter) return false
        if (typeFilter !== 'all' && m.type !== typeFilter) return false
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (![m.description, m.motorcycles?.license_plate, m.motorcycles?.model, m.motorcycles?.make]
            .some((v) => v?.toLowerCase().includes(q))) return false
        }
        return true
      })
      .sort((a, b) => {
        // Mapeamento hierárquico simples para a ordenação natural do risco
        const order: Record<MaintenanceStatus, number> = { overdue: 0, upcoming: 1, scheduled: 2, completed: 3 }
        return order[a._status!] - order[b._status!]
      })
  }, [withStatus, statusFilter, motorcycleFilter, typeFilter, searchQuery])

  /**
   * Computação da Estrutura Visual Principal: 
   * A lógica visual agrupa as manutenções pelo ID da moto pertencente (Sanfonas / Accordions).
   */
  const groupedByMoto = useMemo(() => {
    const map = new Map<string, { motorcycle_id: string; moto: MaintenanceWithMoto['motorcycles']; items: (MaintenanceWithMoto & { _status: MaintenanceStatus })[] }>()

    filtered.forEach((m) => {
      if (!map.has(m.motorcycle_id)) {
        map.set(m.motorcycle_id, { motorcycle_id: m.motorcycle_id, moto: m.motorcycles, items: [] })
      }
      map.get(m.motorcycle_id)!.items.push(m as MaintenanceWithMoto & { _status: MaintenanceStatus })
    })

    // Organiza também o layout raiz: Motos com falhas gravíssimas pulam pro topo e com 0 erro descem.
    return Array.from(map.values()).sort((a, b) => {
      const worst = (items: { _status: MaintenanceStatus }[]) =>
        items.some((i) => i._status === 'overdue') ? 0
        : items.some((i) => i._status === 'upcoming') ? 1
        : items.some((i) => i._status === 'scheduled') ? 2
        : 3
      return worst(a.items) - worst(b.items)
    })
  }, [filtered])

  /**
   * Computação de Estatísticas KPIs:
   * Separa quantidades totais em uma árvore concisa para uso rápido dos Cartões no Topo do painel.
   * Filtra também a string padrão ISO pelo mês vigente ("YYYY-MM") para rastrear o gasto estrito daquele mês.
   */
  const totals = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    return {
      overdue:   withStatus.filter((m) => m._status === 'overdue').length,
      upcoming:  withStatus.filter((m) => m._status === 'upcoming').length,
      scheduled: withStatus.filter((m) => m._status === 'scheduled').length,
      completed: withStatus.filter((m) => m._status === 'completed').length,
      costThisMonth: withStatus
        .filter((m) => m._status === 'completed' && m.completed_date?.startsWith(currentMonth))
        .reduce((acc, m) => acc + (m.cost ?? 0), 0),
    }
  }, [withStatus])

  /**
   * @constant tabs
   * @description Array iterável desenhado a partir dos totais que rende as "Pílulas" superiores que o usuário clica.
   */
  const tabs = useMemo(() => [
    { value: 'all',       label: 'Todas',      count: withStatus.length },
    { value: 'overdue',   label: 'Vencidas',   count: totals.overdue },
    { value: 'upcoming',  label: 'Próximas',   count: totals.upcoming },
    { value: 'scheduled', label: 'Agendadas',  count: totals.scheduled },
    { value: 'completed', label: 'Realizadas', count: totals.completed },
  ], [withStatus.length, totals])

  /**
   * @constant motorcycleSelectOptions
   * @description Derivado transformado apenas para se conectar na biblioteca de selects provendo o texto formatado no layout `{placa} - {marca} {modelo}`
   */
  const motorcycleSelectOptions = useMemo(() => [
    { value: '', label: 'Selecione a moto...' },
    ...motorcycles.map((m) => ({ value: m.id, label: `${m.license_plate} — ${m.make} ${m.model}` })),
  ], [motorcycles])

  // ─── HANDLERS DOS EVENTOS GLOBAIS ─────────────────────────────────────────

  /**
   * @function closeFormModal
   * @description Reset universal para os estados envolvidos em criação/edição. Zera o formulário para o default de novo.
   * Pré-condição: Formulário em modo popup ativo.
   * Efeitos colaterais: Remove target `editingMaintenance` e altera dados do form.
   */
  const closeFormModal = useCallback(() => {
    setIsFormModalOpen(false)
    setEditingMaintenance(null)
    setFormData(INITIAL_FORM)
  }, [])

  /**
   * @function closeDeleteModal
   * @description Cancelador gentil do pop-up de alerta de exclusão.
   */
  const closeDeleteModal = useCallback(() => {
    setIsDeleteModalOpen(false)
    setDeletingId(null)
  }, [])

  /**
   * @function closeCompleteModal
   * @description Reseta todos os estados do fluxo de conclusão para os valores iniciais.
   */
  const closeCompleteModal = useCallback(() => {
    setIsCompleteModalOpen(false)
    setCompletingMaintenance(null)
    setCompletionStep(1)
    setCompletionKm('')
    setCompletionWorkshop('Oficina do Careca')
    setCompletionObservations('')
    setCompletionDate(new Date().toISOString().split('T')[0])
    setCompletionExtras([])
    setCompletionAllSiblings([])
    setCompletionExtraIds([])
    setCompletionFinancials([])
    setActiveContract(null)
    setDiscountConfirmed(false)
    setShowPhotoWarning(false)
  }, [])

  /**
   * @function handleSave
   * @description Insere um novo registro ou atualiza uma manutenção existente no banco de dados, dependendo do modo ativo (criação ou edição).
   * Pré-condição: Validação de placa selecionada e de um texto no campo principal description.
   * Efeitos colaterais: Post de query e recarga com a lista repaginada pelo backend.
   */
  const handleSave = useCallback(async () => {
    if (!formData.motorcycle_id || !formData.description) {
      alert('Por favor, preencha a moto e a descrição.')
      return
    }
    setSaving(true)
    
    // Tratamos aqui conversões de tipos de Strings capturadas no HTML para Ints, Floats ou nulls para respeitar as chaves nativas postgres
    const payload = {
      motorcycle_id: formData.motorcycle_id,
      type: formData.type,
      description: formData.description,
      scheduled_date: formData.scheduled_date || null,
      actual_km: formData.actual_km ? parseInt(formData.actual_km, 10) : null,
      cost: formData.cost ? parseFloat(formData.cost) : null,
      completed: formData.completed,
      completed_date: formData.completed && formData.completed_date ? formData.completed_date : null,
      workshop: formData.workshop || null,
      observations: formData.observations || null,
    }
    try {
      if (editingMaintenance) {
        const { error } = await supabase.from('maintenances').update(payload).eq('id', editingMaintenance.id)
        if (error) { alert(`Erro ao atualizar: ${error.message}`); return }
      } else {
        const { error } = await supabase.from('maintenances').insert([payload])
        if (error) { alert(`Erro ao salvar: ${error.message}`); return }
      }
      closeFormModal()
      await fetchMaintenances()
    } catch (err) {
      console.error('[MANUTENCAO] handleSave error:', err)
    } finally {
      setSaving(false)
    }
  }, [formData, editingMaintenance, closeFormModal, fetchMaintenances])

  /**
   * @function handleDelete
   * @description Exclui permanentemente o registro da manutenção no banco de dados.
   * Pré-condição: ID já carregada na variável transitória do alerta de perigo.
   */
  const handleDelete = useCallback(async () => {
    if (!deletingId) return
    await supabase.from('maintenances').delete().eq('id', deletingId)
    closeDeleteModal()
    fetchMaintenances()
  }, [deletingId, closeDeleteModal, fetchMaintenances])

  /**
   * @function handleOpenComplete
   * @description Puxa dados de inteligência preparatória do fluxo avançado da "Etapa 1".
   * Aciona endpoints para descobrir o tipo contratual da moto engatando defaults amigáveis na finança e varre pendências adjacentes da motocicleta na oficina.
   * @param {MaintenanceWithMoto} maintenance - Entidade mãe selecionada via check.
   */
  const handleOpenComplete = useCallback(async (maintenance: MaintenanceWithMoto) => {
    setCompletingMaintenance(maintenance)
    setCompletionStep(1)
    setCompletionKm(maintenance.motorcycles?.km_current?.toString() ?? '')
    setCompletionWorkshop(maintenance.workshop || 'Oficina do Careca')
    setCompletionObservations(maintenance.observations || '')
    setCompletionDate(new Date().toISOString().split('T')[0])
    setCompletionExtraIds([])
    setCompletionFinancials([])
    setDiscountConfirmed(false)

    // Busca se existe contrato formal para a mesma moto
    const { data: contractData } = await supabase
      .from('contracts')
      .select('contract_type, next_billing_date, customers(name)')
      .eq('motorcycle_id', maintenance.motorcycle_id)
      .eq('status', 'active')
      .maybeSingle()

    // Associa os dados do contrato ativo para definir as regras de responsabilidade financeira
    if (contractData) {
      const customers = contractData.customers as unknown as { name: string } | null
      setActiveContract({
        type: (contractData.contract_type as 'rental' | 'promise') || 'rental',
        client_name: customers?.name || 'Cliente',
        next_billing_date: contractData.next_billing_date,
      })
    } else {
      setActiveContract(null)
    }

    // Busca irmãos (outros serviços parados) na MESMA moto.
    const { data: siblingsData } = await supabase
      .from('maintenances')
      .select('*, motorcycles(license_plate, model, make, km_current)')
      .eq('motorcycle_id', maintenance.motorcycle_id)
      .eq('completed', false)
      .neq('id', maintenance.id)

    // Revalida com o sistema se são ou não urgentes
    const allSiblings = ((siblingsData as MaintenanceWithMoto[]) || [])
      .map((s) => ({ ...s, _status: calcularStatus(s) }))

    // Filtra as manutenções pendentes (vencidas ou próximas) para sugerir realização conjunta
    const siblings = allSiblings.filter((s) => s._status === 'overdue' || s._status === 'upcoming')

    setCompletionAllSiblings(allSiblings)
    setCompletionExtras(siblings)
    setIsCompleteModalOpen(true)
  }, [])

  /**
   * @function handleConfirmComplete
   * @description Atualiza em lote os itens de manutenção concluídos e agenda automaticamente as próximas ocorrências com base nos intervalos padrão.
   * Efeitos colaterais: Executa updates nos registros selecionados, insere os próximos agendamentos calculados e sincroniza o odômetro da motocicleta no banco.
   */
  const handleConfirmComplete = useCallback(async () => {
    if (!completingMaintenance || !completionKm) return

    const missingPhotos = completionFinancials.some((f) => !f.odometer_photo_file && !f.invoice_photo_file)
    if (missingPhotos && completionObservations.trim().length < 30) {
      setShowPhotoWarning(true)
      return
    }

    setCompleting(true)
    try {
      const actualKm = parseInt(completionKm, 10)

      // Varredura para salvar a responsabilidade, fotos e custo individual
      for (let i = 0; i < completionFinancials.length; i++) {
        const fin = completionFinancials[i]
        const itemId = i === 0 ? completingMaintenance.id : completionExtraIds[i - 1]
        const odometerUrl = fin.odometer_photo_file
          ? await uploadMaintenanceFile(fin.odometer_photo_file, 'km')
          : null
        const invoiceUrl = fin.invoice_photo_file
          ? await uploadMaintenanceFile(fin.invoice_photo_file, 'nf')
          : null
        await supabase.from('maintenances').update({
          completed: true,
          completed_date: completionDate,
          actual_km: actualKm,
          cost: fin.cost ? parseFloat(fin.cost) : null,
          workshop: completionWorkshop || null,
          observations: completionObservations || null,
          responsibility: fin.responsibility,
          odometer_photo_url: odometerUrl,
          invoice_photo_url: invoiceUrl,
        }).eq('id', itemId)
      }

      // Fallback pra salvar manutenção em si caso não tenha havido etapa com grid preenchida
      if (completionFinancials.length === 0) {
        await supabase.from('maintenances').update({
          completed: true,
          completed_date: completionDate,
          actual_km: actualKm,
          workshop: completionWorkshop || null,
          observations: completionObservations || null,
        }).eq('id', completingMaintenance.id)
      }

      // Função de Auto-agendar (Gerar repetição no DB de consertos periódicos)
      const itemsToSchedule = [
        completingMaintenance,
        ...completionExtras.filter((e) => completionExtraIds.includes(e.id)),
      ]

      for (const item of itemsToSchedule) {
        const interval = getInterval(item.description)
        if (!interval) continue
        const next: Record<string, unknown> = {
          motorcycle_id: item.motorcycle_id,
          type: item.type,
          description: item.description,
          completed: false,
        }
        if (interval.interval_km) next.predicted_km = actualKm + interval.interval_km
        if (interval.interval_days) {
          const d = new Date(completionDate)
          d.setDate(d.getDate() + interval.interval_days)
          next.scheduled_date = d.toISOString().split('T')[0]
        }
        await supabase.from('maintenances').insert([next])
      }

      // Auto-corretor do Hodômetro da base das motocicletas baseado no que informaram. Nunca aceita medição que "diminui a KM", pois não faz sentido lógico e seria erro de form.
      const { data: motoData } = await supabase
        .from('motorcycles').select('km_current').eq('id', completingMaintenance.motorcycle_id).single()
      if (motoData && actualKm > (motoData.km_current || 0)) {
        await supabase.from('motorcycles').update({ km_current: actualKm }).eq('id', completingMaintenance.motorcycle_id)
      }

      closeCompleteModal()
      await Promise.all([fetchMaintenances(), fetchMotorcycles()])
    } catch {
    } finally {
      setCompleting(false)
    }
  }, [completingMaintenance, completionKm, completionDate, completionWorkshop, completionObservations, completionExtraIds, completionFinancials, completionExtras, closeCompleteModal, fetchMaintenances, fetchMotorcycles])

  /**
   * @function handleOpenEdit
   * @description Passa os valores conhecidos de volta às strings visuais do painel React permitindo Update manual do gestor.
   * @param {MaintenanceWithMoto} m - Dados pré-existentes.
   */
  const handleOpenEdit = useCallback((m: MaintenanceWithMoto) => {
    setEditingMaintenance(m)
    setFormData({
      motorcycle_id: m.motorcycle_id,
      type: m.type,
      description: m.description,
      scheduled_date: m.scheduled_date || '',
      actual_km: m.actual_km?.toString() || '',
      cost: m.cost?.toString() || '',
      completed: m.completed,
      completed_date: m.completed_date || '',
      workshop: m.workshop || '',
      observations: m.observations || '',
    })
    setIsFormModalOpen(true)
  }, [])

  /**
   * @function handleOpenDelete
   * @description Armazena Id e mostra janela modal de advertência.
   * @param {string} id - Id alocada pro banco excluir depois.
   */
  const handleOpenDelete = useCallback((id: string) => {
    setDeletingId(id)
    setIsDeleteModalOpen(true)
  }, [])

  /**
   * @function handleUpdateKm
   * @description Handler avulso utilitário focado só para o "Modal KM", ele poupa tempo de acessar os menus principais caso só falte alinhar o contador da moto.
   */
  const handleUpdateKm = useCallback(async () => {
    if (!kmForm.motorcycle_id || !kmForm.km_current) return
    await supabase.from('motorcycles')
      .update({ km_current: parseInt(kmForm.km_current, 10) })
      .eq('id', kmForm.motorcycle_id)
    setIsKmModalOpen(false)
    setKmForm({ motorcycle_id: '', km_current: '' })
    await Promise.all([fetchMaintenances(), fetchMotorcycles()])
  }, [kmForm, fetchMaintenances, fetchMotorcycles])

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">
      {/* ── CABEÇALHO GLOBAL ───────────────────────────────────────────────
          Renderiza título principal da rota do app e botões fixos de ação. */}
      <Header
        title="Manutenção"
        subtitle="Controle inteligente por km e data"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setKmForm({ motorcycle_id: '', km_current: '' }); setIsKmModalOpen(true) }}>
              <Gauge className="w-4 h-4" />
              Atualizar KM
            </Button>
            <Button variant="primary" onClick={() => { setEditingMaintenance(null); setFormData(INITIAL_FORM); setIsFormModalOpen(true) }}>
              <Plus className="w-4 h-4" />
              Nova Manutenção
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-5">

        {/* ── KPI CARDS ────────────────────────────────────────────────────────
            Mostram de forma gritante e quantitativa a soma situacional global.
            Usam das extrações do memo totals. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Vencidas</p>
              <p className="text-2xl font-bold text-[#ff9c9a]">{totals.overdue}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <AlertTriangle className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Próximas</p>
              <p className="text-2xl font-bold text-[#e65e24]">{totals.upcoming}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <Clock className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Agendadas</p>
              <p className="text-2xl font-bold text-[#a880ff]">{totals.scheduled}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <Wrench className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Realizadas mês</p>
              <p className="text-2xl font-bold text-[#229731]">{totals.completed}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <CheckCircle2 className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Custo do Mês</p>
              <p className="text-2xl font-bold text-[#f5f5f5]">{formatCurrency(totals.costThisMonth)}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <DollarSign className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>
        </div>

        {/* ── BARRA DE FERRAMENTAS DE FILTROS ──────────────────────────────────
            Oferece abas (Tabs) para visualizações pré-selecionadas e dropdowns + box textual para refinar com precisão uma busca por placa ou texto. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Abas e pílulas de status principais do sistema controladas no state de statusFilter */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  statusFilter === tab.value
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-[#616161]">({tab.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Filtros secundários: Motor, Tipo e Lupa de Texto livre que interagem com o memo 'filtered' */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={motorcycleFilter}
              onChange={(e) => setMotorcycleFilter(e.target.value)}
              className="h-10 rounded-full border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="">Todas as motos</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#202020]">
                  {m.license_plate} — {m.make} {m.model}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 rounded-full border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="all">Todos os tipos</option>
              <option value="preventive">Preventiva</option>
              <option value="corrective">Corretiva</option>
              <option value="inspection">Vistoria</option>
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 rounded-full border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-44"
              />
            </div>
          </div>
        </div>

        {/* ── TABELA AGRUPADA POR MOTO (ACCORDION) ──────────────────────────────
            Essa é a visualização mestre. Em vez de listas infinitas de problemas variados soltos, a visão aglomera a Moto. Isso ajuda o funcionário focar em qual moto levar no guincho hoje e o que resolver ao mesmo tempo com ela parada lá. */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : groupedByMoto.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Wrench className="mb-4 h-12 w-12 text-[#474747]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhuma manutenção encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou cadastre uma nova manutenção.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedByMoto.map(({ motorcycle_id, moto, items }) => {
              // Computação inline do render para decidir se mostra a tab direta da Moto só com histório concluído ou mixa pendência + histórico sanfona
              const showDirectCompleted = statusFilter === 'completed'
              const pending   = showDirectCompleted ? items : items.filter((i) => i._status !== 'completed')
              const completed = items.filter((i) => i._status === 'completed')

              const nOverdue  = pending.filter((i) => i._status === 'overdue').length
              const nUpcoming = pending.filter((i) => i._status === 'upcoming').length
              const nScheduled = pending.filter((i) => i._status === 'scheduled').length
              
              // Define o tom visual da luz/bolinha indicadora de gravidade na ponta esquerda do accordion com base no pior cenário retornado.
              const light = nOverdue > 0 ? 'red' : nUpcoming > 0 ? 'amber' : 'green'
              const isExpanded = !collapsedMotos.has(motorcycle_id)
              const showHist   = historyMotos.has(motorcycle_id)

              return (
                <div key={motorcycle_id} className="overflow-hidden rounded-xl bg-[#202020]">

                  {/* Cabeçalho Ativador (Chevron): Traz placa, modelo atualizado e contadores (bagdes) curtos de itens atrasados embutidos */}
                  <button
                    onClick={() => toggleMoto(motorcycle_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#323232] transition-colors text-left"
                  >
                    <ChevronDown className={`w-4 h-4 text-[#9e9e9e] shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      light === 'red' ? 'bg-[#ff3e3c]' : light === 'amber' ? 'bg-[#e65e24]' : 'bg-[#28b438]'
                    }`} />
                    <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">{moto?.license_plate}</span>
                    <span className="text-[13px] text-[#9e9e9e]">{moto?.make} {moto?.model}</span>
                    {moto?.km_current != null && (
                      <span className="text-[13px] text-[#616161]">· {fmtKm(moto.km_current)}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      {nOverdue > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#7c1c1c] text-[#ff9c9a]">
                          {nOverdue} vencida{nOverdue > 1 ? 's' : ''}
                        </span>
                      )}
                      {nUpcoming > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#3a180f] text-[#e65e24]">
                          {nUpcoming} próxima{nUpcoming > 1 ? 's' : ''}
                        </span>
                      )}
                      {nScheduled > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#2d0363] text-[#a880ff]">
                          {nScheduled} agendada{nScheduled > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Miolo do bloco sanfona que renderiza as tabelas quando ele está solto (not collapsed) */}
                  {isExpanded && (
                    <div className="border-t border-[#323232]">

                      {/* AREA 1: ITENS PENDENTES — Monta a tr de predição do odômetro. Se tiver em "Atrasada", "Proxima", ela cai aqui no loop da Moto */}
                      {pending.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                            <thead className="bg-[#323232]">
                              <tr>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Previsão</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Situação</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Status</th>
                                <th className="h-9 px-4 text-right text-[#9e9e9e] text-[13px] font-medium">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pending.map((item) => (
                                <tr key={item.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232]">
                                  <td className="px-4">
                                    <p className="font-medium text-[#f5f5f5] text-[13px]">
                                      {item.description}
                                      {(() => {
                                        const iv = getInterval(item.description)
                                        if (!iv) return null
                                        const hint = iv.interval_km
                                          ? `a cada ${iv.interval_km.toLocaleString('pt-BR')} km`
                                          : `a cada ${iv.interval_days} dias`
                                        return <span className="ml-1.5 text-[12px] font-light text-[#474747]">{hint}</span>
                                      })()}
                                    </p>
                                    <StatusBadge status={item.type} />
                                  </td>
                                  <td className="px-4">
                                    {item.predicted_km != null ? (
                                      <div>
                                        <p className="text-[#f5f5f5] text-[13px]">{fmtKm(item.predicted_km)}</p>
                                        <p className="text-[13px] text-[#616161]">Atual: {fmtKm(moto?.km_current ?? 0)}</p>
                                      </div>
                                    ) : item.scheduled_date ? (
                                      <p className="text-[#f5f5f5] text-[13px]">{formatDate(item.scheduled_date + 'T12:00:00')}</p>
                                    ) : <span className="text-[#9e9e9e] text-[13px]">—</span>}
                                  </td>
                                  <td className="px-4"><SituacaoCell m={item} /></td>
                                  <td className="px-4"><BadgeStatus status={item._status!} /></td>
                                  <td className="px-4 text-right">
                                    {/* Botões do Action principal controlando Modais CRUD e de Conclusão */}
                                    <div className="flex items-center justify-end gap-1">
                                      <Button variant="secondary" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenEdit(item)} title="Editar">
                                        <Edit2 className="h-4 w-4" />
                                      </Button>
                                      <Button variant="primary" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenComplete(item)} title="Registrar conclusão">
                                        <CheckCircle2 className="h-4 w-4" />
                                      </Button>
                                      <Button variant="danger" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenDelete(item.id)} title="Excluir">
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : !showDirectCompleted ? (
                        <p className="text-center text-[#616161] py-5 text-[13px]">Todas as manutenções em dia.</p>
                      ) : null}

                      {/* AREA 2: HISTÓRICO — Condição ativada apenas se o toggle primário estiver como view='completed'. Tabela escura/cinza sinaliza encerramentos e recibos */}
                      {showDirectCompleted && completed.length > 0 && pending.length === 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[13px]">
                            <tbody>
                              {completed.map((item) => (
                                <tr key={item.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232] opacity-80">
                                  <td className="px-4 w-64">
                                    <p className="text-[#f5f5f5] text-[13px]">{item.description}</p>
                                    <StatusBadge status={item.type} />
                                  </td>
                                  <td className="px-4 text-[#9e9e9e] text-[13px]">
                                    {item.actual_km ? <p>{fmtKm(item.actual_km)}</p> : null}
                                    {item.completed_date && <p className="text-[13px]">{formatDate(item.completed_date + 'T12:00:00')}</p>}
                                  </td>
                                  <td className="px-4 text-[13px] text-[#9e9e9e]">{item.workshop ?? '—'}</td>
                                  <td className="px-4">
                                    <div className="flex gap-1">
                                      {item.odometer_photo_url
                                        ? <a href={item.odometer_photo_url} target="_blank" rel="noreferrer" title="Ver foto do KM"><Camera className="w-4 h-4 text-[#229731] hover:text-[#BAFF1A] transition-colors cursor-pointer" /></a>
                                        : <Camera className="w-4 h-4 text-[#616161]" />}
                                      {item.invoice_photo_url
                                        ? <a href={item.invoice_photo_url} target="_blank" rel="noreferrer" title="Ver nota fiscal"><FileText className="w-4 h-4 text-[#229731] hover:text-[#BAFF1A] transition-colors cursor-pointer" /></a>
                                        : <FileText className="w-4 h-4 text-[#616161]" />}
                                    </div>
                                  </td>
                                  <td className="px-4 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Visualizar" onClick={() => setViewingMaintenance(item)}><Eye className="h-4 w-4" /></Button>
                                      <Button variant="danger" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenDelete(item.id)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* AREA 3: HISTÓRICO COLAPSÁVEL — Condição onde a view normal é mista, mas exibe-se um botão que baixa uma gaveta extra exibindo o passivo da moto. */}
                      {!showDirectCompleted && completed.length > 0 && (
                        <div className={pending.length > 0 ? 'border-t border-[#323232]' : ''}>
                          <button
                            onClick={() => toggleHistory(motorcycle_id)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform ${showHist ? '' : '-rotate-90'}`} />
                            {showHist
                              ? 'Ocultar histórico'
                              : `Ver histórico (${completed.length} realizada${completed.length > 1 ? 's' : ''})`}
                          </button>

                          {showHist && (
                            <div className="border-t border-[#323232] overflow-x-auto">
                              <table className="w-full text-left text-[13px]">
                                <tbody>
                                  {/* Limitamos histórico colapsado com "slice" pra não afogar interface */}
                                  {completed.slice(0, 5).map((item) => (
                                    <tr key={item.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232] opacity-70">
                                      <td className="px-4 w-64">
                                        <p className="text-[#f5f5f5] text-[13px]">{item.description}</p>
                                        <StatusBadge status={item.type} />
                                      </td>
                                      <td className="px-4 text-[#9e9e9e] text-[13px]">
                                        {item.actual_km ? <p>{fmtKm(item.actual_km)}</p> : null}
                                        {item.completed_date && <p className="text-[13px]">{formatDate(item.completed_date + 'T12:00:00')}</p>}
                                      </td>
                                      <td className="px-4 text-[13px] text-[#9e9e9e]">{item.workshop ?? '—'}</td>
                                      <td className="px-4">
                                        <div className="flex gap-1">
                                          {item.odometer_photo_url
                                            ? <a href={item.odometer_photo_url} target="_blank" rel="noreferrer" title="Ver foto do KM"><Camera className="w-4 h-4 text-[#229731] hover:text-[#BAFF1A] transition-colors cursor-pointer" /></a>
                                            : <Camera className="w-4 h-4 text-[#616161]" />}
                                          {item.invoice_photo_url
                                            ? <a href={item.invoice_photo_url} target="_blank" rel="noreferrer" title="Ver nota fiscal"><FileText className="w-4 h-4 text-[#229731] hover:text-[#BAFF1A] transition-colors cursor-pointer" /></a>
                                            : <FileText className="w-4 h-4 text-[#616161]" />}
                                        </div>
                                      </td>
                                      <td className="px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Visualizar" onClick={() => setViewingMaintenance(item)}><Eye className="h-4 w-4" /></Button>
                                          <Button variant="danger" size="sm" className="h-8 w-8 p-0" onClick={() => handleOpenDelete(item.id)}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ===================================================================
          MODAIS E DIÁLOGOS DE SUPERPOSIÇÃO
          =================================================================== */}

      {/* MODAL 1: FORMULÁRIO DE NOVA / EDITAR MANUTENÇÃO (CRUD PURO) */}
      <Modal open={isFormModalOpen} onClose={closeFormModal} title={editingMaintenance ? 'Editar Manutenção' : 'Nova Manutenção'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select
              label="Motocicleta *"
              value={formData.motorcycle_id}
              onChange={(e) => setFormData({ ...formData, motorcycle_id: e.target.value })}
              options={motorcycleSelectOptions}
            />
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-[#9e9e9e]">Tipo</label>
              <div className="flex h-10 items-center rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#616161] cursor-not-allowed">
                {editingMaintenance ? TYPE_LABEL_MAP[formData.type] || formData.type : 'Corretiva'}
              </div>
            </div>
            <div className="md:col-span-2">
              <Input
                label="Descrição *"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Ex: Troca do cabo do freio..."
              />
            </div>
            <Input label="Data Agendada" type="date" value={formData.scheduled_date} onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} />
            <Input label="KM no Serviço" type="number" value={formData.actual_km} onChange={(e) => setFormData({ ...formData, actual_km: e.target.value })} placeholder="Ex: 15500" />
            <Input label="Custo (R$)" type="number" step="0.01" value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} placeholder="0.00" />
            <Input label="Oficina / Mecânico" value={formData.workshop} onChange={(e) => setFormData({ ...formData, workshop: e.target.value })} />
            {formData.completed && (
              <Input label="Data de Conclusão" type="date" value={formData.completed_date} onChange={(e) => setFormData({ ...formData, completed_date: e.target.value })} />
            )}
          </div>
          <Textarea label="Observações" value={formData.observations} onChange={(e) => setFormData({ ...formData, observations: e.target.value })} rows={2} />
          <label className="flex w-max cursor-pointer items-center gap-2 text-[13px] text-[#f5f5f5]">
            <input
              type="checkbox"
              checked={formData.completed}
              onChange={(e) => setFormData({ ...formData, completed: e.target.checked, completed_date: e.target.checked ? new Date().toISOString().split('T')[0] : '' })}
              className="h-4 w-4 rounded border-[#474747] accent-[#BAFF1A]"
            />
            Marcar como concluída
          </label>
          <div className="flex justify-end gap-3 border-t border-[#323232] pt-4">
            <Button variant="secondary" onClick={closeFormModal}>Cancelar</Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* MODAL DE VISUALIZAÇÃO — Leitura somente de manutenções realizadas */}
      <Modal open={!!viewingMaintenance} onClose={() => setViewingMaintenance(null)} title="Detalhes da Manutenção" size="lg">
        {viewingMaintenance && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">Motocicleta</p>
                <p className="text-[13px] text-[#f5f5f5]">
                  {viewingMaintenance.motorcycles
                    ? `${viewingMaintenance.motorcycles.license_plate} — ${viewingMaintenance.motorcycles.make} ${viewingMaintenance.motorcycles.model}`
                    : '—'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">Tipo</p>
                <p className="text-[13px] text-[#f5f5f5]">{TYPE_LABEL_MAP[viewingMaintenance.type] ?? viewingMaintenance.type}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">Descrição</p>
                <p className="text-[13px] text-[#f5f5f5]">{viewingMaintenance.description ?? '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">Data de Conclusão</p>
                <p className="text-[13px] text-[#f5f5f5]">
                  {viewingMaintenance.completed_date ? formatDate(viewingMaintenance.completed_date + 'T12:00:00') : '—'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">KM no Serviço</p>
                <p className="text-[13px] text-[#f5f5f5]">{viewingMaintenance.actual_km ? fmtKm(viewingMaintenance.actual_km) : '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] text-[#9e9e9e]">Oficina / Mecânico</p>
                <p className="text-[13px] text-[#f5f5f5]">{viewingMaintenance.workshop ?? '—'}</p>
              </div>
              {viewingMaintenance.cost != null && (
                <div className="col-span-2 rounded-xl bg-[#121212] p-4 space-y-2">
                  <p className="text-[12px] text-[#9e9e9e]">Custo</p>
                  {(() => {
                    const c = viewingMaintenance.cost!
                    const resp = viewingMaintenance.responsibility
                    const empresa = resp === 'company' ? c : resp === 'split' ? c / 2 : 0
                    const cliente = resp === 'customer' ? c : resp === 'split' ? c / 2 : 0
                    return (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[13px]">
                          <span className="text-[#9e9e9e]">Total</span>
                          <span className="font-medium text-[#f5f5f5]">{formatCurrency(c)}</span>
                        </div>
                        {empresa > 0 && (
                          <div className="flex justify-between text-[13px]">
                            <span className="text-[#9e9e9e]">Empresa</span>
                            <span className="text-[#229731]">{formatCurrency(empresa)}</span>
                          </div>
                        )}
                        {cliente > 0 && (
                          <div className="flex justify-between text-[13px]">
                            <span className="text-[#9e9e9e]">Cliente</span>
                            <span className="text-[#ff9c9a]">{formatCurrency(cliente)}</span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
              {viewingMaintenance.observations && (
                <div className="col-span-2 space-y-1">
                  <p className="text-[12px] text-[#9e9e9e]">Observações</p>
                  <p className="text-[13px] text-[#f5f5f5]">{viewingMaintenance.observations}</p>
                </div>
              )}
            </div>

            {/* Miniaturas das fotos */}
            <div className="border-t border-[#323232] pt-4 space-y-3">
              <p className="text-[12px] text-[#9e9e9e]">Fotos anexadas</p>
              <div className="grid grid-cols-2 gap-3">
                {/* KM */}
                {viewingMaintenance.odometer_photo_url ? (
                  <a href={viewingMaintenance.odometer_photo_url} target="_blank" rel="noreferrer" className="group space-y-1.5">
                    <div className="relative overflow-hidden rounded-lg border border-[#323232] bg-[#121212] h-40">
                      <img
                        src={viewingMaintenance.odometer_photo_url}
                        alt="Foto do KM"
                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                        <Eye className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    <p className="text-[12px] text-[#9e9e9e] flex items-center gap-1"><Camera className="w-3 h-3" /> Foto do KM</p>
                  </a>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-[#323232] bg-[#121212] h-40">
                      <div className="text-center space-y-1">
                        <Camera className="w-6 h-6 text-[#474747] mx-auto" />
                        <p className="text-[12px] text-[#474747]">Sem foto do KM</p>
                      </div>
                    </div>
                  </div>
                )}
                {/* NF */}
                {viewingMaintenance.invoice_photo_url ? (
                  <a href={viewingMaintenance.invoice_photo_url} target="_blank" rel="noreferrer" className="group space-y-1.5">
                    <div className="relative overflow-hidden rounded-lg border border-[#323232] bg-[#121212] h-40">
                      <img
                        src={viewingMaintenance.invoice_photo_url}
                        alt="Nota Fiscal"
                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                        <Eye className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    <p className="text-[12px] text-[#9e9e9e] flex items-center gap-1"><FileText className="w-3 h-3" /> Nota Fiscal</p>
                  </a>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-center rounded-lg border border-dashed border-[#323232] bg-[#121212] h-40">
                      <div className="text-center space-y-1">
                        <FileText className="w-6 h-6 text-[#474747] mx-auto" />
                        <p className="text-[12px] text-[#474747]">Sem nota fiscal</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-[#323232] pt-4">
              <Button variant="secondary" onClick={() => setViewingMaintenance(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL 2: FLUXO INTELIGENTE — REGISTRO ASSISTIDO DE CONCLUSÃO */}
      <Modal
        open={isCompleteModalOpen}
        onClose={closeCompleteModal}
        title={completionStep === 1 ? 'Registrar Conclusão — Etapa 1 de 2' : 'Registrar Conclusão — Etapa 2 de 2'}
        size="lg"
      >
        {completingMaintenance && (
          <div className="space-y-4">

            {/* Quadro superior exibe metadados de leitura rápida sobre a ação sendo despachada */}
            <div className="rounded-xl bg-[#121212] px-4 py-3 space-y-1">
              <p className="text-[13px] font-medium text-[#f5f5f5]">{completingMaintenance.description}</p>
              <p className="text-[13px] text-[#9e9e9e]">
                {completingMaintenance.motorcycles
                  ? `${completingMaintenance.motorcycles.license_plate} — ${completingMaintenance.motorcycles.make} ${completingMaintenance.motorcycles.model}`
                  : '—'}
              </p>
              {completingMaintenance.predicted_km != null && (
                <p className="text-[13px] text-[#e65e24]">KM previsto: {fmtKm(completingMaintenance.predicted_km)}</p>
              )}
              {completingMaintenance.scheduled_date && (
                <p className="text-[13px] text-[#e65e24]">Data prevista: {formatDate(completingMaintenance.scheduled_date + 'T12:00:00')}</p>
              )}
            </div>

            {/* ── ETAPA 1 ── Coleta Base (KM e Data). Mostra previsão instantânea do impacto no futuro das peças consertadas. */}
            {completionStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input label="KM do Odômetro *" type="number" value={completionKm} onChange={(e) => setCompletionKm(e.target.value)} placeholder="Ex: 15500" />
                  <Input label="Data de Conclusão *" type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
                  <div className="md:col-span-2">
                    <Input label="Oficina / Mecânico" value={completionWorkshop} onChange={(e) => setCompletionWorkshop(e.target.value)} />
                  </div>
                </div>
                <Textarea label="Observações" value={completionObservations} onChange={(e) => setCompletionObservations(e.target.value)} rows={2} />

                {/* Bloco Dinâmico: Timeline Preview das próximas manutenções combinadas calculadas (itens marcados agora e itens já aguardando). */}
                {(() => {
                  if (!completionKm) {
                    return (
                      <div className="flex items-center gap-2 rounded-xl bg-[#202020] px-4 py-2 text-[#9e9e9e]">
                        <Info className="h-4 w-4 shrink-0" />
                        <span className="text-[13px]">Preencha o KM acima para ver a estimativa da próxima manutenção.</span>
                      </div>
                    )
                  }
                  const km = parseInt(completionKm, 10)
                  if (isNaN(km)) return null

                  const completingItems = [
                    completingMaintenance,
                    ...completionExtras.filter((e) => completionExtraIds.includes(e.id)),
                  ]
                  const completingIds = new Set(completingItems.map((i) => i.id))

                  type NextItem = { description: string; sortKm: number; label: string }

                  // Mapeia novas provisões que o sistema fará automaticamente a partir deste conserto caso exista um intervalo padrão de reincidência na tabela STANDARD_INTERVALS
                  const fromCompleting: NextItem[] = completingItems
                    .map((item): NextItem | null => {
                      const interval = getInterval(item.description)
                      if (!interval) return null
                      const parts: string[] = []
                      let sortKm = Infinity
                      if (interval.interval_km) {
                        const nextKm = km + interval.interval_km
                        const weeksEst = Math.round(interval.interval_km / KM_POR_DIA / 7)
                        parts.push(`${nextKm.toLocaleString('pt-BR')} km (~${weeksEst} sem.)`)
                        sortKm = nextKm
                      }
                      if (interval.interval_days) {
                        parts.push(`~${Math.round(interval.interval_days / 7)} semanas`)
                        if (sortKm === Infinity) sortKm = km + interval.interval_days * KM_POR_DIA
                      }
                      return { description: item.description, sortKm, label: parts.join(' / ') }
                    })
                    .filter((x): x is NextItem => x !== null)

                  // Mapeia irmãos já abertos que permanecem pedindo conserto (para consolidar cronologia comparada)
                  const fromOthers: NextItem[] = completionAllSiblings
                    .filter((s) => !completingIds.has(s.id))
                    .map((s): NextItem | null => {
                      if (s.predicted_km != null) {
                        const remaining = s.predicted_km - km
                        const label = remaining > 0
                          ? `${s.predicted_km.toLocaleString('pt-BR')} km (faltam ${remaining.toLocaleString('pt-BR')} km)`
                          : `${s.predicted_km.toLocaleString('pt-BR')} km (vencida)`
                        return { description: s.description, sortKm: s.predicted_km, label }
                      }
                      if (s.scheduled_date) {
                        const due = new Date(s.scheduled_date + 'T12:00:00')
                        const daysLeft = Math.round((due.getTime() - Date.now()) / 86400000)
                        const label = daysLeft > 0 ? `${formatDate(s.scheduled_date + 'T12:00:00')} (em ${daysLeft} dias)` : `${formatDate(s.scheduled_date + 'T12:00:00')} (vencida)`
                        return { description: s.description, sortKm: km + Math.max(0, daysLeft) * KM_POR_DIA, label }
                      }
                      return null
                    })
                    .filter((x): x is NextItem => x !== null)

                  const nextItems = [...fromCompleting, ...fromOthers]
                    .sort((a, b) => a.sortKm - b.sortKm)

                  if (nextItems.length === 0) return null

                  return (
                    <div className="rounded-xl border border-[#154f1d] bg-[#0e2f13] px-4 py-3 space-y-2">
                      <p className="text-[13px] font-medium text-[#229731]">
                        Próximas manutenções agendadas
                      </p>
                      {nextItems.map((item, idx) => (
                        <div key={item.description} className="flex items-center justify-between gap-4">
                          <span className={`text-[13px] ${idx === 0 ? 'font-medium text-[#f5f5f5]' : 'text-[#9e9e9e]'}`}>
                            {idx === 0 && <span className="mr-1 text-[#229731]">↑</span>}
                            {item.description}
                          </span>
                          <span className={`text-[13px] whitespace-nowrap ${idx === 0 ? 'font-medium text-[#229731]' : 'text-[#616161]'}`}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                      <p className="text-[13px] text-[#229731] border-t border-[#154f1d] pt-2">
                        Próxima ida à oficina: {nextItems[0].description}
                      </p>
                    </div>
                  )
                })()}

                {/* Sugestão de Cross-sell Inteligente — se tem item vencido ou muito na beira na mesma moto, incentiva já marcar o checkbox e emendar o reparo de uma vez */}
                {completionExtras.length > 0 && (() => {
                  const hasOverdue = completionExtras.some((e) => e._status === 'overdue')

                  return (
                    <div className="rounded-xl border border-[#e65e24] bg-[#3a180f] px-4 py-3 space-y-2">
                      <p className="text-[13px] font-medium text-[#e65e24]">
                        {hasOverdue
                          ? 'Atenção — itens vencidos desta moto (aproveite a ida à oficina):'
                          : 'Quase na hora — itens próximos do prazo desta moto:'}
                      </p>
                      {completionExtras.map((extra) => {
                        const isOverdue = extra._status === 'overdue'
                        const kmLeft = diffKm(extra)
                        const daysLeft = diffDias(extra)

                        return (
                          <label key={extra.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={completionExtraIds.includes(extra.id)}
                              onChange={(e) => {
                                if (e.target.checked) setCompletionExtraIds((prev) => [...prev, extra.id])
                                else setCompletionExtraIds((prev) => prev.filter((id) => id !== extra.id))
                              }}
                              className="h-4 w-4 rounded border-[#474747] bg-[#121212] accent-[#e65e24]"
                            />
                            <span className="text-[13px] text-[#f5f5f5]">{extra.description}</span>
                            {extra.predicted_km != null && (
                              <span className={`text-[13px] ${isOverdue ? 'text-[#ff9c9a]' : 'text-[#e65e24]'}`}>
                                {isOverdue
                                  ? 'VENCIDA'
                                  : kmLeft !== null ? `faltam ${fmtKm(kmLeft)}` : ''}
                              </span>
                            )}
                            {extra.predicted_km == null && extra.scheduled_date && (
                              <span className={`text-[13px] ${isOverdue ? 'text-[#ff9c9a]' : 'text-[#e65e24]'}`}>
                                {isOverdue
                                  ? 'VENCIDA'
                                  : daysLeft !== null ? `${daysLeft} dias` : ''}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )
                })()}

                <div className="flex justify-end gap-3 border-t border-[#323232] pt-4">
                  <Button variant="secondary" onClick={closeCompleteModal}>Cancelar</Button>
                  {/* Botão de Avanço, compila a matriz de finanças inicial antes de renderizar a Tela 2 */}
                  <Button
                    variant="primary"
                    disabled={!completionKm || !completionDate}
                    onClick={() => {
                      const allItems = [
                        completingMaintenance,
                        ...completionExtras.filter((e) => completionExtraIds.includes(e.id)),
                      ]
                      setCompletionFinancials(allItems.map((item) => ({
                        id: item.id,
                        description: item.description,
                        cost: '',
                        responsibility: 'split' as Responsibility,
                        has_odometer_photo: false,
                        has_invoice_photo: false,
                        odometer_photo_file: null,
                        invoice_photo_file: null,
                      })))
                      setCompletionStep(2)
                    }}
                  >
                    Próximo →
                  </Button>
                </div>
              </div>
            )}

            {/* ── ETAPA 2 ── Bloco financeiro: Lança quem paga o conserto, os custos brutos e as confirmações de anexos por cada serviço marcado. */}
            {completionStep === 2 && (
              <div className="space-y-4">
                <p className="text-[13px] text-[#9e9e9e]">Preencha o custo e o responsável por cada item:</p>

                <div className="space-y-3">
                  {completionFinancials.map((fin, idx) => (
                    <div key={fin.id} className="rounded-xl bg-[#121212] p-4 space-y-3">
                      <p className="text-[13px] font-medium text-[#f5f5f5]">{fin.description}</p>

                      {/* Toggle de Responsabilidade e Custos (Split, Company, Customer) */}
                      <div className="flex flex-wrap gap-2">
                        {(['split', 'company', 'customer'] as Responsibility[]).map((resp) => (
                          <button
                            key={resp}
                            type="button"
                            onClick={() => setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, responsibility: resp } : f))}
                            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                              fin.responsibility === resp
                                ? resp === 'split' ? 'bg-[#2d0363] text-[#a880ff]'
                                  : resp === 'company' ? 'bg-[#0e2f13] text-[#229731]'
                                  : 'bg-[#7c1c1c] text-[#ff9c9a]'
                                : 'bg-[#323232] text-[#9e9e9e] hover:bg-[#474747]'
                            }`}
                          >
                            {resp === 'split' ? '50/50' : resp === 'company' ? 'Empresa' : 'Cliente'}
                          </button>
                        ))}
                        <span className="text-[13px] text-[#616161] self-center">
                          {fin.responsibility === 'split' && 'Custo dividido entre empresa e cliente.'}
                          {fin.responsibility === 'company' && 'Sairá do caixa da empresa.'}
                          {fin.responsibility === 'customer' && 'Cliente pagou — lançado em Despesas.'}
                        </span>
                      </div>

                      <Input
                        label="Custo (R$)"
                        type="number"
                        step="0.01"
                        value={fin.cost}
                        onChange={(e) => setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, cost: e.target.value } : f))}
                        placeholder="0.00"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[13px] text-[#f5f5f5]">
                            Foto do KM <span className="text-[#9e9e9e] text-[12px]">(imagem)</span>
                          </label>
                          <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${fin.odometer_photo_file ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'}`}>
                            <Camera className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                            <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                              {fin.odometer_photo_file ? fin.odometer_photo_file.name : 'Nenhum arquivo selecionado'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null
                                setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, odometer_photo_file: file, has_odometer_photo: !!file } : f))
                              }}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[13px] text-[#f5f5f5]">
                            Nota Fiscal <span className="text-[#9e9e9e] text-[12px]">(imagem)</span>
                          </label>
                          <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${fin.invoice_photo_file ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'}`}>
                            <FileText className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                            <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                              {fin.invoice_photo_file ? fin.invoice_photo_file.name : 'Nenhum arquivo selecionado'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null
                                setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, invoice_photo_file: file, has_invoice_photo: !!file } : f))
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {fin.cost && parseFloat(fin.cost) > 0 && (
                        <p className="text-[13px] text-[#9e9e9e] border-t border-[#323232] pt-2">
                          {fin.responsibility === 'company' && `→ Despesas da empresa: ${formatCurrency(parseFloat(fin.cost))}`}
                          {fin.responsibility === 'customer' && `→ Pago pelo cliente: ${formatCurrency(parseFloat(fin.cost))}`}
                          {fin.responsibility === 'split' && `→ Empresa: ${formatCurrency(parseFloat(fin.cost) / 2)} / Cliente: ${formatCurrency(parseFloat(fin.cost) / 2)}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Resumo financeiro consolidado gerando o DRE micro da operação do dia para a interface */}
                {(() => {
                  const totalEmpresa = completionFinancials.reduce((acc, f) => {
                    const c = parseFloat(f.cost) || 0
                    return acc + (f.responsibility === 'company' ? c : f.responsibility === 'split' ? c / 2 : 0)
                  }, 0)
                  const totalCliente = completionFinancials.reduce((acc, f) => {
                    const c = parseFloat(f.cost) || 0
                    return acc + (f.responsibility === 'customer' ? c : f.responsibility === 'split' ? c / 2 : 0)
                  }, 0)
                  const hasSplit = completionFinancials.some((f) => f.responsibility === 'split')

                  return (
                    <div className="rounded-xl bg-[#202020] p-4 space-y-2">
                      <p className="text-[13px] text-[#9e9e9e]">Resumo Financeiro</p>
                      <div className="flex justify-between text-[13px]">
                        <span className="text-[#f5f5f5]">Despesa da empresa</span>
                        <span className="font-medium text-[#229731]">{formatCurrency(totalEmpresa)}</span>
                      </div>
                      {totalCliente > 0 && (
                        <div className="flex justify-between text-[13px]">
                          <span className="text-[#f5f5f5]">Pago pelo cliente</span>
                          <span className="font-medium text-[#ff9c9a]">{formatCurrency(totalCliente)}</span>
                        </div>
                      )}
                      {/* Checkbox de responsabilidade exigindo o ciente que isso afeta o boleto mensal de aluguel ou compra de quem detém a moto. */}
                      {hasSplit && activeContract && totalCliente > 0 && (
                        <label className="flex items-start gap-2 cursor-pointer mt-2 pt-2 border-t border-[#323232]">
                          <input
                            type="checkbox"
                            checked={discountConfirmed}
                            onChange={(e) => setDiscountConfirmed(e.target.checked)}
                            className="h-4 w-4 mt-0.5 rounded border-[#474747] bg-[#121212] accent-[#BAFF1A]"
                          />
                          <span className="text-[13px] text-[#9e9e9e]">
                            Confirmo que será cobrado desconto de {formatCurrency(totalCliente)} para {activeContract.client_name}
                            {activeContract.next_billing_date ? ` na cobrança de ${formatDate(activeContract.next_billing_date + 'T12:00:00')}` : ''}
                          </span>
                        </label>
                      )}
                    </div>
                  )
                })()}

                {showPhotoWarning && (
                  <div className="rounded-xl border border-[#e65e24]/40 bg-[#e65e24]/10 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-[#e65e24] shrink-0 mt-0.5" />
                      <p className="text-[13px] text-[#e65e24]">
                        Existem itens sem fotos anexadas. A manutenção ficará com pendências de comprovação.
                        Preencha as observações para continuar mesmo assim.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Textarea
                        label="Observações (obrigatório)"
                        value={completionObservations}
                        onChange={(e) => { setCompletionObservations(e.target.value) }}
                        rows={2}
                        placeholder="Descreva o motivo da ausência das fotos..."
                      />
                      <p className={`text-[12px] text-right ${completionObservations.trim().length >= 30 ? 'text-[#229731]' : 'text-[#9e9e9e]'}`}>
                        {completionObservations.trim().length}/30 caracteres mínimos
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-3 border-t border-[#323232] pt-4">
                  <Button variant="secondary" onClick={() => setCompletionStep(1)}>← Voltar</Button>
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={closeCompleteModal}>Cancelar</Button>
                    <Button
                      variant="primary"
                      onClick={handleConfirmComplete}
                      loading={completing}
                      disabled={showPhotoWarning && completionObservations.trim().length < 30}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Confirmar Conclusão
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL 3: ATALHO DE KM — Utilizado estritamente para consertar métricas de motos fora da oficina. */}
      <Modal open={isKmModalOpen} onClose={() => setIsKmModalOpen(false)} title="Atualizar KM da Moto" size="sm">
        <div className="space-y-4">
          <Select
            label="Moto *"
            value={kmForm.motorcycle_id}
            onChange={(e) => {
              const moto = motorcycles.find((m) => m.id === e.target.value)
              setKmForm({ motorcycle_id: e.target.value, km_current: moto?.km_current?.toString() ?? '' })
            }}
            options={motorcycleSelectOptions}
          />
          {kmForm.motorcycle_id && (
            <p className="text-[13px] text-[#9e9e9e]">
              KM atual: <span className="text-[#f5f5f5] font-medium">
                {fmtKm(motorcycles.find((m) => m.id === kmForm.motorcycle_id)?.km_current ?? 0)}
              </span>
            </p>
          )}
          <Input
            label="Novo KM *"
            type="number"
            value={kmForm.km_current}
            onChange={(e) => setKmForm({ ...kmForm, km_current: e.target.value })}
            placeholder="Ex: 16500"
          />
          <div className="flex justify-end gap-3 border-t border-[#323232] pt-4">
            <Button variant="secondary" onClick={() => setIsKmModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={handleUpdateKm} disabled={!kmForm.motorcycle_id || !kmForm.km_current}>
              <Gauge className="w-4 h-4" />
              Atualizar
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL 4: CONFIRMAÇÃO DE DELEÇÃO — Impede cliques acidentais de destruirem histórico da base. */}
      <Modal open={isDeleteModalOpen} onClose={closeDeleteModal} title="Confirmar Exclusão" size="sm">
        <div className="space-y-4">
          <p className="text-[13px] text-[#f5f5f5]">Tem certeza que deseja excluir esta manutenção? Esta ação não pode ser desfeita.</p>
          <div className="flex justify-end gap-3 border-t border-[#323232] pt-4">
            <Button variant="secondary" onClick={closeDeleteModal}>Cancelar</Button>
            <Button variant="danger" onClick={handleDelete}>Excluir</Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
