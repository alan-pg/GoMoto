/**
 * @file page.tsx
 * @description Página de gerenciamento da fila de espera de candidatos para locação de motos.
 *
 * @motivation
 * Quando não há motos disponíveis, novos interessados entram em uma fila ordenada por prioridade.
 * Esta página centraliza todo o ciclo de vida dessa fila:
 *   1. Cadastro do candidato (com documentos anexados via Supabase Storage)
 *   2. Reordenação da fila com registro obrigatório de motivo (auditoria)
 *   3. Edição dos dados do candidato enquanto ele aguarda
 *   4. "Fechar Contrato": transição do candidato para cliente ativo, criando contrato,
 *      atualizando status da moto, registrando KM inicial e lançando caução como entrada financeira
 *
 * @arquitetura
 * - Client Component ('use client') pois gerencia estado local complexo e eventos de usuário
 * - Todas as queries são feitas diretamente ao Supabase (sem API intermediária)
 * - Upload de documentos usa Supabase Storage bucket 'documents' (público, máx 10MB)
 * - O campo `monthly_amount` da tabela `contracts` armazena o valor SEMANAL (não mensal)
 */

'use client'

// Hooks do React necessários para gerenciar os múltiplos estados da página
import { useState, useEffect, useCallback, useMemo } from 'react'

// Cliente Supabase no lado do browser — usado para todas as operações de leitura/escrita
import { createClient } from '@/lib/supabase/client'

// Utilitário para formatar datas no padrão brasileiro (dd/mm/aaaa)
import { formatDate } from '@/lib/utils'

// Componentes do design system GoMoto — mantém identidade visual consistente em toda a aplicação
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Select, Textarea, Input } from '@/components/ui/Input'
import { Header } from '@/components/layout/Header'

// Ícones da biblioteca Lucide — escolhidos semanticamente para cada ação
import {
  UserPlus,      // Ícone para "Adicionar à Fila" — representa entrada de novo candidato
  Trash2,        // Ícone para "Remover da Fila" — ação destrutiva, usa vermelho
  ArrowUp,       // Ícone para subir posição na fila — navegação de prioridade
  ArrowDown,     // Ícone para descer posição na fila — navegação de prioridade
  Users,         // Ícone do card "Total na Fila" — representa grupo de pessoas
  Bike,          // Ícone do card "Motos Disponíveis" — representa o produto sendo locado
  AlertTriangle, // Ícone do alerta quando há motos disponíveis E candidatos esperando
  CheckCircle2,  // Ícone para "Fechar Contrato" — representa confirmação/aprovação
  FileText,      // Ícone da área de upload de documentos (CNH e comprovante de residência)
  Edit2,         // Ícone para "Editar Candidato" — ação neutra de edição
} from 'lucide-react'

// =============================================================================
// TIPOS E INTERFACES
// =============================================================================

/**
 * @interface QueueEntry
 * @description Representa uma entrada na fila de espera.
 *
 * @motivation
 * Mapeia exatamente o que o Supabase retorna na query principal:
 * `queue_entries` com JOIN em `customers`. O campo `customers` pode ser `null`
 * se o join falhar (ex: cliente deletado manualmente no banco), por isso é nullable.
 * A posição numérica é o que define a ordem de atendimento.
 */
interface QueueEntry {
  /** Identificador único da entrada na fila (UUID gerado pelo Supabase) */
  id: string
  /** Referência ao cliente associado — usado para atualizar `in_queue` ao fechar contrato */
  customer_id: string
  /** Posição numérica na fila (1 = primeiro a ser atendido) */
  position: number
  /** Observações registradas sobre o candidato ou motivo de reordenação */
  notes: string | null
  /** Data de entrada na fila — exibida na coluna "Desde" */
  created_at: string
  /** Data da última atualização — rastreio de movimentações */
  updated_at: string
  /**
   * Dados do cliente vinculado via JOIN do Supabase.
   * Nullable pois se o cliente for removido manualmente do banco o join retorna null.
   * Selecionamos apenas os campos necessários para exibição na tabela (nome, telefone, CNH).
   */
  customers: {
    name: string
    phone: string
    drivers_license: string
  } | null
}

/**
 * @interface AvailableMotorcycle
 * @description Moto disponível para ser alocada no momento do fechamento de contrato.
 *
 * @motivation
 * Quando o operador clica em "Fechar Contrato", precisamos listar apenas motos com
 * status 'available'. Incluímos `km_current` para pré-preencher o campo "KM Inicial"
 * automaticamente ao selecionar a moto — evitando digitação desnecessária.
 */
interface AvailableMotorcycle {
  /** UUID da moto no banco */
  id: string
  /** Placa exibida no select e usada para referenciar a moto no lançamento de caução */
  license_plate: string
  /** Modelo para exibição amigável no select (ex: "CG 160") */
  model: string
  /** Fabricante para compor o label completo (ex: "Honda") */
  make: string
  /**
   * KM atual registrado no banco.
   * Pré-preenchido no campo "KM Inicial" ao selecionar a moto,
   * pois o KM inicial do contrato deve partir do KM atual da moto.
   */
  km_current: number
}

// =============================================================================
// CONSTANTES E DADOS ESTÁTICOS
// =============================================================================

/**
 * @constant UFS
 * @description Lista de siglas dos estados brasileiros para o campo "Estado" do cadastro.
 *
 * @motivation
 * Restringir a entrada a UFs válidas evita erros de digitação e mantém dados consistentes
 * no banco. Usado tanto no cadastro de novo candidato quanto na edição.
 */
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]

/**
 * @constant CNH_CATEGORIES
 * @description Categorias válidas de CNH conforme o Código de Trânsito Brasileiro.
 *
 * @motivation
 * A locadora aluga motos, que exigem CNH categoria A (ou AB, ACC, etc.).
 * Registrar a categoria permite ao operador verificar se o candidato está habilitado
 * para conduzir o tipo de veículo disponível.
 */
const CNH_CATEGORIES = ['A', 'B', 'AB', 'C', 'D', 'E']

/**
 * @constant DEFAULT_ADD_FORM
 * @description Estado inicial vazio do formulário de cadastro de candidato.
 *
 * @motivation
 * Centralizar o valor padrão evita repetição e garante que o formulário sempre
 * começa limpo ao abrir o modal. Também serve como referência de quais campos
 * o formulário possui. O estado padrão de `state` é 'RJ' pois a locadora opera no Rio de Janeiro.
 * Os campos de arquivo (`cnhFile`, `residenceFile`) começam como `null` pois são opcionais no cadastro.
 */
const DEFAULT_ADD_FORM = {
  name: '',
  cpf: '',
  rg: '',
  /** Padrão 'RJ' pois a locadora opera no Rio de Janeiro */
  state: 'RJ',
  phone: '',
  email: '',
  address: '',
  zipCode: '',
  emergencyContact: '',
  cnh: '',
  cnhExpiry: '',
  /** Padrão 'A' pois motos exigem CNH categoria A */
  cnhCategory: 'A',
  birthDate: '',
  notes: '',
  /** Arquivo da CNH — null quando não selecionado (upload é opcional no cadastro) */
  cnhFile: null as File | null,
  /** Arquivo do comprovante de residência — null quando não selecionado */
  residenceFile: null as File | null,
}

/**
 * @constant MOVE_UP_REASONS
 * @description Motivos válidos para subir um candidato na fila de prioridade.
 *
 * @motivation
 * A reordenação da fila DEVE ter motivo registrado para fins de auditoria e transparência.
 * Isso evita favoritismos sem justificativa e permite ao gestor revisar o histórico de
 * movimentações. A opção vazia força o operador a selecionar um motivo válido.
 */
const MOVE_UP_REASONS = [
  { value: '', label: 'Selecione o motivo...' },
  { value: 'Possui caução e documentos completos', label: 'Possui caução e documentos completos' },
  { value: 'Aguardando há mais tempo na fila', label: 'Aguardando há mais tempo na fila' },
  { value: 'Necessidade urgente comprovada', label: 'Necessidade urgente comprovada' },
  { value: 'Resolveu pendências anteriores', label: 'Resolveu pendências anteriores' },
  { value: 'Preferência por horário disponível', label: 'Preferência por horário disponível' },
  { value: 'Indicação ou prioridade interna', label: 'Indicação ou prioridade interna' },
]

/**
 * @constant MOVE_DOWN_REASONS
 * @description Motivos válidos para descer um candidato na fila de prioridade.
 *
 * @motivation
 * Assim como subir, descer um candidato precisa de justificativa para garantir
 * que a decisão foi consciente e auditável. O registro fica salvo na coluna `notes`
 * do candidato que desceu.
 */
