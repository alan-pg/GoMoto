'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, Wrench, CheckCircle2, AlertTriangle, Clock, Trash2, Edit2, Eye,
  Search, Camera, FileText, Gauge, Info, DollarSign, X,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  useMaintenances,
  useMotorcycles,
  useMaintenancePlans,
  useSupabaseContext,
} from '@gomoto/data'
import {
  uploadMaintenancePhoto,
  createMaintenance,
  updateMaintenance,
  deleteMaintenance,
  updateMotorcycleKm,
} from './actions'
import type { Maintenance, MaintenanceStatus } from '@gomoto/core'
import {
  KM_POR_DIA,
  calculateMaintenanceStatus,
  calculateNextMaintenance,
  findSuggestedItemByDescription,
} from '@gomoto/core'

import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Header } from '@/components/layout/Header'

// ─── TIPOS ──────────────────────────────────────────────────────────────────

/**
 * @type ItemFinancial
 * @description Estrutura de dados que armazena os detalhes financeiros de um item de manutenção na etapa de conclusão.
 * Por que existe: Permite capturar o custo individual de múltiplos itens, o executor (quem leva à oficina) e o rateio percentual do pagamento entre empresa e cliente (PRD 0003 D4).
 * Onde é usado: No estado `completionFinancials` para controlar o formulário financeiro da segunda etapa da conclusão de manutenção.
 */