const MOVE_DOWN_REASONS = [
  { value: '', label: 'Selecione o motivo...' },
  { value: 'Documentação incompleta', label: 'Documentação incompleta' },
  { value: 'Caução não disponível', label: 'Caução não disponível' },
  { value: 'Não compareceu quando chamado', label: 'Não compareceu quando chamado' },
  { value: 'Desistência temporária', label: 'Desistência temporária' },
  { value: 'Outro candidato tem prioridade', label: 'Outro candidato tem prioridade' },
]

// =============================================================================
// FUNÇÕES AUXILIARES
// =============================================================================

/**
 * @function getDownNote
 * @description Gera a observação que será salva no candidato que DESCEU na fila,
 * com base no motivo informado para quem SUBIU.
 *
 * @motivation
 * Quando o candidato A sobe porque "Possui caução e documentos completos",
 * o candidato B que desceu precisa de uma nota explicando o motivo de forma simétrica.
 * Essa função faz esse mapeamento automático para manter consistência no histórico.
 * Se o motivo não tiver mapeamento específico, usa uma nota genérica.
 *
 * @param upReason - O motivo pelo qual o candidato subiu na fila
 * @returns A nota a ser registrada no candidato que desceu
 */
function calcEndDate(startDate: string, type: 'rental' | 'loyalty'): string {
  if (!startDate) return ''
  const d = new Date(startDate + 'T00:00:00')
  if (type === 'loyalty') d.setFullYear(d.getFullYear() + 2)
  else d.setMonth(d.getMonth() + 3)
  return d.toISOString().split('T')[0]
}

function getDownNote(upReason: string): string {
  // Mapeamento dos motivos de subida para as notas correspondentes do candidato que desceu
  const map: Record<string, string> = {
    'Possui caução e documentos completos': 'Desceu na fila: Outro candidato possui caução e documentos completos',
    'Aguardando há mais tempo na fila': 'Desceu na fila: Outro candidato aguardava há mais tempo',
  }
  // Se o motivo não tem mapeamento específico, usa nota genérica de reordenação
  return map[upReason] ?? 'Desceu na fila: Reordenação da fila'
}

// =============================================================================
// COMPONENTES AUXILIARES
// =============================================================================

/**
 * @component DocumentUploadSection
 * @description Seção de upload de documentos do candidato (CNH e comprovante de residência).
 *
 * @motivation
 * Esta seção aparece de forma idêntica em dois modais: "Adicionar à Fila" e "Editar Candidato".
 * Extrair em componente separado elimina duplicação de código (~30 linhas) e garante que
 * qualquer ajuste visual ou funcional no upload seja aplicado nos dois lugares automaticamente.
 *
 * O upload é feito no Supabase Storage bucket 'documents', com path organizado por
 * `customers/{id}/cnh_timestamp.ext` e `customers/{id}/residencia_timestamp.ext`.
 * As URLs públicas geradas são salvas nas colunas `drivers_license_photo_url` e
 * `document_photo_url` da tabela `customers`.
 *
 * @param form - Estado atual do formulário contendo os arquivos selecionados
 * @param onChange - Callback para atualizar os campos de arquivo no estado do formulário pai
 * @param mode - 'add' para novo cadastro (label "PDF ou imagem"), 'edit' para substituição
 */
function DocumentUploadSection({
  form,
  onChange,
  mode = 'add',
}: {
  form: { cnhFile: File | null; residenceFile: File | null }
  onChange: (updates: Partial<{ cnhFile: File | null; residenceFile: File | null }>) => void
  mode?: 'add' | 'edit'
}) {
  const suffix = mode === 'edit' ? '(substituir documento)' : '(PDF ou imagem)'

  return (
    <div className="md:col-span-2 border-t border-[#323232] pt-4 mt-2 space-y-3">
      <p className="text-[13px] text-[#9e9e9e]">Documentos</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* CNH */}
        <div className="space-y-1">
          <label className="text-[13px] text-[#f5f5f5]">
            CNH
            <span className="ml-2 text-[#9e9e9e] text-[12px]">{suffix}</span>
          </label>
          <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${
            form.cnhFile ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'
          }`}>
            <FileText className="w-4 h-4 text-[#9e9e9e] shrink-0" />
            <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
              {form.cnhFile ? form.cnhFile.name : 'Nenhum arquivo selecionado'}
            </span>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => onChange({ cnhFile: e.target.files?.[0] ?? null })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>
        </div>

        {/* Comprovante de Residência */}
        <div className="space-y-1">
          <label className="text-[13px] text-[#f5f5f5]">
            Comprovante de Residência
            <span className="ml-2 text-[#9e9e9e] text-[12px]">{suffix}</span>
          </label>
          <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border-2 rounded-lg h-12 transition-colors ${
            form.residenceFile ? 'border-[#6b9900]' : 'border-[#323232] hover:border-[#474747]'
          }`}>
            <FileText className="w-4 h-4 text-[#9e9e9e] shrink-0" />
            <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
              {form.residenceFile ? form.residenceFile.name : 'Nenhum arquivo selecionado'}
            </span>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => onChange({ residenceFile: e.target.files?.[0] ?? null })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>
        </div>

      </div>
    </div>
  )
}

// =============================================================================
// COMPONENTE PRINCIPAL
// =============================================================================

/**
 * @component QueuePage
 * @description Página principal de gerenciamento da fila de espera do GoMoto.
 *
 * @motivation
 * Centraliza o fluxo completo de candidatos que aguardam uma moto disponível:
 * cadastro → reordenação → edição → fechamento de contrato (ou remoção).
 * A fila garante que a alocação de motos seja justa, ordenada e auditável.
 *
 * @fluxo-de-dados
 * 1. `loadData()` busca a fila e a contagem de motos disponíveis em paralelo
 * 2. Ações do usuário disparam mutations no Supabase (insert/update/delete)
 * 3. Após cada mutation, `fetchQueue()` é chamada para re-sincronizar o estado local
 * 4. O alerta visual indica quando há oportunidade de alocar (motos disponíveis + fila não vazia)
 */