type ItemFinancial = {
  id: string
  description: string
  cost: string
  /** PRD 0003 D4 — snapshot binário de quem leva à oficina. */
  executor: 'company' | 'customer'
  /** PRD 0003 D4 — % do custo arcado pelo cliente (0–100); empresa = 100 − cliente. */
  customer_payer_pct: number
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
  motorcycle: {
    id: string
    license_plate: string
    model: string
    make: string
    km_current: number
    maintenance_plan_id?: string | null
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
  // `mode` define se o form é agendamento puro ou registro retroativo de
  // execução. Mapeia 1:1 para `completed` na hora do save — mas dirige a UI:
  // 'scheduled' mostra só campos-gatilho (KM previsto / data agendada);
  // 'executed' mostra campos de realização (KM serviço, custo, fotos, etc).
  mode: 'scheduled' | 'executed'
  scheduled_date: string
  predicted_km: string
  actual_km: string
  cost: string
  completed_date: string
  workshop: string
  observations: string
  effective_executor: 'company' | 'customer'
  customer_payer_pct: number
  odometer_photo_file: File | null
  invoice_photo_file: File | null
}

// ─── CONSTANTES ─────────────────────────────────────────────────────────────

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
  mode: 'scheduled',
  scheduled_date: '',
  predicted_km: '',
  actual_km: '',
  cost: '',
  completed_date: '',
  workshop: 'Oficina do Careca',
  observations: '',
  effective_executor: 'company',
  customer_payer_pct: 0,
  odometer_photo_file: null,
  invoice_photo_file: null,
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
  return m.predicted_km - (m.motorcycle?.km_current ?? 0)
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
 * Adapter local: `MaintenanceWithMoto` carrega a moto joinada do select do Supabase;
 * o `calculateMaintenanceStatus` do core espera apenas `current_km` plano. Esta função
 * só faz o mapeamento — toda regra de threshold e classificação mora em @gomoto/core.
 *
 * **F1.5/PRD 0003**: enquanto não há `plan_item_id` em manutenções legadas, usamos
 * o helper `findSuggestedItemByDescription` para resolver intervalo a partir da
 * descrição. Quando F2 backfillar o vínculo, o lookup vai vir direto do plano.
 */
function calcularStatus(m: MaintenanceWithMoto): MaintenanceStatus {
  const suggested = findSuggestedItemByDescription(m.description)
  return calculateMaintenanceStatus({
    completed: m.completed,
    predicted_km: m.predicted_km,
    scheduled_date: m.scheduled_date,
    current_km: m.motorcycle?.km_current ?? 0,
    interval_km: suggested?.interval_km,
    interval_days: suggested?.interval_days,
  })
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
  const supabase = useSupabaseContext()
  const queryClient = useQueryClient()
  const maintenancesQuery = useMaintenances()
  const motorcyclesQuery = useMotorcycles()
  const plansQuery = useMaintenancePlans()
  const maintenances = (maintenancesQuery.data ?? []) as MaintenanceWithMoto[]
  const motorcycles = (motorcyclesQuery.data ?? []) as MotorcycleOption[]
  const plans = plansQuery.data ?? []
  const loading = maintenancesQuery.isLoading || motorcyclesQuery.isLoading

  const invalidateMaintenances = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['maintenances'] }),
    [queryClient],
  )
  const invalidateMotorcycles = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['motorcycles'] }),
    [queryClient],
  )

  // ── ESTADOS: UI e Carregamento ────────────────────────────────────────────


  // [saving, setSaving]: Indica se há uma requisição ao Supabase em andamento ao salvar o formulário.
  const [saving, setSaving] = useState(false)
  
  // [completing, setCompleting]: Bloqueia cliques excessivos no botão de confirmar conclusão enquanto a etapa 2 roda.
  const [completing, setCompleting] = useState(false)

  // ── ESTADOS: Filtros de Visualização ──────────────────────────────────────
  // statusFilter começa em 'overdue' (operador chega na tela e vê o que precisa
  // resolver hoje). Pode ser limpo via card "Todas".
  const [statusFilter, setStatusFilter] = useState<'all' | MaintenanceStatus>('overdue')
  const [motorcycleFilter, setMotorcycleFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState<'all' | 'thisMonth' | 'next30days'>('all')
  const [executorFilter, setExecutorFilter] = useState<'all' | 'company' | 'customer'>('all')
  const [searchQuery, setSearchQuery] = useState('')

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
    const today = new Date()
    const thisMonthPrefix = today.toISOString().slice(0, 7)
    const horizon30 = new Date(today)
    horizon30.setDate(horizon30.getDate() + 30)

    return withStatus
      .filter((m) => {
        if (statusFilter !== 'all' && m._status !== statusFilter) return false
        if (motorcycleFilter && m.motorcycle_id !== motorcycleFilter) return false
        if (planFilter && m.motorcycle?.maintenance_plan_id !== planFilter) return false
        if (typeFilter !== 'all' && m.type !== typeFilter) return false
        if (executorFilter !== 'all') {
          const exec = m.completed ? m.effective_executor : null
          if (m.completed) {
            if (exec !== executorFilter) return false
          } else {
            // Para itens não concluídos não há executor realizado; o filtro de
            // executor só faz sentido em "concluídas".
            return false
          }
        }
        if (periodFilter !== 'all' && !m.completed) {
          // Período = "quando vence". Considera predicted_km (estimado em dias
          // via KM_POR_DIA) ou scheduled_date diretamente.
          const dueDate = m.scheduled_date
            ? new Date(m.scheduled_date + 'T12:00:00')
            : m.predicted_km != null && m.motorcycle
              ? (() => {
                  const kmLeft = m.predicted_km - m.motorcycle.km_current
                  const daysLeft = kmLeft / KM_POR_DIA
                  const d = new Date(today)
                  d.setDate(d.getDate() + Math.round(daysLeft))
                  return d
                })()
              : null
          if (!dueDate) return false
          if (periodFilter === 'thisMonth') {
            if (dueDate.toISOString().slice(0, 7) !== thisMonthPrefix) return false
          } else if (periodFilter === 'next30days') {
            if (dueDate > horizon30) return false
          }
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (![m.description, m.motorcycle?.license_plate, m.motorcycle?.model, m.motorcycle?.make]
            .some((v) => v?.toLowerCase().includes(q))) return false
        }
        return true
      })
  }, [withStatus, statusFilter, motorcycleFilter, planFilter, typeFilter, periodFilter, executorFilter, searchQuery])

  /**
   * Lista achatada ordenada por urgência: vencidas primeiro (pior atraso no
   * topo), depois próximas, depois agendadas, depois concluídas (mais recentes
   * primeiro). Substitui o accordion por moto — estilo CMMS (Fleetio/Samsara).
   */
  const sortedFlat = useMemo(() => {
    const order: Record<MaintenanceStatus, number> = { overdue: 0, upcoming: 1, scheduled: 2, completed: 3 }
    const urgency = (m: MaintenanceWithMoto): number => {
      const km = diffKm(m)
      if (km !== null) return km
      const d = diffDias(m)
      if (d !== null) return d * KM_POR_DIA
      return Number.POSITIVE_INFINITY
    }
    return [...filtered].sort((a, b) => {
      const so = order[a._status!] - order[b._status!]
      if (so !== 0) return so
      if (a._status === 'completed' && b._status === 'completed') {
        // Mais recentes primeiro.
        return (b.completed_date ?? '').localeCompare(a.completed_date ?? '')
      }
      return urgency(a) - urgency(b)
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

  const motorcycleSelectOptions = useMemo(() => [
    { value: '', label: 'Selecione a moto...' },
    ...motorcycles.map((m) => ({ value: m.id, label: `${m.license_plate} — ${m.make} ${m.model}` })),
  ], [motorcycles])

  const hasActiveFilters =
    statusFilter !== 'all'
    || !!motorcycleFilter
    || !!planFilter
    || typeFilter !== 'all'
    || periodFilter !== 'all'
    || executorFilter !== 'all'
    || !!searchQuery

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

    const isExecuted = formData.mode === 'executed'

    // Upload das fotos só faz sentido no modo executado; quando o usuário
    // está apenas agendando, nem enviamos os campos no payload.
    let odometerUrl: string | null = null
    let invoiceUrl: string | null = null
    if (isExecuted) {
      if (formData.odometer_photo_file) {
        odometerUrl = await uploadMaintenanceFile(formData.odometer_photo_file, 'km')
      }
      if (formData.invoice_photo_file) {
        invoiceUrl = await uploadMaintenanceFile(formData.invoice_photo_file, 'nf')
      }
    }

    // Tratamos aqui conversões de tipos de Strings capturadas no HTML para Ints, Floats ou nulls para respeitar as chaves nativas postgres.
    // Quando o modo é "scheduled", a parte de execução vai como null para
    // limpar valores prévios (ex.: operador desfez uma marcação de concluído).
    const payload = isExecuted
      ? {
          motorcycle_id: formData.motorcycle_id,
          type: formData.type,
          description: formData.description,
          completed: true,
          completed_date: formData.completed_date || new Date().toISOString().split('T')[0],
          actual_km: formData.actual_km ? parseInt(formData.actual_km, 10) : null,
          cost: formData.cost ? parseFloat(formData.cost) : null,
          workshop: formData.workshop || null,
          observations: formData.observations || null,
          effective_executor: formData.effective_executor,
          effective_customer_payer_pct: formData.customer_payer_pct,
          odometer_photo_url: odometerUrl,
          invoice_photo_url: invoiceUrl,
        }
      : {
          motorcycle_id: formData.motorcycle_id,
          type: formData.type,
          description: formData.description,
          scheduled_date: formData.scheduled_date || null,
          predicted_km: formData.predicted_km ? parseInt(formData.predicted_km, 10) : null,
          workshop: formData.workshop || null,
          observations: formData.observations || null,
          completed: false,
          completed_date: null,
          actual_km: null,
          cost: null,
        }
    try {
      const res = editingMaintenance
        ? await updateMaintenance(editingMaintenance.id, payload)
        : await createMaintenance(payload)
      if (res.error) { alert(`Erro ao salvar: ${res.error}`); return }
      closeFormModal()
      await invalidateMaintenances()
    } catch (err) {
      console.error('[MANUTENCAO] handleSave error:', err)
    } finally {
      setSaving(false)
    }
  }, [formData, editingMaintenance, closeFormModal, invalidateMaintenances])

  /**
   * @function handleDelete
   * @description Exclui permanentemente o registro da manutenção no banco de dados.
   * Pré-condição: ID já carregada na variável transitória do alerta de perigo.
   */
  const handleDelete = useCallback(async () => {
    if (!deletingId) return
    const res = await deleteMaintenance(deletingId)
    if (res.error) { alert(`Erro ao excluir: ${res.error}`); return }
    closeDeleteModal()
    invalidateMaintenances()
  }, [deletingId, closeDeleteModal, invalidateMaintenances])

  /**
   * @function handleOpenComplete
   * @description Puxa dados de inteligência preparatória do fluxo avançado da "Etapa 1".
   * Aciona endpoints para descobrir o tipo contratual da moto engatando defaults amigáveis na finança e varre pendências adjacentes da motocicleta na oficina.
   * @param {MaintenanceWithMoto} maintenance - Entidade mãe selecionada via check.
   */
  const handleOpenComplete = useCallback(async (maintenance: MaintenanceWithMoto) => {
    setCompletingMaintenance(maintenance)
    setCompletionStep(1)
    setCompletionKm(maintenance.motorcycle?.km_current?.toString() ?? '')
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
        const res = await updateMaintenance(itemId, {
          completed: true,
          completed_date: completionDate,
          actual_km: actualKm,
          cost: fin.cost ? parseFloat(fin.cost) : null,
          workshop: completionWorkshop || null,
          observations: completionObservations || null,
          effective_executor: fin.executor,
          effective_customer_payer_pct: fin.customer_payer_pct,
          odometer_photo_url: odometerUrl,
          invoice_photo_url: invoiceUrl,
        })
        if (res.error) { alert(`Erro ao concluir item: ${res.error}`); return }
      }

      // Fallback pra salvar manutenção em si caso não tenha havido etapa com grid preenchida
      if (completionFinancials.length === 0) {
        const res = await updateMaintenance(completingMaintenance.id, {
          completed: true,
          completed_date: completionDate,
          actual_km: actualKm,
          workshop: completionWorkshop || null,
          observations: completionObservations || null,
        })
        if (res.error) { alert(`Erro ao concluir: ${res.error}`); return }
      }

      // Função de Auto-agendar (Gerar repetição no DB de consertos periódicos)
      const itemsToSchedule = [
        completingMaintenance,
        ...completionExtras.filter((e) => completionExtraIds.includes(e.id)),
      ]

      for (const item of itemsToSchedule) {
        const suggested = findSuggestedItemByDescription(item.description)
        const projection = calculateNextMaintenance({
          completionKm: actualKm,
          completionDate,
          interval_km: suggested?.interval_km,
          interval_days: suggested?.interval_days,
        })
        if (!projection) continue
        const next: Record<string, unknown> = {
          motorcycle_id: item.motorcycle_id,
          type: item.type,
          description: item.description,
          completed: false,
          ...projection,
        }
        const res = await createMaintenance(next)
        if (res.error) { alert(`Erro ao agendar próxima manutenção: ${res.error}`); return }
      }

      // Auto-corretor do Hodômetro da base das motocicletas baseado no que informaram. Nunca aceita medição que "diminui a KM", pois não faz sentido lógico e seria erro de form.
      const currentKm = completingMaintenance.motorcycle?.km_current ?? 0
      if (actualKm > currentKm) {
        const res = await updateMotorcycleKm(completingMaintenance.motorcycle_id, actualKm)
        if (res.error) { alert(`Erro ao atualizar KM da moto: ${res.error}`); return }
      }

      closeCompleteModal()
      await Promise.all([invalidateMaintenances(), invalidateMotorcycles()])
    } catch {
    } finally {
      setCompleting(false)
    }
  }, [completingMaintenance, completionKm, completionDate, completionWorkshop, completionObservations, completionExtraIds, completionFinancials, completionExtras, closeCompleteModal, invalidateMaintenances, invalidateMotorcycles])

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
      mode: m.completed ? 'executed' : 'scheduled',
      scheduled_date: m.scheduled_date || '',
      predicted_km: m.predicted_km?.toString() || '',
      actual_km: m.actual_km?.toString() || '',
      cost: m.cost?.toString() || '',
      completed_date: m.completed_date || '',
      workshop: m.workshop || '',
      observations: m.observations || '',
      effective_executor: m.effective_executor ?? 'company',
      customer_payer_pct: m.effective_customer_payer_pct ?? 0,
      odometer_photo_file: null,
      invoice_photo_file: null,
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
    const res = await updateMotorcycleKm(kmForm.motorcycle_id, parseInt(kmForm.km_current, 10))
    if (res.error) { alert(`Erro ao atualizar KM: ${res.error}`); return }
    setIsKmModalOpen(false)
    setKmForm({ motorcycle_id: '', km_current: '' })
    await Promise.all([invalidateMaintenances(), invalidateMotorcycles()])
  }, [kmForm, invalidateMaintenances, invalidateMotorcycles])

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

        {/* ── KPI CARDS CLICÁVEIS (TABS DE STATUS) ─────────────────────────────
            CMMS-style: cada card é um botão que aplica o filtro de status.
            O quinto card (Custo do Mês) é informativo, não filtra. */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {([
            { key: 'overdue',   label: 'Vencidas',      count: totals.overdue,   icon: AlertTriangle, color: 'text-[#ff9c9a]', active: 'border-[#ff3e3c]' },
            { key: 'upcoming',  label: 'Próximas',      count: totals.upcoming,  icon: Clock,         color: 'text-[#e65e24]', active: 'border-[#e65e24]' },
            { key: 'scheduled', label: 'Agendadas',     count: totals.scheduled, icon: Wrench,        color: 'text-[#a880ff]', active: 'border-[#a880ff]' },
            { key: 'completed', label: 'Concluídas mês', count: totals.completed, icon: CheckCircle2,  color: 'text-[#229731]', active: 'border-[#229731]' },
          ] as const).map((kpi) => {
            const Icon = kpi.icon
            const isActive = statusFilter === kpi.key
            return (
              <button
                key={kpi.key}
                onClick={() => setStatusFilter((prev) => prev === kpi.key ? 'all' : kpi.key)}
                aria-pressed={isActive}
                className={`flex items-center justify-between rounded-xl bg-[#202020] p-4 border-2 transition-colors text-left ${
                  isActive ? kpi.active : 'border-transparent hover:border-[#474747]'
                }`}
              >
                <div>
                  <p className="text-[13px] text-[#9e9e9e]">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.count}</p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
                  <Icon className="h-5 w-5 text-[#BAFF1A]" />
                </div>
              </button>
            )
          })}

          <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4 border-2 border-transparent">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Custo do Mês</p>
              <p className="text-2xl font-bold text-[#f5f5f5]">{formatCurrency(totals.costThisMonth)}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <DollarSign className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>
        </div>

        {/* ── BARRA DE FILTROS ─────────────────────────────────────────────────
            Lista achatada estilo CMMS — filtros combináveis trabalham sobre
            `sortedFlat`. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
            <input
              type="text"
              placeholder="Buscar item, placa, modelo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 rounded-full border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-56"
            />
          </div>

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
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-10 rounded-full border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
          >
            <option value="">Todos os planos</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#202020]">{p.name}</option>
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

          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)}
            className="h-10 rounded-full border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            title="Janela de vencimento (só itens pendentes)"
          >
            <option value="all">Qualquer prazo</option>
            <option value="thisMonth">Vencem este mês</option>
            <option value="next30days">Próximos 30 dias</option>
          </select>

          <select
            value={executorFilter}
            onChange={(e) => setExecutorFilter(e.target.value as typeof executorFilter)}
            className="h-10 rounded-full border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            title="Quem levou à oficina (só itens concluídos)"
          >
            <option value="all">Qualquer executor</option>
            <option value="company">Executado pela empresa</option>
            <option value="customer">Executado pelo cliente</option>
          </select>

          {hasActiveFilters && (
            <button
              onClick={() => {
                setStatusFilter('all')
                setMotorcycleFilter('')
                setPlanFilter('')
                setTypeFilter('all')
                setPeriodFilter('all')
                setExecutorFilter('all')
                setSearchQuery('')
              }}
              className="flex items-center gap-1 h-10 px-3 rounded-full border border-[#474747] bg-transparent text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] hover:border-[#9e9e9e] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Limpar
            </button>
          )}

          <span className="ml-auto text-[13px] text-[#616161]">
            {sortedFlat.length} item{sortedFlat.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* ── LISTA ACHATADA POR URGÊNCIA ──────────────────────────────────────
            Estilo CMMS (Fleetio/Samsara): toda manutenção fica em uma linha
            única ordenada pela urgência efetiva. A coluna "Moto" dá contexto
            sem precisar agrupar. */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : sortedFlat.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Wrench className="mb-4 h-12 w-12 text-[#474747]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhuma manutenção encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou cadastre uma nova manutenção.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-[#202020]">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead className="bg-[#323232] border-b border-[#474747]">
                <tr>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium w-32">Status</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Moto</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Previsão / Realizado</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Situação</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Executor</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium text-right">Custo</th>
                  <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium text-right w-32">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sortedFlat.map((item) => {
                  const isCompleted = item._status === 'completed'
                  const moto = item.motorcycle
                  const onRowClick = () => {
                    if (isCompleted) {
                      setViewingMaintenance(item)
                    } else {
                      handleOpenComplete(item)
                    }
                  }
                  return (
                    <tr
                      key={item.id}
                      onClick={onRowClick}
                      className={`h-9 border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer ${isCompleted ? 'opacity-80' : ''}`}
                    >
                      <td className="px-4"><BadgeStatus status={item._status!} /></td>
                      <td className="px-4">
                        <div className="flex flex-col leading-tight">
                          <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">{moto?.license_plate ?? '—'}</span>
                          <span className="text-[12px] text-[#9e9e9e]">
                            {moto ? `${moto.make} ${moto.model}` : ''}
                            {moto?.km_current != null && <span className="text-[#616161]"> · {fmtKm(moto.km_current)}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4">
                        <div className="flex flex-col leading-tight">
                          <span className="font-medium text-[#f5f5f5] text-[13px]">
                            {item.description}
                            {(() => {
                              const iv = findSuggestedItemByDescription(item.description)
                              if (!iv) return null
                              const hint = iv.interval_km
                                ? `a cada ${iv.interval_km.toLocaleString('pt-BR')} km`
                                : `a cada ${iv.interval_days} dias`
                              return <span className="ml-1.5 text-[12px] font-light text-[#474747]">{hint}</span>
                            })()}
                          </span>
                          <StatusBadge status={item.type} />
                        </div>
                      </td>
                      <td className="px-4">
                        {isCompleted ? (
                          <div className="flex flex-col leading-tight text-[13px] text-[#9e9e9e]">
                            {item.actual_km != null && <span>{fmtKm(item.actual_km)}</span>}
                            {item.completed_date && <span className="text-[#616161]">{formatDate(item.completed_date + 'T12:00:00')}</span>}
                          </div>
                        ) : item.predicted_km != null ? (
                          <div className="flex flex-col leading-tight">
                            <span className="text-[#f5f5f5] text-[13px]">{fmtKm(item.predicted_km)}</span>
                            <span className="text-[12px] text-[#616161]">Atual: {fmtKm(moto?.km_current ?? 0)}</span>
                          </div>
                        ) : item.scheduled_date ? (
                          <span className="text-[#f5f5f5] text-[13px]">{formatDate(item.scheduled_date + 'T12:00:00')}</span>
                        ) : <span className="text-[#9e9e9e] text-[13px]">—</span>}
                      </td>
                      <td className="px-4"><SituacaoCell m={item} /></td>
                      <td className="px-4 text-[13px]">
                        {isCompleted ? (
                          item.effective_executor === 'customer'
                            ? <span className="text-[#a880ff]">Cliente</span>
                            : item.effective_executor === 'company'
                              ? <span className="text-[#229731]">Empresa</span>
                              : <span className="text-[#616161]">—</span>
                        ) : (
                          <span className="text-[#616161]">—</span>
                        )}
                      </td>
                      <td className="px-4 text-right text-[13px]">
                        {item.cost != null
                          ? <span className="text-[#f5f5f5]">{formatCurrency(item.cost)}</span>
                          : <span className="text-[#616161]">—</span>}
                      </td>
                      <td className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isCompleted ? (
                            <>
                              <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Visualizar" onClick={() => setViewingMaintenance(item)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Excluir" onClick={() => handleOpenDelete(item.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Editar" onClick={() => handleOpenEdit(item)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button variant="primary" size="sm" className="h-8 w-8 p-0" title="Registrar conclusão" onClick={() => handleOpenComplete(item)}>
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Excluir" onClick={() => handleOpenDelete(item.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===================================================================
          MODAIS E DIÁLOGOS DE SUPERPOSIÇÃO
          =================================================================== */}

      {/* MODAL 1: FORMULÁRIO DE NOVA / EDITAR MANUTENÇÃO (CRUD PURO).
          Radio no topo dirige toda a UI: 'scheduled' mostra só campos-gatilho
          (KM previsto, data agendada). 'executed' troca pelo conjunto de
          execução (KM no serviço, custo, fotos, executor, % cliente). */}
      <Modal open={isFormModalOpen} onClose={closeFormModal} title={editingMaintenance ? 'Editar Manutenção' : 'Nova Manutenção'} size="lg">
        <div className="space-y-4">
          {/* Radio de modo — primeira escolha do operador. */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#121212] p-1">
            {(['scheduled', 'executed'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFormData((prev) => ({
                  ...prev,
                  mode: m,
                  completed_date: m === 'executed' && !prev.completed_date
                    ? new Date().toISOString().split('T')[0]
                    : prev.completed_date,
                }))}
                className={`h-9 rounded-lg text-[13px] font-medium transition-colors ${
                  formData.mode === m
                    ? 'bg-[#BAFF1A] text-[#121212]'
                    : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {m === 'scheduled' ? 'Agendar' : 'Já executada'}
              </button>
            ))}
          </div>

          {/* Bloco comum: moto + tipo + descrição. */}
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
                label="Item / Descrição *"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Ex: Troca do cabo do freio..."
              />
            </div>
          </div>

          {formData.mode === 'scheduled' ? (
            /* AGENDADO: gatilhos de quando a manutenção vence. */
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="Data Agendada" type="date" value={formData.scheduled_date} onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })} />
              <Input label="KM Previsto" type="number" value={formData.predicted_km} onChange={(e) => setFormData({ ...formData, predicted_km: e.target.value })} placeholder="Ex: 18000" />
              <div className="md:col-span-2">
                <Input label="Oficina / Mecânico" value={formData.workshop} onChange={(e) => setFormData({ ...formData, workshop: e.target.value })} placeholder="Onde a manutenção será feita (opcional)" />
              </div>
              <div className="md:col-span-2">
                <Textarea
                  label="Observações (opcional)"
                  value={formData.observations}
                  onChange={(e) => {
                    if (e.target.value.length <= 2000) setFormData({ ...formData, observations: e.target.value })
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Notas de planejamento, prioridade, peças a comprar..."
                />
                <p className="text-[12px] text-right text-[#9e9e9e]">{formData.observations.length}/2000</p>
              </div>
            </div>
          ) : (
            /* EXECUTADO: tudo o que prova o serviço foi feito. */
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input label="Data de Conclusão *" type="date" value={formData.completed_date} onChange={(e) => setFormData({ ...formData, completed_date: e.target.value })} />
                <Input label="KM no Serviço *" type="number" value={formData.actual_km} onChange={(e) => setFormData({ ...formData, actual_km: e.target.value })} placeholder="Ex: 15500" />
                <Input label="Oficina / Mecânico" value={formData.workshop} onChange={(e) => setFormData({ ...formData, workshop: e.target.value })} />
                <Input label="Custo (R$)" type="number" step="0.01" value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} placeholder="0.00" />
              </div>

              {/* Responsabilidade — snapshot D4 do PRD 0003. */}
              <div className="rounded-xl bg-[#121212] p-3 space-y-3">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-[#9e9e9e]">Executor</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['company', 'customer'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setFormData({ ...formData, effective_executor: opt })}
                        className={`h-9 rounded-lg text-[13px] transition-colors ${
                          formData.effective_executor === opt
                            ? 'bg-[#323232] text-[#f5f5f5] border border-[#474747]'
                            : 'text-[#9e9e9e] hover:bg-[#1a1a1a]'
                        }`}
                      >
                        {opt === 'company' ? 'Empresa' : 'Cliente'}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  label="% pago pelo cliente"
                  type="number"
                  min={0}
                  max={100}
                  value={formData.customer_payer_pct.toString()}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                    setFormData({ ...formData, customer_payer_pct: v })
                  }}
                />
              </div>

              {/* Fotos — não obrigatórias, só sinalizadas como importantes. */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[13px] text-[#f5f5f5]">
                    Foto do KM <span className="text-[#9e9e9e] text-[12px]">(opcional)</span>
                  </label>
                  <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${formData.odometer_photo_file ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'}`}>
                    <Camera className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                    <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                      {formData.odometer_photo_file ? formData.odometer_photo_file.name : 'Nenhum arquivo selecionado'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => setFormData({ ...formData, odometer_photo_file: e.target.files?.[0] ?? null })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] text-[#f5f5f5]">
                    Nota Fiscal <span className="text-[#9e9e9e] text-[12px]">(opcional)</span>
                  </label>
                  <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${formData.invoice_photo_file ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'}`}>
                    <FileText className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                    <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                      {formData.invoice_photo_file ? formData.invoice_photo_file.name : 'Nenhum arquivo selecionado'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => setFormData({ ...formData, invoice_photo_file: e.target.files?.[0] ?? null })}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Textarea
                  label="Observações (opcional)"
                  value={formData.observations}
                  onChange={(e) => {
                    if (e.target.value.length <= 2000) setFormData({ ...formData, observations: e.target.value })
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Anotações sobre a execução, peças trocadas, ressalvas..."
                />
                <p className="text-[12px] text-right text-[#9e9e9e]">{formData.observations.length}/2000</p>
              </div>
            </div>
          )}

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
                  {viewingMaintenance.motorcycle
                    ? `${viewingMaintenance.motorcycle.license_plate} — ${viewingMaintenance.motorcycle.make} ${viewingMaintenance.motorcycle.model}`
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
                    const pct = viewingMaintenance.effective_customer_payer_pct ?? 0
                    const cliente = (c * pct) / 100
                    const empresa = c - cliente
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
                {completingMaintenance.motorcycle
                  ? `${completingMaintenance.motorcycle.license_plate} — ${completingMaintenance.motorcycle.make} ${completingMaintenance.motorcycle.model}`
                  : '—'}
              </p>
              {completingMaintenance.predicted_km != null && (
                <p className="text-[13px] text-[#e65e24]">KM previsto: {fmtKm(completingMaintenance.predicted_km)}</p>
              )}
              {completingMaintenance.motorcycle?.km_current != null && (
                <p className="text-[13px] text-[#9e9e9e]">KM atual: {fmtKm(completingMaintenance.motorcycle.km_current)}</p>
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

                  // Mapeia novas provisões que o sistema fará automaticamente a partir deste conserto caso exista um intervalo padrão de reincidência (lookup via sugestão canônica enquanto F2 não vincula plan_item_id)
                  const fromCompleting: NextItem[] = completingItems
                    .map((item): NextItem | null => {
                      const interval = findSuggestedItemByDescription(item.description)
                      if (!interval || (!interval.interval_km && !interval.interval_days)) return null
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
                        executor: 'company',
                        customer_payer_pct: 0,
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

                      {/* PRD 0003 D4 — Snapshot de responsabilidade: executor binário + % pago pelo cliente. */}
                      <div className="grid grid-cols-2 gap-3">
                        <Select
                          label="Executor (quem leva à oficina)"
                          value={fin.executor}
                          onChange={(e) => setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, executor: e.target.value as 'company' | 'customer' } : f))}
                          options={[
                            { value: 'company', label: 'Empresa' },
                            { value: 'customer', label: 'Cliente' },
                          ]}
                        />
                        <Input
                          label="% pago pelo cliente"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={String(fin.customer_payer_pct)}
                          onChange={(e) => {
                            const raw = parseInt(e.target.value, 10)
                            const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
                            setCompletionFinancials((prev) => prev.map((f, i) => i === idx ? { ...f, customer_payer_pct: pct } : f))
                          }}
                          placeholder="0"
                        />
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

                      {fin.cost && parseFloat(fin.cost) > 0 && (() => {
                        const c = parseFloat(fin.cost)
                        const cliente = (c * fin.customer_payer_pct) / 100
                        const empresa = c - cliente
                        return (
                          <p className="text-[13px] text-[#9e9e9e] border-t border-[#323232] pt-2">
                            → Empresa: {formatCurrency(empresa)} / Cliente: {formatCurrency(cliente)}
                          </p>
                        )
                      })()}
                    </div>
                  ))}
                </div>

                {/* Resumo financeiro consolidado gerando o DRE micro da operação do dia para a interface */}
                {(() => {
                  const totalCliente = completionFinancials.reduce((acc, f) => {
                    const c = parseFloat(f.cost) || 0
                    return acc + (c * f.customer_payer_pct) / 100
                  }, 0)
                  const totalEmpresa = completionFinancials.reduce((acc, f) => {
                    const c = parseFloat(f.cost) || 0
                    return acc + c - (c * f.customer_payer_pct) / 100
                  }, 0)
                  // Há rateio quando algum item tem custo > 0 e o cliente paga parte (>0%).
                  const hasSplit = completionFinancials.some((f) => (parseFloat(f.cost) || 0) > 0 && f.customer_payer_pct > 0)

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

                {(() => {
                  const missingPhotos = completionFinancials.some((f) => !f.odometer_photo_file && !f.invoice_photo_file)
                  return (
                    <div className="space-y-2">
                      {missingPhotos && (
                        <div className="flex items-start gap-2 rounded-xl border border-[#e65e24]/30 bg-[#e65e24]/5 p-3">
                          <AlertTriangle className="w-4 h-4 text-[#e65e24] shrink-0 mt-0.5" />
                          <p className="text-[13px] text-[#e65e24]">
                            Há itens sem fotos. As fotos não são obrigatórias, mas servem como comprovação — anexe sempre que possível.
                          </p>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Textarea
                          label="Observações (opcional)"
                          value={completionObservations}
                          onChange={(e) => {
                            if (e.target.value.length <= 2000) setCompletionObservations(e.target.value)
                          }}
                          rows={2}
                          maxLength={2000}
                          placeholder="Anotações sobre a execução, peças trocadas, ressalvas..."
                        />
                        <p className="text-[12px] text-right text-[#9e9e9e]">
                          {completionObservations.length}/2000
                        </p>
                      </div>
                    </div>
                  )
                })()}

                <div className="flex justify-between gap-3 border-t border-[#323232] pt-4">
                  <Button variant="secondary" onClick={() => setCompletionStep(1)}>← Voltar</Button>
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={closeCompleteModal}>Cancelar</Button>
                    <Button
                      variant="primary"
                      onClick={handleConfirmComplete}
                      loading={completing}
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