export default function QueuePage() {
  // Cliente Supabase estabilizado com useMemo para não criar nova instância a cada render
  const supabase = useMemo(() => createClient(), [])

  // ---------------------------------------------------------------------------
  // ESTADOS DE DADOS
  // ---------------------------------------------------------------------------

  /**
   * Lista ordenada de entradas da fila.
   * Ordenada por `position` ASC para refletir a prioridade real.
   * Atualizada após cada operação de escrita para manter a UI sincronizada com o banco.
   */
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([])

  /**
   * Quantidade de motos com status 'available' no momento.
   * Usado no card de estatísticas e para disparar o alerta de oportunidade de alocação.
   * Separado da fila pois é uma contagem simples (HEAD query), não precisa de dados detalhados.
   */
  const [availableMotosCount, setAvailableMotosCount] = useState<number>(0)

  // ---------------------------------------------------------------------------
  // ESTADOS DE CARREGAMENTO
  // ---------------------------------------------------------------------------

  /**
   * Controla o estado de carregamento inicial da página.
   * Enquanto `true`, exibe spinner/mensagem de carregamento em vez da tabela.
   * Separado de `saving` pois são operações distintas: leitura inicial vs. escrita.
   */
  const [loading, setLoading] = useState(true)

  /**
   * Controla se uma operação de escrita (add, remove, move) está em andamento.
   * Enquanto `true`, desabilita todos os botões de ação para evitar duplo clique.
   * Compartilhado entre múltiplas operações que não podem ser executadas em paralelo.
   */
  const [saving, setSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // ESTADOS DOS MODAIS
  // ---------------------------------------------------------------------------

  /**
   * Controla visibilidade do modal "Adicionar à Fila".
   * Separado como booleano pois não precisa carregar dados antes de abrir
   * (o formulário começa vazio com DEFAULT_ADD_FORM).
   */
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  /**
   * Controla visibilidade do modal de confirmação de remoção.
   * Sempre acompanhado de `selectedEntry` para saber qual candidato remover.
   */
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false)

  // ---------------------------------------------------------------------------
  // ESTADOS DO FLUXO "FECHAR CONTRATO"
  // ---------------------------------------------------------------------------

  /**
   * Controla visibilidade do modal de fechamento de contrato.
   * É o modal mais complexo da página: cria contrato, atualiza moto, registra caução.
   */
  const [isContractModalOpen, setIsContractModalOpen] = useState(false)

  /**
   * Entrada da fila que está sendo convertida em contrato.
   * Necessário para acessar `customer_id` e o nome do candidato durante o processo.
   */
  const [contractEntry, setContractEntry] = useState<QueueEntry | null>(null)

  /**
   * Lista de motos disponíveis carregada ao abrir o modal de contrato.
   * Carregada sob demanda (não na inicialização) para não fazer queries desnecessárias.
   */
  const [availableMotorcycles, setAvailableMotorcycles] = useState<AvailableMotorcycle[]>([])

  /**
   * Estado de carregamento específico do modal de contrato.
   * Separado de `saving` pois o contrato envolve múltiplas operações em sequência
   * e precisa de um loading state próprio para o botão "Confirmar Contrato".
   */
  const [contractSaving, setContractSaving] = useState(false)

  /**
   * Dados do formulário de fechamento de contrato.
   * Inicializado com a data de início como hoje (padrão mais comum).
   * O campo `weekly_amount` é o valor SEMANAL — salvo em `contracts.monthly_amount`
   * (nome histórico da coluna, que na prática armazena o valor semanal).
   */
  const [contractForm, setContractForm] = useState({
    motorcycle_id: '',
    contract_type: 'rental' as 'rental' | 'loyalty',
    start_date: new Date().toISOString().split('T')[0],
    end_date: calcEndDate(new Date().toISOString().split('T')[0], 'rental'),
    weekly_amount: '',
    deposit_paid: false,
    deposit_amount: '',
    deposit_payment_method: 'PIX',
    initial_km: '',
  })

  // ---------------------------------------------------------------------------
  // ESTADOS DE SELEÇÃO E AÇÕES
  // ---------------------------------------------------------------------------

  /**
   * Entrada da fila selecionada para ações que precisam de confirmação (remoção).
   * Salvo em estado para que o modal de confirmação saiba qual candidato está sendo removido.
   */
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null)

  // ---------------------------------------------------------------------------
  // ESTADOS DO MODAL DE EDIÇÃO
  // ---------------------------------------------------------------------------

  /**
   * Controla visibilidade do modal de edição de candidato.
   * Abre após `openEditModal` buscar os dados completos do cliente no banco.
   */
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  /**
   * Entrada da fila cujo candidato está sendo editado.
   * Necessário para acessar `customer_id` durante o save da edição.
   */
  const [editingEntry, setEditingEntry] = useState<QueueEntry | null>(null)

  /**
   * Dados do formulário de edição do candidato.
   * Inicializado com DEFAULT_ADD_FORM (vazio) e populado com dados reais
   * quando `openEditModal` busca o cliente no banco.
   */
  const [editForm, setEditForm] = useState(DEFAULT_ADD_FORM)

  /**
   * Estado de carregamento específico do modal de edição.
   * Separado de `saving` para não bloquear os botões da tabela principal enquanto salva a edição.
   */
  const [editSaving, setEditSaving] = useState(false)

  // ---------------------------------------------------------------------------
  // ESTADOS DO MODAL DE REORDENAÇÃO
  // ---------------------------------------------------------------------------

  /**
   * Controla visibilidade do modal de alteração de posição na fila.
   * Sempre acompanhado de `moveEntry` e `moveDirection`.
   */
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false)

  /**
   * Entrada da fila que está sendo movida.
   * Necessário para executar o swap de posições com o candidato adjacente.
   */
  const [moveEntry, setMoveEntry] = useState<QueueEntry | null>(null)

  /**
   * Direção do movimento: 'up' (sobe = menor número de posição) ou 'down' (desce).
   * Determina qual lista de motivos exibir (MOVE_UP_REASONS ou MOVE_DOWN_REASONS)
   * e qual candidato adjacente será trocado.
   */
  const [moveDirection, setMoveDirection] = useState<'up' | 'down' | null>(null)

  /**
   * Motivo selecionado para a movimentação na fila.
   * Obrigatório — o sistema não permite mover sem selecionar um motivo.
   * Salvo na coluna `notes` de ambos os candidatos envolvidos no swap.
   */
  const [moveReason, setMoveReason] = useState('')

  // ---------------------------------------------------------------------------
  // ESTADO DO FORMULÁRIO DE ADIÇÃO
  // ---------------------------------------------------------------------------

  /**
   * Dados do formulário de cadastro de novo candidato.
   * Inicializado com DEFAULT_ADD_FORM e resetado após cada cadastro bem-sucedido.
   */
  const [addForm, setAddForm] = useState(DEFAULT_ADD_FORM)

  /**
   * @function resetAddForm
   * @description Reseta o formulário de adição para o estado inicial vazio.
   *
   * @motivation
   * Chamada após fechar o modal sem salvar ou após salvar com sucesso,
   * garantindo que o próximo candidato não herde dados do anterior.
   */
  const resetAddForm = useCallback(() => setAddForm(DEFAULT_ADD_FORM), [])

  // =============================================================================
  // FUNÇÕES DE LEITURA (FETCH)
  // =============================================================================

  /**
   * @function fetchQueue
   * @description Busca a lista completa da fila de espera ordenada por posição.
   *
   * @motivation
   * Realiza JOIN com a tabela `customers` para exibir nome, telefone e CNH
   * diretamente na tabela sem precisar de queries adicionais. Ordenar por `position`
   * ASC garante que o primeiro da lista é sempre o candidato de maior prioridade.
   * Chamada após cada operação de escrita para manter a UI sincronizada.
   */
  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*, customers(name, phone, drivers_license)')
      .order('position', { ascending: true })

    if (error) {
      return
    }

    // Cast necessário pois o Supabase não infere automaticamente o tipo do join aninhado
    setQueueEntries((data as unknown as QueueEntry[]) || [])
  }, [supabase])

  /**
   * @function fetchMotosCount
   * @description Busca apenas a contagem de motos com status 'available'.
   *
   * @motivation
   * Usar `count: 'exact'` com `head: true` faz uma query COUNT otimizada no banco,
   * retornando apenas o número sem carregar os dados das motos. Isso é suficiente
   * para exibir o card de estatísticas e disparar o alerta de oportunidade.
   */
  const fetchMotosCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('motorcycles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'available')

    if (error) {
      return
    }

    setAvailableMotosCount(count || 0)
  }, [supabase])

  /**
   * @function fetchAvailableMotorcycles
   * @description Busca a lista detalhada de motos disponíveis para o modal de contrato.
   *
   * @motivation
   * Diferente de `fetchMotosCount`, esta função busca os dados completos das motos
   * para popular o select no modal de fechamento de contrato. Inclui `km_current`
   * para pré-preencher o campo "KM Inicial" automaticamente. Chamada sob demanda
   * ao abrir o modal, não na inicialização, para evitar queries desnecessárias.
   */
  const fetchAvailableMotorcycles = useCallback(async () => {
    const { data, error } = await supabase
      .from('motorcycles')
      .select('id, license_plate, model, make, km_current')
      .eq('status', 'available')
      .order('license_plate')

    if (error) {
      return
    }

    setAvailableMotorcycles(data || [])
  }, [supabase])

  /**
   * @function loadData
   * @description Carrega todos os dados necessários para a página em paralelo.
   *
   * @motivation
   * Usar `Promise.all` para buscar a fila e a contagem de motos simultaneamente
   * reduz o tempo de carregamento inicial pela metade (duas queries em paralelo
   * em vez de sequenciais). O estado `loading` garante que a tabela não apareça
   * com dados incompletos enquanto as queries estão em andamento.
   */
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Executa ambas as queries em paralelo para minimizar o tempo de carregamento
      await Promise.all([fetchQueue(), fetchMotosCount()])
    } catch {
    } finally {
      // Garante que o loading seja desativado mesmo se uma das queries falhar
      setLoading(false)
    }
  }, [fetchQueue, fetchMotosCount])

  // Carrega os dados uma única vez ao montar o componente
  useEffect(() => {
    loadData()
  }, [loadData])

  // =============================================================================
  // FUNÇÕES DE ESCRITA (MUTATIONS)
  // =============================================================================

  /**
   * @function reorderQueuePositions
   * @description Reordena as posições da fila para eliminar buracos numéricos.
   *
   * @motivation
   * Após remover um candidato da posição 2 de uma fila [1, 2, 3], as posições
   * ficariam [1, 3] — um "buraco". Esta função normaliza para [1, 2], garantindo
   * que as posições sejam sempre contínuas a partir de 1. Chamada após remoção
   * e após fechar contrato para manter a integridade da numeração.
   *
   * As atualizações são feitas sequencialmente (não em paralelo) para evitar
   * conflitos em caso de existir restrição única na coluna `position`.
   */
  const reorderQueuePositions = useCallback(async () => {
    // Busca a fila atual em ordem para saber quais posições precisam ser corrigidas
    const { data: currentQueue } = await supabase
      .from('queue_entries')
      .select('id, position')
      .order('position', { ascending: true })

    if (!currentQueue) return

    // Percorre a fila e corrige apenas as entradas com posição fora do esperado
    for (let i = 0; i < currentQueue.length; i++) {
      const expectedPosition = i + 1
      // Só atualiza se a posição atual diverge da esperada — evita updates desnecessários
      if (currentQueue[i].position !== expectedPosition) {
        await supabase
          .from('queue_entries')
          .update({ position: expectedPosition })
          .eq('id', currentQueue[i].id)
      }
    }
  }, [supabase])

  /**
   * @function handleAddToQueue
   * @description Cadastra um novo candidato na fila de espera com seus documentos.
   *
   * @motivation
   * O fluxo de negócio exige que candidatos sejam registrados DIRETAMENTE na fila,
   * não na tela de Clientes. Isso porque um candidato ainda não é cliente — ele
   * está aguardando uma moto disponível. Ao se tornar cliente (via "Fechar Contrato"),
   * o campo `in_queue` é alterado para `false` e ele aparece na tela de Clientes.
   *
   * O processo é em 3 etapas:
   * 1. Cria o registro do cliente em `customers` com `in_queue: true`
   * 2. Insere a entrada na fila em `queue_entries` com a próxima posição disponível
   * 3. Faz upload dos documentos para o Supabase Storage e atualiza as URLs no cliente
   *
   * @validações
   * - Nome, CPF e Telefone são obrigatórios (mínimo para identificar o candidato)
   * - Documentos são opcionais no cadastro (podem ser adicionados depois via edição)
   */
  const handleAddToQueue = useCallback(async () => {
    // Validação mínima: nome, CPF e telefone são obrigatórios para identificar o candidato
    if (!addForm.name || !addForm.cpf || !addForm.phone) {
      alert('Nome, CPF e Telefone são obrigatórios.')
      return
    }

    setSaving(true)
    try {
      // ETAPA 1: Criar o registro do cliente com in_queue: true
      // O candidato ainda não é cliente ativo, por isso `in_queue: true` e `active: true`
      const { data: newCustomer, error: insertCustomerError } = await supabase
        .from('customers')
        .insert({
          name: addForm.name,
          cpf: addForm.cpf,
          rg: addForm.rg || null,
          state: addForm.state || null,
          phone: addForm.phone,
          email: addForm.email || null,
          address: addForm.address || null,
          zip_code: addForm.zipCode || null,
          emergency_contact: addForm.emergencyContact || null,
          drivers_license: addForm.cnh || null,
          drivers_license_validity: addForm.cnhExpiry || null,
          drivers_license_category: addForm.cnhCategory || null,
          birth_date: addForm.birthDate || null,
          observations: addForm.notes || null,
          in_queue: true,  // Marca como candidato na fila, não cliente ativo
          active: true,
        })
        .select('id')
        .single()

      if (insertCustomerError) throw insertCustomerError

      // ETAPA 2: Calcular a próxima posição disponível e inserir na fila
      // Usa Math.max para pegar a maior posição existente e adicionar 1
      // Se a fila estiver vazia, começa na posição 1
      const nextPosition =
        queueEntries.length > 0
          ? Math.max(...queueEntries.map((e) => e.position)) + 1
          : 1

      const { error: insertQueueError } = await supabase.from('queue_entries').insert({
        customer_id: newCustomer.id,
        position: nextPosition,
        notes: addForm.notes || null,
      })

      if (insertQueueError) throw insertQueueError

      // ETAPA 3: Upload de documentos para o Supabase Storage
      // Os paths seguem o padrão: customers/{id}/{tipo}_{timestamp}.{ext}
      // O timestamp no nome evita conflitos caso o documento seja substituído depois
      const urlUpdates: { drivers_license_photo_url?: string; document_photo_url?: string } = {}

      if (addForm.cnhFile) {
        const ext = addForm.cnhFile.name.split('.').pop()
        const path = `customers/${newCustomer.id}/cnh_${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, addForm.cnhFile)
        if (!uploadErr) {
          // Gera URL pública para exibição futura no modal de detalhes do cliente
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          urlUpdates.drivers_license_photo_url = urlData.publicUrl
        }
      }

      if (addForm.residenceFile) {
        const ext = addForm.residenceFile.name.split('.').pop()
        const path = `customers/${newCustomer.id}/residencia_${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, addForm.residenceFile)
        if (!uploadErr) {
          // Gera URL pública para exibição futura no modal de detalhes do cliente
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          urlUpdates.document_photo_url = urlData.publicUrl
        }
      }

      // Só faz o UPDATE de URLs se pelo menos um documento foi enviado com sucesso
      if (Object.keys(urlUpdates).length > 0) {
        await supabase.from('customers').update(urlUpdates).eq('id', newCustomer.id)
      }

      // Fecha o modal, limpa o formulário e atualiza a lista
      setIsAddModalOpen(false)
      resetAddForm()
      await fetchQueue()
    } catch {
      alert('Ocorreu um erro ao adicionar à fila. Verifique os dados e tente novamente.')
    } finally {
      setSaving(false)
    }
  }, [supabase, addForm, queueEntries, fetchQueue, resetAddForm])

  /**
   * @function handleRemoveFromQueue
   * @description Remove um candidato da fila de espera sem criar contrato.
   *
   * @motivation
   * Usado quando o candidato desistiu, não compareceu ou foi reprovado.
   * A remoção não exclui o registro do cliente — apenas remove a entrada da fila
   * e marca `in_queue: false` para que o candidato não apareça em nenhuma tela.
   * Após a remoção, as posições são reordenadas para eliminar buracos.
   */
  const handleRemoveFromQueue = useCallback(async () => {
    // Verificação de segurança: não deve ser chamada sem uma entrada selecionada
    if (!selectedEntry) return

    setSaving(true)
    try {
      // Remove a entrada da fila de espera
      const { error: deleteError } = await supabase
        .from('queue_entries')
        .delete()
        .eq('id', selectedEntry.id)

      if (deleteError) throw deleteError

      // Marca o cliente como fora da fila para que não apareça em relatórios de fila
      const { error: updateError } = await supabase
        .from('customers')
        .update({ in_queue: false })
        .eq('id', selectedEntry.customer_id)

      if (updateError) throw updateError

      // Renumera as posições restantes para evitar buracos (ex: 1, 3, 4 → 1, 2, 3)
      await reorderQueuePositions()

      // Fecha o modal e limpa a seleção
      setIsRemoveModalOpen(false)
      setSelectedEntry(null)
      await fetchQueue()
    } catch {
    } finally {
      setSaving(false)
    }
  }, [supabase, selectedEntry, reorderQueuePositions, fetchQueue])

  /**
   * @function openMoveModal
   * @description Abre o modal de reordenação validando se o movimento é possível.
   *
   * @motivation
   * Antes de abrir o modal, verifica se o movimento faz sentido:
   * o primeiro da fila não pode subir mais, o último não pode descer.
   * Essa validação evita abrir um modal para uma ação impossível de executar.
   *
   * @param entry - A entrada da fila que será movida
   * @param direction - Direção do movimento: 'up' (prioridade maior) ou 'down'
   */
  const openMoveModal = useCallback((entry: QueueEntry, direction: 'up' | 'down') => {
    // Não permite subir se já é o primeiro (posição 1)
    if (direction === 'up' && entry.position <= 1) return
    // Não permite descer se já é o último
    if (direction === 'down' && entry.position >= Math.max(...queueEntries.map((e) => e.position))) return

    setMoveEntry(entry)
    setMoveDirection(direction)
    // Reseta o motivo para forçar o operador a selecionar um novo para cada movimentação
    setMoveReason('')
    setIsMoveModalOpen(true)
  }, [queueEntries])

  /**
   * @function handleConfirmMove
   * @description Executa o swap de posições entre dois candidatos adjacentes na fila.
   *
   * @motivation
   * A reordenação é feita como um "swap" entre dois candidatos adjacentes:
   * o candidato A e o candidato B (que está na posição imediatamente acima ou abaixo).
   * Ambos têm suas posições e notas atualizadas para registrar o motivo da movimentação.
   *
   * As atualizações são feitas em sequência (não em paralelo) para evitar
   * condição de corrida caso o banco tenha restrição única na coluna `position`.
   */
  const handleConfirmMove = useCallback(async () => {
    // Verificações de segurança antes de executar
    if (!moveEntry || !moveDirection) return

    // Motivo obrigatório — regra de negócio de auditoria
    if (!moveReason) {
      alert('Selecione o motivo da movimentação.')
      return
    }

    setSaving(true)
    try {
      if (moveDirection === 'up') {
        // Swap para CIMA: o candidato sobe 1 posição, o anterior desce 1
        const prevEntry = queueEntries.find((e) => e.position === moveEntry.position - 1)
        if (!prevEntry) return

        // O candidato que DESCEU registra a nota de por que foi ultrapassado
        await supabase.from('queue_entries').update({ position: moveEntry.position, notes: getDownNote(moveReason) }).eq('id', prevEntry.id)
        // O candidato que SUBIU registra o motivo da sua promoção na fila
        await supabase.from('queue_entries').update({ position: moveEntry.position - 1, notes: `Subiu na fila: ${moveReason}` }).eq('id', moveEntry.id)
      } else {
        // Swap para BAIXO: o candidato desce 1 posição, o próximo sobe 1
        const nextEntry = queueEntries.find((e) => e.position === moveEntry.position + 1)
        if (!nextEntry) return

        // O candidato que SUBIU por consequência da descida do outro registra nota genérica
        await supabase.from('queue_entries').update({ position: moveEntry.position, notes: 'Subiu na fila: Reordenação da fila' }).eq('id', nextEntry.id)
        // O candidato que DESCEU registra o motivo da sua descida
        await supabase.from('queue_entries').update({ position: moveEntry.position + 1, notes: `Desceu na fila: ${moveReason}` }).eq('id', moveEntry.id)
      }

      setIsMoveModalOpen(false)
      await fetchQueue()
    } catch {
      alert('Erro ao mover candidato na fila.')
    } finally {
      setSaving(false)
    }
  }, [supabase, moveEntry, moveDirection, moveReason, queueEntries, fetchQueue])

  /**
   * @function openEditModal
   * @description Busca os dados completos do cliente no banco e abre o modal de edição.
   *
   * @motivation
   * O estado `queueEntries` contém apenas name, phone e drivers_license do cliente
   * (seleção parcial para performance). Para editar, precisamos de TODOS os campos.
   * Por isso, fazemos uma query separada com `select('*')` ao abrir o modal de edição,
   * em vez de carregar todos os dados na query principal da fila.
   *
   * @param entry - A entrada da fila cujo candidato será editado
   */
  const openEditModal = useCallback(async (entry: QueueEntry) => {
    setEditingEntry(entry)

    // Busca todos os campos do cliente para popular o formulário de edição
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('id', entry.customer_id)
      .single()

    if (data) {
      // Mapeia os campos do banco para o formato do formulário local
      setEditForm({
        name: data.name || '',
        cpf: data.cpf || '',
        rg: data.rg || '',
        state: data.state || 'RJ',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        zipCode: data.zip_code || '',
        emergencyContact: data.emergency_contact || '',
        cnh: data.drivers_license || '',
        cnhExpiry: data.drivers_license_validity || '',
        cnhCategory: data.drivers_license_category || 'A',
        birthDate: data.birth_date || '',
        notes: data.observations || '',
        // Arquivos começam nulos — só serão enviados se o operador selecionar novos arquivos
        cnhFile: null,
        residenceFile: null,
      })
    }
    setIsEditModalOpen(true)
  }, [supabase])

  /**
   * @function handleSaveEdit
   * @description Salva as alterações nos dados do candidato e faz upload de novos documentos.
   *
   * @motivation
   * O operador pode precisar corrigir dados do candidato (ex: telefone errado, CNH expirada)
   * ou adicionar/substituir documentos enquanto o candidato aguarda na fila.
   * O upload de novos documentos é opcional — se nenhum arquivo for selecionado,
   * apenas os dados textuais são atualizados.
   *
   * @validações
   * - Nome, CPF e Telefone são obrigatórios (mínimo para identificar o candidato)
   */
  const handleSaveEdit = useCallback(async () => {
    // Verificação de segurança: não deve ser chamada sem uma entrada em edição
    if (!editingEntry) return

    // Validação dos campos obrigatórios
    if (!editForm.name || !editForm.cpf || !editForm.phone) {
      alert('Nome, CPF e Telefone são obrigatórios.')
      return
    }

    setEditSaving(true)
    try {
      // Atualiza os dados textuais do cliente na tabela customers
      const { error: updateError } = await supabase
        .from('customers')
        .update({
          name: editForm.name,
          cpf: editForm.cpf,
          rg: editForm.rg || null,
          state: editForm.state || null,
          phone: editForm.phone,
          email: editForm.email || null,
          address: editForm.address || null,
          zip_code: editForm.zipCode || null,
          emergency_contact: editForm.emergencyContact || null,
          drivers_license: editForm.cnh || null,
          drivers_license_validity: editForm.cnhExpiry || null,
          drivers_license_category: editForm.cnhCategory || null,
          birth_date: editForm.birthDate || null,
          observations: editForm.notes || null,
        })
        .eq('id', editingEntry.customer_id)

      if (updateError) throw updateError

      // Upload de novos documentos se o operador selecionou arquivos
      // O timestamp no path garante que o novo arquivo não sobrescreva o anterior (mantém histórico)
      const urlUpdates: { drivers_license_photo_url?: string; document_photo_url?: string } = {}

      if (editForm.cnhFile) {
        const ext = editForm.cnhFile.name.split('.').pop()
        const path = `customers/${editingEntry.customer_id}/cnh_${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, editForm.cnhFile)
        if (!uploadErr) {
          // Atualiza a URL no banco para apontar para o documento mais recente
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          urlUpdates.drivers_license_photo_url = urlData.publicUrl
        }
      }

      if (editForm.residenceFile) {
        const ext = editForm.residenceFile.name.split('.').pop()
        const path = `customers/${editingEntry.customer_id}/residencia_${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, editForm.residenceFile)
        if (!uploadErr) {
          // Atualiza a URL no banco para apontar para o documento mais recente
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          urlUpdates.document_photo_url = urlData.publicUrl
        }
      }

      // Só faz o UPDATE de URLs se pelo menos um documento foi enviado com sucesso
      if (Object.keys(urlUpdates).length > 0) {
        await supabase.from('customers').update(urlUpdates).eq('id', editingEntry.customer_id)
      }

      setIsEditModalOpen(false)
      await fetchQueue()
    } catch {
      alert('Erro ao salvar. Verifique os dados e tente novamente.')
    } finally {
      setEditSaving(false)
    }
  }, [supabase, editForm, editingEntry, fetchQueue])

  /**
   * @function openRemoveModal
   * @description Armazena a entrada selecionada e abre o modal de confirmação de remoção.
   *
   * @motivation
   * A remoção é uma ação irreversível (o candidato sai da fila e precisa ser recadastrado
   * se quiser voltar). Por isso exige confirmação explícita via modal.
   *
   * @param entry - A entrada da fila que será removida
   */
  const openRemoveModal = useCallback((entry: QueueEntry) => {
    setSelectedEntry(entry)
    setIsRemoveModalOpen(true)
  }, [])

  /**
   * @function openContractModal
   * @description Carrega as motos disponíveis e abre o modal de fechamento de contrato.
   *
   * @motivation
   * O modal de contrato precisa listar as motos disponíveis no momento do clique.
   * Carregamos sob demanda (não na inicialização da página) para garantir que a lista
   * esteja sempre atualizada. O formulário é resetado para evitar dados do contrato anterior.
   *
   * @param entry - A entrada da fila que será convertida em contrato
   */
  const openContractModal = useCallback(async (entry: QueueEntry) => {
    setContractEntry(entry)
    // Carrega motos disponíveis em tempo real para garantir dados atualizados
    await fetchAvailableMotorcycles()
    // Reseta o formulário com a data de início como hoje e end_date auto-calculado
    const today = new Date().toISOString().split('T')[0]
    setContractForm({
      motorcycle_id: '',
      contract_type: 'rental',
      start_date: today,
      end_date: calcEndDate(today, 'rental'),
      weekly_amount: '',
      deposit_paid: false,
      deposit_amount: '',
      deposit_payment_method: 'PIX',
      initial_km: '',
    })
    setIsContractModalOpen(true)
  }, [fetchAvailableMotorcycles])

  /**
   * @function handleCloseContract
   * @description Executa o fluxo completo de fechamento de contrato.
   *
   * @motivation
   * Esta é a operação mais importante da página. Quando um candidato "fecha contrato":
   * 1. Um contrato ativo é criado no banco linkando cliente ↔ moto
   * 2. A moto muda de status 'available' para 'rented' e tem o KM inicial registrado
   * 3. Se caução foi paga, um lançamento financeiro é criado em `incomes`
   * 4. O candidato deixa de ser da fila (`in_queue: false`)
   * 5. A entrada na fila é removida e as posições são reordenadas
   *
   * @nota-importante
   * O campo `monthly_amount` na tabela `contracts` armazena o valor SEMANAL da locação.
   * O nome histórico da coluna é "monthly" mas a locadora trabalha com recebimento semanal.
   * NÃO dividir por 4 — salvar o valor exatamente como digitado pelo operador.
   *
   * @validações
   * - Moto, data de início, valor semanal e KM inicial são obrigatórios
   */
  const handleCloseContract = useCallback(async () => {
    const { motorcycle_id, start_date, weekly_amount, initial_km, deposit_paid, deposit_amount, deposit_payment_method, end_date } = contractForm

    // Valida campos obrigatórios antes de iniciar o fluxo multi-etapas
    if (!motorcycle_id || !start_date || !weekly_amount || !initial_km) {
      alert('Por favor, preencha todos os campos obrigatórios (Moto, Data, Valor e KM).')
      return
    }

    // Verificação de segurança: contractEntry deve estar definido
    if (!contractEntry) return

    setContractSaving(true)
    try {
      // ETAPA 1: Criar o contrato ativo no banco
      // `monthly_amount` recebe o valor SEMANAL (nome histórico da coluna, não alterar)
      const { error: contractError } = await supabase.from('contracts').insert({
        customer_id: contractEntry.customer_id,
        motorcycle_id,
        start_date,
        end_date: end_date || null,
        monthly_amount: parseFloat(weekly_amount), // Valor semanal — NÃO dividir por 4
        contract_type: contractForm.contract_type,
        status: 'active',
        observations: 'KM inicial: ' + initial_km,
      })

      if (contractError) throw contractError

      // ETAPA 2: Atualizar status da moto para 'rented' e registrar o KM inicial
      // O KM inicial é salvo em `km_current` para referência futura de manutenção e multas
      const { error: motoError } = await supabase
        .from('motorcycles')
        .update({ status: 'rented', km_current: parseInt(initial_km, 10) })
        .eq('id', motorcycle_id)

      if (motoError) throw motoError

      // ETAPA 3: Registrar caução como entrada financeira (somente se foi informado que foi paga)
      if (deposit_paid && deposit_amount) {
        // Busca os dados da moto selecionada para usar a placa no lançamento
        const moto = availableMotorcycles.find(m => m.id === motorcycle_id)
        const { error: incomeError } = await supabase.from('incomes').insert({
          description: `Caução - ${contractEntry.customers?.name || ''}`,
          vehicle: moto?.license_plate || '',
          date: new Date().toISOString().split('T')[0],
          lessee: contractEntry.customers?.name || '',
          amount: parseFloat(deposit_amount),
          reference: 'Caucao',
          payment_method: deposit_payment_method,
        })
        if (incomeError) throw incomeError
      }

      // ETAPA 4: Remover o candidato da fila — ele agora é um cliente ativo
      const { error: customerError } = await supabase
        .from('customers')
        .update({ in_queue: false })
        .eq('id', contractEntry.customer_id)

      if (customerError) throw customerError

      // ETAPA 5: Deletar a entrada da fila e reordenar as posições restantes
      const { error: deleteError } = await supabase
        .from('queue_entries')
        .delete()
        .eq('id', contractEntry.id)

      if (deleteError) throw deleteError

      // Renumera as posições para eliminar o "buraco" deixado pelo candidato que saiu
      await reorderQueuePositions()

      setIsContractModalOpen(false)
      // Recarrega tanto a fila quanto a contagem de motos (pois uma moto saiu do disponível)
      loadData()
    } catch {
      alert('Ocorreu um erro ao fechar o contrato. Tente novamente.')
    } finally {
      setContractSaving(false)
    }
  }, [supabase, contractForm, contractEntry, availableMotorcycles, reorderQueuePositions, loadData])

  // =============================================================================
  // RENDERIZAÇÃO
  // =============================================================================

  // Exibe mensagem de carregamento enquanto as queries iniciais estão em andamento
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#121212] p-8">
        <div className="text-[#9e9e9e]">Carregando fila...</div>
      </div>
    )
  }

  // Nome do próximo candidato a ser atendido (primeiro da fila ou mensagem padrão)
  const nextInLine = queueEntries.length > 0 ? queueEntries[0].customers?.name : 'Nenhum'

  return (
    <div className="flex min-h-screen flex-col bg-[#121212]">

      {/* Cabeçalho com título, subtítulo dinâmico e botão de ação principal */}
      <Header
        title="Fila de Espera"
        subtitle={`${queueEntries.length} pessoa(s) aguardando · ${availableMotosCount} moto(s) disponível(is)`}
        actions={
          // Botão primário para abrir o modal de cadastro de novo candidato
          <Button variant="primary" onClick={() => {
            resetAddForm()  // Garante formulário limpo antes de abrir
            setIsAddModalOpen(true)
          }}>
            <UserPlus className="h-4 w-4" />
            Adicionar à Fila
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">

      {/* Alerta de oportunidade: exibido apenas quando há motos disponíveis E candidatos esperando */}
      {availableMotosCount > 0 && queueEntries.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-[#6b9900] bg-[#323232] p-4 text-[#BAFF1A]">
          <AlertTriangle className="h-6 w-6 flex-shrink-0" />
          <p className="text-[13px] font-medium">
            Há {availableMotosCount} moto(s) disponível(is) e {queueEntries.length} pessoa(s) na fila!
            Considere alocar alguém.
          </p>
        </div>
      )}

      {/* Cards de estatísticas rápidas — visão geral da situação atual da fila */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">

        {/* Card: total de candidatos aguardando */}
        <div className="flex items-center justify-between rounded-2xl border border-[#474747] bg-[#202020] px-6 py-4">
          <div>
            <p className="text-[14px] font-normal text-[#9e9e9e]">Total na Fila</p>
            <p className="text-[28px] font-bold text-[#f5f5f5]">{queueEntries.length}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#323232] text-[#BAFF1A]">
            <Users className="h-6 w-6" />
          </div>
        </div>

        {/* Card: motos disponíveis para alocação imediata */}
        <div className="flex items-center justify-between rounded-2xl border border-[#474747] bg-[#202020] px-6 py-4">
          <div>
            <p className="text-[14px] font-normal text-[#9e9e9e]">Motos Disponíveis</p>
            <p className="text-[28px] font-bold text-[#f5f5f5]">{availableMotosCount}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#323232] text-[#BAFF1A]">
            <Bike className="h-6 w-6" />
          </div>
        </div>

        {/* Card: nome do próximo candidato — facilita identificação rápida de quem atender */}
        <div className="flex items-center justify-between rounded-2xl border border-[#474747] bg-[#202020] px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-normal text-[#9e9e9e]">Próximo da Fila</p>
            <p className="truncate text-[28px] font-bold text-[#f5f5f5]" title={nextInLine ?? ''}>
              {nextInLine}
            </p>
          </div>
          <div className="ml-3 flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-[#323232] text-[#BAFF1A]">
            <UserPlus className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Tabela principal da fila de espera */}
      <div className="overflow-hidden rounded-xl bg-[#202020]">
        {queueEntries.length === 0 ? (
          // Estado vazio: exibido quando não há candidatos na fila
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Users className="mb-4 h-12 w-12 text-[#474747]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhum cliente na fila de espera.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">
              Adicione clientes para iniciar a fila de locação.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead>
                <tr className="border-b border-[#323232]">
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">#</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Cliente</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Telefone</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">CNH</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Desde</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Observações</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {queueEntries.map((entry, index) => (
                  <tr key={entry.id} className="border-b border-[#323232] transition-colors hover:bg-[#323232] h-9">

                    {/* Posição na fila exibida como Badge para destaque visual */}
                    <td className="whitespace-nowrap px-4">
                      <Badge variant="brand">{entry.position}º</Badge>
                    </td>

                    {/* Nome do candidato — em negrito pois é o identificador principal */}
                    <td className="px-4 font-medium">
                      {entry.customers?.name || 'Cliente Desconhecido'}
                    </td>

                    <td className="whitespace-nowrap px-4">
                      {entry.customers?.phone || '-'}
                    </td>

                    <td className="whitespace-nowrap px-4">
                      {entry.customers?.drivers_license || '-'}
                    </td>

                    {/* Data de entrada na fila — mostra há quanto tempo o candidato aguarda */}
                    <td className="whitespace-nowrap px-4 text-[#9e9e9e]">
                      {formatDate(entry.created_at)}
                    </td>

                    {/* Observações truncadas com tooltip para ver o texto completo ao hover */}
                    <td className="max-w-xs truncate px-4 text-[#9e9e9e]"
                      title={entry.notes || ''}
                    >
                      {entry.notes || '-'}
                    </td>

                    {/* Coluna de ações — botões de ícone padronizados pelo design system */}
                    <td className="whitespace-nowrap px-4 text-right">
                      <div className="flex items-center justify-end gap-1">

                        {/* Seta para cima: sobe o candidato na fila — desabilitado se já é o primeiro */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => openMoveModal(entry, 'up')}
                          disabled={index === 0 || saving}
                          title="Subir posição"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>

                        {/* Seta para baixo: desce o candidato — desabilitado se já é o último */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => openMoveModal(entry, 'down')}
                          disabled={index === queueEntries.length - 1 || saving}
                          title="Descer posição"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>

                        {/* Editar: cor secundária (#323232) — ação neutra, sem risco */}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => openEditModal(entry)}
                          disabled={saving}
                          title="Editar candidato"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>

                        {/* Fechar Contrato: cor primária (#BAFF1A) — ação positiva principal */}
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => openContractModal(entry)}
                          disabled={saving}
                          title="Fechar Contrato"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>

                        {/* Remover: cor danger (#bf1d1e) — ação destrutiva, exige confirmação */}
                        <Button
                          variant="danger"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => openRemoveModal(entry)}
                          disabled={saving}
                          title="Remover da fila"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===================================================================
          MODAIS
          =================================================================== */}

      {/* Modal: Fechar Contrato
          Fluxo mais crítico: cria contrato, atualiza moto, registra caução, remove da fila */}
      <Modal
        open={isContractModalOpen}
        onClose={() => !contractSaving && setIsContractModalOpen(false)}
        title={`Fechar Contrato - ${contractEntry?.customers?.name || 'Cliente'}`}
        size="lg"
      >
        <div className="flex flex-col gap-4 py-2">
          {availableMotorcycles.length === 0 ? (
            // Exibe aviso quando não há motos disponíveis — impede fechamento de contrato sem moto
            <div className="rounded-lg bg-[#323232] p-4 text-center text-[13px] text-[#9e9e9e]">
              Não há motocicletas disponíveis no momento.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Tipo de contrato — define vigência mínima e cálculo automático do término */}
              <div className="md:col-span-2">
                <Select
                  label="Tipo de Contrato *"
                  value={contractForm.contract_type}
                  onChange={(e) => {
                    const type = e.target.value as 'rental' | 'loyalty'
                    setContractForm(prev => ({
                      ...prev,
                      contract_type: type,
                      end_date: calcEndDate(prev.start_date, type),
                    }))
                  }}
                  options={[
                    { value: 'rental', label: 'Locação (vigência mínima de 3 meses)' },
                    { value: 'loyalty', label: 'Com Fidelidade — Promessa de Compra (2 anos)' },
                  ]}
                />
              </div>

              {/* Seleção da moto — ao selecionar, pré-preenche o KM inicial automaticamente */}
              <div className="md:col-span-2">
                <Select
                  label="Motocicleta *"
                  value={contractForm.motorcycle_id}
                  onChange={(e) => {
                    const motoId = e.target.value;
                    const selectedMoto = availableMotorcycles.find(m => m.id === motoId);
                    setContractForm(prev => ({
                      ...prev,
                      motorcycle_id: motoId,
                      initial_km: selectedMoto ? String(selectedMoto.km_current) : prev.initial_km
                    }));
                  }}
                  options={[
                    { value: '', label: 'Selecione uma motocicleta...' },
                    ...availableMotorcycles.map(m => ({
                      value: m.id,
                      label: `${m.license_plate} - ${m.make} ${m.model} (${m.km_current || 0} km)`
                    }))
                  ]}
                />
              </div>

              {/* Data de início: padrão hoje — ao alterar, recalcula o término */}
              <Input
                label="Data de Início *"
                type="date"
                value={contractForm.start_date}
                onChange={e => {
                  const startDate = e.target.value
                  setContractForm(prev => ({
                    ...prev,
                    start_date: startDate,
                    end_date: calcEndDate(startDate, prev.contract_type),
                  }))
                }}
              />

              {/* Data de término: auto-calculada pelo tipo, editável para ajustes */}
              <Input
                label="Data de Término *"
                type="date"
                value={contractForm.end_date}
                onChange={e => setContractForm(prev => ({ ...prev, end_date: e.target.value }))}
              />

              {/* Valor semanal: salvo em monthly_amount mas representa o valor por semana */}
              <Input
                label="Valor Semanal (R$) *"
                type="number"
                step="0.01"
                placeholder="Ex: 250.00"
                value={contractForm.weekly_amount}
                onChange={e => setContractForm(prev => ({ ...prev, weekly_amount: e.target.value }))}
              />

              {/* KM inicial: pré-preenchido ao selecionar a moto, mas editável */}
              <Input
                label="KM Inicial *"
                type="number"
                placeholder="Ex: 15000"
                value={contractForm.initial_km}
                onChange={e => setContractForm(prev => ({ ...prev, initial_km: e.target.value }))}
              />

              {/* Seção de caução: permite registrar se a caução foi paga no ato do contrato */}
              <div className="md:col-span-2 mt-4 pt-4 border-t border-[#323232]">
                <h4 className="text-[14px] font-medium text-[#f5f5f5] mb-3">Caução</h4>

                {/* Toggle de caução: botão ativo = primary (lime), inativo = outline */}
                <div className="flex gap-2 mb-4">
                  <Button
                    type="button"
                    variant={!contractForm.deposit_paid ? "primary" : "outline"}
                    onClick={() => setContractForm(prev => ({ ...prev, deposit_paid: false }))}
                  >
                    Não foi pago
                  </Button>
                  <Button
                    type="button"
                    variant={contractForm.deposit_paid ? "primary" : "outline"}
                    onClick={() => setContractForm(prev => ({ ...prev, deposit_paid: true }))}
                  >
                    Já foi pago
                  </Button>
                </div>

                {/* Campos de valor e forma de pagamento da caução — exibidos condicionalmente */}
                {contractForm.deposit_paid && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Valor da Caução (R$)"
                      type="number"
                      step="0.01"
                      placeholder="Ex: 500.00"
                      value={contractForm.deposit_amount}
                      onChange={e => setContractForm(prev => ({ ...prev, deposit_amount: e.target.value }))}
                    />
                    <Select
                      label="Forma de Pagamento"
                      value={contractForm.deposit_payment_method}
                      onChange={e => setContractForm(prev => ({ ...prev, deposit_payment_method: e.target.value }))}
                      options={[
                        { value: 'PIX', label: 'PIX' },
                        { value: 'DINHEIRO', label: 'Dinheiro' },
                        { value: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
                        { value: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
                      ]}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do modal com botões de cancelar e confirmar */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#323232] mt-4">
          <Button
            variant="secondary"
            onClick={() => setIsContractModalOpen(false)}
            disabled={contractSaving}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleCloseContract}
            disabled={contractSaving || availableMotorcycles.length === 0}
            loading={contractSaving}
          >
            Confirmar Contrato
          </Button>
        </div>
      </Modal>

      {/* Modal: Adicionar à Fila
          Cadastra novo candidato com todos os dados pessoais e documentos */}
      <Modal
        open={isAddModalOpen}
        onClose={() => !saving && setIsAddModalOpen(false)}
        title="Adicionar à Fila de Espera"
        size="lg"
      >
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Nome em largura total pois é o campo mais importante */}
            <div className="md:col-span-2">
              <Input
                label="Nome *"
                placeholder="Nome completo do candidato"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              />
            </div>

            {/* CPF e RG lado a lado — documentos de identificação */}
            <Input
              label="CPF *"
              placeholder="000.000.000-00"
              value={addForm.cpf}
              onChange={(e) => setAddForm({ ...addForm, cpf: e.target.value })}
            />
            <Input
              label="RG"
              placeholder="RG"
              value={addForm.rg}
              onChange={(e) => setAddForm({ ...addForm, rg: e.target.value })}
            />

            {/* Telefone e e-mail para contato */}
            <Input
              label="Telefone *"
              placeholder="(21) 99999-9999"
              value={addForm.phone}
              onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
            />
            <Input
              label="E-mail"
              type="email"
              placeholder="exemplo@email.com"
              value={addForm.email}
              onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
            />

            {/* Estado e data de nascimento — necessários para validação e identificação */}
            <Select
              label="Estado"
              options={UFS.map(uf => ({ value: uf, label: uf }))}
              value={addForm.state}
              onChange={(e) => setAddForm({ ...addForm, state: e.target.value })}
            />
            <Input
              label="Data de Nascimento"
              type="date"
              value={addForm.birthDate}
              onChange={(e) => setAddForm({ ...addForm, birthDate: e.target.value })}
            />

            {/* Endereço completo em largura total */}
            <div className="md:col-span-2">
              <Input
                label="Endereço"
                placeholder="Rua, número, bairro, complemento"
                value={addForm.address}
                onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
              />
            </div>

            {/* CEP e contato de emergência — informações de segurança e localização */}
            <Input
              label="CEP"
              placeholder="00000-000"
              value={addForm.zipCode}
              onChange={(e) => setAddForm({ ...addForm, zipCode: e.target.value })}
            />
            <Input
              label="Contato de Emergência"
              placeholder="Nome e telefone de familiar"
              value={addForm.emergencyContact}
              onChange={(e) => setAddForm({ ...addForm, emergencyContact: e.target.value })}
            />

            {/* Separador visual para seção de habilitação */}
            <div className="md:col-span-2 border-t border-[#323232] pt-4 mt-2">
              <h4 className="text-[12px] text-[#9e9e9e]">Habilitação</h4>
            </div>

            {/* Número e categoria da CNH — essenciais para validar permissão de conduzir moto */}
            <Input
              label="Número da CNH"
              placeholder="Número da habilitação"
              value={addForm.cnh}
              onChange={(e) => setAddForm({ ...addForm, cnh: e.target.value })}
            />
            <Select
              label="Categoria CNH"
              options={CNH_CATEGORIES.map(c => ({ value: c, label: c }))}
              value={addForm.cnhCategory}
              onChange={(e) => setAddForm({ ...addForm, cnhCategory: e.target.value })}
            />

            {/* Validade da CNH — importante para alertar sobre habilitações vencidas */}
            <Input
              label="Validade da CNH"
              type="date"
              value={addForm.cnhExpiry}
              onChange={(e) => setAddForm({ ...addForm, cnhExpiry: e.target.value })}
            />
            {/* Espaçador para manter o grid de 2 colunas alinhado */}
            <div className="hidden md:block"></div>

            {/* Observações gerais sobre o candidato */}
            <div className="md:col-span-2">
              <Textarea
                label="Observações"
                placeholder="Preferência de moto, urgência, observações gerais..."
                rows={3}
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
              />
            </div>

            {/* Seção de upload de documentos — componente reutilizado no modal de edição */}
            <DocumentUploadSection
              form={addForm}
              onChange={(updates) => setAddForm(prev => ({ ...prev, ...updates }))}
              mode="add"
            />
          </div>
        </div>

        {/* Rodapé do modal */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#323232] mt-4">
          <Button
            variant="secondary"
            onClick={() => setIsAddModalOpen(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleAddToQueue}
            disabled={saving}
            loading={saving}
          >
            Adicionar à Fila
          </Button>
        </div>
      </Modal>

      {/* Modal: Editar Candidato
          Permite corrigir dados e substituir documentos enquanto o candidato aguarda */}
      <Modal
        open={isEditModalOpen}
        onClose={() => !editSaving && setIsEditModalOpen(false)}
        title={`Editar Candidato — ${editingEntry?.customers?.name || ''}`}
        size="lg"
      >
        {/* Scroll interno para formulários longos sem estender o modal além da tela */}
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Nome em largura total */}
            <div className="md:col-span-2">
              <Input label="Nome completo" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Nome completo" />
            </div>

            {/* Documentos de identificação */}
            <Input label="CPF" value={editForm.cpf} onChange={(e) => setEditForm({ ...editForm, cpf: e.target.value })} placeholder="000.000.000-00" />
            <Input label="RG" value={editForm.rg} onChange={(e) => setEditForm({ ...editForm, rg: e.target.value })} placeholder="RG" />

            {/* Contato */}
            <Input label="Telefone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="(21) 99999-9999" />
            <Input label="E-mail" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="email@exemplo.com" />

            {/* Localização */}
            <Select label="Estado" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} options={[{ value: '', label: 'Selecione...' }, ...UFS.map((uf) => ({ value: uf, label: uf }))]} />
            <Input label="Data de Nascimento" type="date" value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} />

            {/* Endereço em largura total */}
            <div className="md:col-span-2">
              <Input label="Endereço" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="Rua, número, bairro, complemento" />
            </div>

            {/* CEP e emergência */}
            <Input label="CEP" value={editForm.zipCode} onChange={(e) => setEditForm({ ...editForm, zipCode: e.target.value })} placeholder="00000-000" />
            <Input label="Contato de Emergência" value={editForm.emergencyContact} onChange={(e) => setEditForm({ ...editForm, emergencyContact: e.target.value })} placeholder="Nome e telefone de familiar" />

            {/* Separador visual de seção de habilitação */}
            <div className="md:col-span-2">
              <p className="text-[12px] font-medium text-[#9e9e9e] mb-3 border-t border-[#323232] pt-4 mt-2">Habilitação</p>
            </div>

            {/* Dados da CNH — editáveis caso o candidato tenha renovado ou corrigido dados */}
            <Input label="Número da CNH" value={editForm.cnh} onChange={(e) => setEditForm({ ...editForm, cnh: e.target.value })} placeholder="Número da habilitação" />
            <Select label="Categoria CNH" value={editForm.cnhCategory} onChange={(e) => setEditForm({ ...editForm, cnhCategory: e.target.value })} options={CNH_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Input label="Validade da CNH" type="date" value={editForm.cnhExpiry} onChange={(e) => setEditForm({ ...editForm, cnhExpiry: e.target.value })} />
            {/* Espaçador de grid */}
            <div className="hidden md:block" />

            {/* Observações gerais */}
            <div className="md:col-span-2">
              <Textarea label="Observações" rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Observações gerais..." />
            </div>

            {/* Seção de upload de documentos no modo edição — mesmo componente do modal de adição */}
            <DocumentUploadSection
              form={editForm}
              onChange={(updates) => setEditForm(prev => ({ ...prev, ...updates }))}
              mode="edit"
            />
          </div>
        </div>

        {/* Rodapé do modal de edição */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#323232] mt-4">
          <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} disabled={editSaving}>Cancelar</Button>
          <Button variant="primary" onClick={handleSaveEdit} loading={editSaving} disabled={editSaving}>Salvar Alterações</Button>
        </div>
      </Modal>

      {/* Modal: Alterar Posição na Fila
          Exige seleção de motivo para garantir auditabilidade da reordenação */}
      <Modal
        open={isMoveModalOpen}
        onClose={() => !saving && setIsMoveModalOpen(false)}
        title="Alterar Posição na Fila"
        size="sm"
      >
        {/* IIFE para acessar variáveis calculadas sem precisar de estados adicionais */}
        {moveEntry && moveDirection && (() => {
          // Encontra o candidato que será trocado de posição (vizinho adjacente)
          const swapped = moveDirection === 'up'
            ? queueEntries.find((e) => e.position === moveEntry.position - 1)
            : queueEntries.find((e) => e.position === moveEntry.position + 1)
          return (
            <div className="flex flex-col gap-4 py-2">
              {/* Resumo da operação para confirmar ao operador o que será feito */}
              <p className="text-[13px] text-[#9e9e9e]">
                <strong className="text-[#f5f5f5]">{moveEntry.customers?.name}</strong> vai{' '}
                {/* Cor diferente para cima (positivo/brand) e baixo (negativo/vermelho) */}
                <span className={moveDirection === 'up' ? 'text-[#BAFF1A]' : 'text-[#ff9c9a]'}>
                  {moveDirection === 'up' ? 'subir' : 'descer'}
                </span>{' '}
                na fila, trocando com{' '}
                <strong className="text-[#f5f5f5]">{swapped?.customers?.name ?? '—'}</strong>.
              </p>

              {/* Select de motivo — exibe lista diferente dependendo da direção do movimento */}
              <Select
                label={moveDirection === 'up' ? 'Motivo da subida' : 'Motivo da descida'}
                options={moveDirection === 'up' ? MOVE_UP_REASONS : MOVE_DOWN_REASONS}
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
              />
            </div>
          )
        })()}

        {/* Rodapé do modal de reordenação */}
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={() => setIsMoveModalOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleConfirmMove} loading={saving} disabled={saving}>
            Confirmar
          </Button>
        </div>
      </Modal>

      {/* Modal: Confirmar Remoção da Fila
          Ação destrutiva — exige confirmação explícita para evitar remoções acidentais */}
      <Modal
        open={isRemoveModalOpen}
        onClose={() => !saving && setIsRemoveModalOpen(false)}
        title="Remover da Fila"
        size="sm"
      >
        <div className="py-2 text-[#f5f5f5]">
          {/* Exibe o nome do candidato para confirmar que é a pessoa certa sendo removida */}
          <p>
            Tem certeza que deseja remover{' '}
            <strong>{selectedEntry?.customers?.name}</strong> da fila de espera?
          </p>
          {/* Explica o impacto da ação — os demais candidatos serão reposicionados automaticamente */}
          <p className="mt-2 text-[13px] text-[#9e9e9e]">
            O cliente será liberado e os demais serão reposicionados automaticamente.
          </p>
        </div>

        {/* Rodapé com botão de cancelar e confirmar (danger = vermelho para reforçar destrutividade) */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="secondary"
            onClick={() => setIsRemoveModalOpen(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleRemoveFromQueue}
            disabled={saving}
            loading={saving}
          >
            Remover
          </Button>
        </div>
      </Modal>

      </div>
    </div>
  )
}
