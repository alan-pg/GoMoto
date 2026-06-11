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
import { useState, useEffect, useCallback, useMemo } from 'react'
// Importação dinâmica para componentes que não suportam SSR (como mapas com Leaflet)
import dynamic from 'next/dynamic'
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
} from 'lucide-react'

// Importação de componentes de layout e UI personalizados do projeto
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

// Importação do cliente Supabase para acesso ao banco de dados
import { createClient } from '@/lib/supabase/client'

// Importação de funções utilitárias
import { formatCurrency } from '@/lib/utils'

// Importação de definições de tipos TypeScript globais
import type { Motorcycle, MotorcycleStatus, Contract, Customer } from '@/types'

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
const filterOptions = [
  { label: 'Todas', value: 'all' },
  { label: 'Disponíveis', value: 'available' },
  { label: 'Alugadas', value: 'rented' },
  { label: 'Em Manutenção', value: 'maintenance' },
]

/**
 * @constant statusOptions
 * @description Opções para o campo Select do formulário de cadastro.
 */
const statusOptions = [
  { value: 'available', label: 'Disponível' },
  { value: 'rented', label: 'Alugada' },
  { value: 'maintenance', label: 'Em Manutenção' },
  { value: 'inactive', label: 'Inativa' },
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
 * @constant BOOTSTRAP_MAINTENANCE_ITEMS
 * @description Lista de itens de manutenção preventiva padrão para motos 150/160cc.
 * O "porquê": Estes itens são a base para o sistema de previsão de manutenções.
 * Ao cadastrar uma nova moto, o Passo 2 (Bootstrap) usa esta lista para criar
 * o histórico inicial, permitindo que o sistema agende as próximas revisões.
 */
const BOOTSTRAP_MAINTENANCE_ITEMS = [
  { id: 'ip1',  name: 'Troca de óleo',                        type: 'km'   as const, interval: 1000,  hint: 'a cada 1.000 km'      },
  { id: 'ip2',  name: 'Filtro de óleo',                        type: 'km'   as const, interval: 4000,  hint: 'a cada 4.000 km'      },
  { id: 'ip5',  name: 'Troca da relação (corrente/coroa/pinhão)', type: 'km'   as const, interval: 12000, hint: 'a cada 12.000 km'     },
  { id: 'ip6',  name: 'Lona de freio traseira',                   type: 'km'   as const, interval: 12000, hint: 'a cada 12.000 km'     },
  { id: 'ip7',  name: 'Pastilha de freio dianteira',            type: 'km'   as const, interval: 8000,  hint: 'a cada 8.000 km'      },
  { id: 'ip8',  name: 'Pneu dianteiro',                        type: 'km'   as const, interval: 12000, hint: 'a cada 12.000 km'     },
  { id: 'ip9',  name: 'Pneu traseiro',                         type: 'km'   as const, interval: 8000,  hint: 'a cada 8.000 km'      },
  { id: 'ip10', name: 'Filtro de ar',                        type: 'km'   as const, interval: 7000,  hint: 'a cada 7.000 km'      },
  { id: 'ip11', name: 'Velas de ignição',                       type: 'km'   as const, interval: 10000, hint: 'a cada 10.000 km'     },
  { id: 'ip12', name: 'Amortecedores',                   type: 'km'   as const, interval: 25000, hint: 'a cada 25.000 km'     },
  { id: 'ip13', name: 'Vistoria mensal',                type: 'data' as const, interval: 30,    hint: 'a cada mês'         },
]

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
  fipeValue: '',            // Valor de mercado
  currentKm: '',            // Quilometragem atual de entrada
  maintenanceUpToDate: 'true', // Status de manutenção inicial
  status: 'available',      // Status operacional inicial
  observations: '',         // Observações de vistoria de entrada
}

/**
 * @constant statusColorMap
 * @description Associa cada status de moto a uma cor hex pura para o ponto indicador na tabela.
 */
const statusColorMap: Record<string, string> = {
  available:   '#28b438',
  rented:      '#a880ff',
  maintenance: '#e65e24',
  inactive:    '#474747',
}

/**
 * @function motorcycleToForm
 * @description Converte um objeto Moto (formato do banco) para o formato esperado pelo formulário (Strings).
 * O "porquê": Essencial para popular os campos durante a edição de um registro existente,
 * adaptando os tipos de dados (ex: number para string) para os inputs HTML.
 */
function motorcycleToForm(motorcycle: Motorcycle) {
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
  }
}

/**
 * @component MotorcyclesPage
 * @description Gerencia toda a lógica e renderização da tela de frota.
 */
export default function MotorcyclesPage() {
  /* 
   * GERENCIAMENTO DE ESTADOS (React State):
   */
  // Lista principal de motos exibida na tela.
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([])
  // Contratos ativos com dados do cliente embutidos (para tabela e mapa).
  const [contracts, setContracts] = useState<ContractWithCustomer[]>([])
  // Estado de carregamento inicial dos dados.
  const [loading, setLoading] = useState(true)
  // Mensagem de erro caso a busca de dados falhe — exibida ao usuário em vez de lista vazia silenciosa.
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Estado de salvamento/deleção para os botões.
  const [saving, setSaving] = useState(false)
  // Valor atual do filtro de status (todas, disponivel, etc).
  const [filter, setFilter] = useState('all')
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
  // Passo atual do Wizard de cadastro (1 = Dados Básicos, 2 = Manutenções Iniciais).
  const [step, setStep] = useState<1 | 2>(1)
  // ID da moto selecionada na tabela para centralizar no mapa.
  const [selectedMotoId, setSelectedMotoId] = useState<string | null>(null)
  // Mapa de valores (KM ou Data) informados no passo 2 do cadastro.
  const [bootstrapItems, setBootstrapItems] = useState<Record<string, string>>({})

  /**
   * @function fetchMotorcycles
   * @description Busca motos e contratos ativos do Supabase em paralelo com Promise.all.
   *
   * Usa useCallback para estabilizar a referência da função entre renders,
   * permitindo seu uso seguro no useEffect sem causar loops infinitos.
   *
   * Em caso de falha na requisição de motos, exibe mensagem de erro ao usuário
   * em vez de deixar a lista silenciosamente vazia (tratamento explícito de erros).
   */
  const fetchMotorcycles = useCallback(async () => {
    setLoading(true)
    setFetchError(null) // Limpa erro anterior antes de nova tentativa

    const supabase = createClient()

    // Executa ambas as queries em paralelo para reduzir o tempo total de carregamento
    const [{ data: motoData, error: motoError }, { data: contractData }] = await Promise.all([
      supabase.from('motorcycles').select('*').order('created_at', { ascending: false }),
      supabase.from('contracts').select('*, customer:customers(*)').eq('status', 'active'),
    ])

    if (motoError) {
      // Informa o usuário sobre a falha em vez de mostrar lista vazia sem explicação
      setFetchError('Não foi possível carregar a frota. Verifique a conexão e tente novamente.')
    } else if (motoData) {
      setMotorcycles(motoData as Motorcycle[])
    }

    // Contratos: falha silenciosa intencional — a tabela ainda funciona, só sem dados de cliente
    if (contractData) {
      setContracts(contractData as ContractWithCustomer[])
    }

    setLoading(false)
  }, []) // Sem dependências: createClient() é estável e os setters do useState são garantidamente estáveis

  // Busca inicial ao montar o componente
  useEffect(() => {
    fetchMotorcycles()
  }, [fetchMotorcycles])

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

  /**
   * @const filteredMotorcycles
   * @description Filtra a lista de motos em tempo real com base no status e busca.
   * O "porquê" de ser um useMemo: recalcula apenas quando motorcycles, filter ou search mudam,
   * evitando reprocessar toda a lista a cada render causado por outros estados (ex: modal aberto).
   */
  const filteredMotorcycles = useMemo(
    () => motorcycles.filter((m) => {
      // Verifica se a moto pertence à categoria de status selecionada
      const passesFilter = filter === 'all' || m.status === filter
      // Verifica se algum campo contém o texto buscado (case-insensitive)
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

  /**
   * @function handleStep1
   * @description Processa a submissão do passo 1. Se for edição, finaliza. Se for criação, avança.
   */
  function handleStep1(e: React.FormEvent) {
    e.preventDefault() // Evita recarregamento da página
    if (editingId) {
      handleSubmitFinal() // Edição não passa pelo passo 2 (bootstrap)
    } else {
      setStep(2) // Avança para configuração de manutenções
    }
  }

  /**
   * @function handleSubmitFinal
   * @description Consolida os dados do formulário e salva no banco de dados Supabase.
   */
  async function handleSubmitFinal() {
    setSaving(true)
    const supabase = createClient()
    
    // Criação do objeto de dados higienizado
    /**
     * Sanitização robusta do valor FIPE:
     * Remove separadores de milhar (pontos) antes de converter a vírgula decimal,
     * evitando NaN em entradas como "15.500,00" → correto: 15500.00
     * A ordem importa: remove pontos de milhar ANTES de trocar vírgula por ponto.
     */
    const parsedFipeValue = form.fipeValue
      ? parseFloat(form.fipeValue.replace(/\./g, '').replace(',', '.'))
      : null

    // Campos base que existem tanto na criação quanto na edição
    const motorcycleData = {
      license_plate: form.licensePlate.toUpperCase(),   // Padrão Mercosul exige maiúsculas
      model:         form.model,
      make:          form.make.toUpperCase(),
      year_manufacture: form.yearManufacture,
      year_model:    form.yearModel || null,
      color:         form.color.toUpperCase(),
      renavam:       form.renavam,
      chassis:       form.chassis.toUpperCase(),
      fuel:          form.fuel,
      engine_capacity:       form.engineCapacity || null,
      previous_owner:        form.previousOwnerName || null,
      previous_owner_cpf:    form.previousOwnerDocument || null,
      purchase_date:         form.purchaseDate || null,
      fipe_value:            isNaN(parsedFipeValue as number) ? null : parsedFipeValue,
      maintenance_up_to_date: form.maintenanceUpToDate === 'true',
      status:        form.status as MotorcycleStatus,
      observations:  form.observations || null,
    }

    if (editingId) {
      /**
       * CASO EDIÇÃO: Não inclui km_current no update.
       * Motivo: o campo currentKm é zerado ao abrir o modal de edição (não há valor pré-carregado),
       * então salvar km_current: 0 causaria regressão de quilometragem — dado crítico de manutenção.
       * A quilometragem real é gerenciada pelo módulo de Manutenção.
       */
      await supabase.from('motorcycles').update(motorcycleData).eq('id', editingId)
    } else {
      /**
       * CASO CRIAÇÃO: Inclui km_current como quilometragem inicial de entrada na frota.
       * Após inserir a moto, semeia automaticamente os registros de manutenção preventiva
       * com base nos dados coletados no Passo 2 (bootstrapItems).
       */
      const { data: newMoto, error: insertError } = await supabase
        .from('motorcycles')
        .insert({
          ...motorcycleData,
          km_current: form.currentKm ? parseInt(form.currentKm, 10) : 0,
        })
        .select('id')
        .single()

      if (insertError || !newMoto?.id) {
        setSaving(false)
        return
      }

      const newMotoId = newMoto.id
      const currentKm = form.currentKm ? parseInt(form.currentKm, 10) : 0
      const today = new Date().toISOString().split('T')[0]

      /**
       * Semente de manutenções: para cada item da lista padrão, criamos UM registro pendente
       * representando a PRÓXIMA revisão agendada. A referência de quando foi feita pela última vez
       * (KM ou data informados no Passo 2) é usada apenas para calcular o vencimento.
       * Se não informado, assume-se 0 km / data de hoje — podendo gerar itens já vencidos
       * caso a moto já tenha quilômetros rodados.
       */
      const maintenanceRecords: Record<string, unknown>[] = []

      for (const item of BOOTSTRAP_MAINTENANCE_ITEMS) {
        if (item.type === 'km') {
          const lastKm = bootstrapItems[item.id] ? parseInt(bootstrapItems[item.id], 10) : 0
          const nextDueKm = lastKm + item.interval

          maintenanceRecords.push({
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
        } else {
          // item.type === 'data'
          const lastDateStr = bootstrapItems[item.id] || today
          const lastDate = new Date(lastDateStr + 'T12:00:00')
          const nextDueDate = new Date(lastDate)
          nextDueDate.setDate(nextDueDate.getDate() + item.interval)
          const nextDueDateStr = nextDueDate.toISOString().split('T')[0]

          maintenanceRecords.push({
            motorcycle_id: newMotoId,
            type: 'inspection',
            description: item.name,
            scheduled_date: nextDueDateStr,
            completed: false,
            observations: `Última realizada em ${lastDateStr === today ? 'data não informada (assumido hoje)' : lastDateStr}`,
          })
        }
      }

      // Insere todos os registros de manutenção em lote
      try {
        await supabase.from('maintenances').insert(maintenanceRecords)
      } catch {
      }
    }

    await fetchMotorcycles() // Recarrega os dados do banco
    setSaving(false)
    closeModal() // Fecha modal e limpa estados
  }

  /**
   * @function confirmDeletion
   * @description Executa a remoção definitiva da moto do banco de dados.
   */
  async function confirmDeletion() {
    if (!deletingMotorcycle) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('motorcycles').delete().eq('id', deletingMotorcycle.id)
    await fetchMotorcycles()
    setSaving(false)
    setDeletingMotorcycle(null) // Fecha modal de confirmação
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
            <button onClick={fetchMotorcycles} className="ml-auto text-[12px] text-[#BAFF1A] hover:underline font-medium">
              Tentar novamente
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
              return (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${isActive ? 'border-[#BAFF1A] text-[#f5f5f5]' : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'}`}
                >
                  {opt.label}
                  {opt.value !== 'all' && (
                    <span className="ml-1.5 text-[#616161]">({motorcycles.filter((m) => m.status === opt.value).length})</span>
                  )}
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
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Placa</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Motocicleta</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Cliente</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Valor/Semana</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Endereço</th>
                <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Status</th>
                <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}><div className='flex items-center justify-center py-16'><div className='w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin' /></div></td></tr>
              ) : filteredMotorcycles.length === 0 ? (
                <tr><td colSpan={7}><div className='flex flex-col items-center justify-center py-16 gap-3 text-[#9e9e9e]'><div className='w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center'><Bike className='w-6 h-6 text-[#9e9e9e]' /></div><p className='text-[13px] text-[#9e9e9e]'>Nenhum veículo encontrado.</p><button onClick={() => { setFilter('all'); setSearch('') }} className='text-[13px] text-[#BAFF1A] hover:underline'>Limpar filtros</button></div></td></tr>
              ) : (
                filteredMotorcycles.map((moto) => {
                  const contract = contractByMotoId[moto.id]
                  const customer = contract?.customer
                  const weeklyValue = contract?.monthly_amount ? formatCurrency(contract.monthly_amount) : null
                  return (
                    <tr key={moto.id} onClick={() => setSelectedMotoId(moto.id === selectedMotoId ? null : moto.id)} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer">
                      <td className="px-4"><div className='flex items-center gap-2'><div className='w-2 h-2 rounded-full flex-shrink-0' style={{ background: statusColorMap[moto.status] ?? '#9e9e9e' }} /><span className='font-mono font-bold text-[#f5f5f5]'>{moto.license_plate}</span></div></td>
                      <td className="px-4"><p className="font-medium text-[#f5f5f5]">{moto.make} {moto.model}</p></td>
                      <td className="px-4">{customer ? (<div className="flex items-center gap-1.5"><User className="w-4 h-4 text-[#a880ff] flex-shrink-0" /><p className="font-medium text-[#f5f5f5] truncate">{customer.name}</p></div>) : (<p className="text-[#9e9e9e]">Sem locatário</p>)}</td>
                      <td className="px-4">{weeklyValue ? (<span className='text-[#BAFF1A] font-medium'>{weeklyValue}</span>) : (<span className='text-[#9e9e9e]'>—</span>)}</td>
                      <td className="px-4">{customer?.address ? (<div className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" /><p className="text-[#9e9e9e] truncate max-w-[180px]">{customer.address}</p></div>) : (<p className="text-[#9e9e9e]">—</p>)}</td>
                      <td className="px-4"><StatusBadge status={moto.status} /></td>
                      <td className="px-4 text-right"><div className="flex items-center justify-end gap-1"><Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Ver detalhes" onClick={(e) => { e.stopPropagation(); setMotorcycleDetails(moto) }}><Eye className="h-4 w-4" /></Button><Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Editar" onClick={(e) => { e.stopPropagation(); openEditMotorcycle(moto) }}><Edit2 className="h-4 w-4" /></Button><Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Excluir" onClick={(e) => { e.stopPropagation(); setDeletingMotorcycle(moto) }}><Trash2 className="h-4 w-4" /></Button></div></td>
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
        title={editingId ? 'Editar Dados da Moto' : step === 1 ? 'Cadastrar Moto — Passo 1: Identificação' : 'Cadastrar Moto — Passo 2: Configurar Revisões'}
        size="lg"
      >
        {/* ── SEÇÃO: PASSO 1 - DADOS BÁSICOS E TÉCNICOS ──────────────────────────────── */}
        {(editingId || step === 1) && (
        <form onSubmit={handleStep1} className="space-y-5 p-1">
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

          {/* HISTÓRICO DE AQUISIÇÃO: Detalhes de quem a GoMoto comprou o veículo */}
          <div className="border-t border-[#323232] pt-4 mt-2">
            <h5 className="text-[14px] font-bold text-[#BAFF1A] mb-4">Informações da Compra</h5>
            <div className="grid grid-cols-2 gap-5">
              <Input
                label="Dono Anterior (Vendedor)"
                placeholder="Nome conforme documento"
                value={form.previousOwnerName}
                onChange={(e) => setForm({ ...form, previousOwnerName: e.target.value })}
              />
              <Input
                label="CPF do Vendedor"
                placeholder="000.000.000-00"
                value={form.previousOwnerDocument}
                onChange={(e) => setForm({ ...form, previousOwnerDocument: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-5 mt-5">
              <Input
                label="Data da Compra"
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
              <Input
                label="Valor de Aquisição / FIPE (R$)"
                placeholder="0,00"
                value={form.fipeValue}
                onChange={(e) => setForm({ ...form, fipeValue: e.target.value })}
              />
            </div>
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
                  PRÓXIMO PASSO: REVISÕES →
                </>
              )}
            </Button>
          </div>
        </form>
        )}

        {/* ── SEÇÃO: PASSO 2 - BOOTSTRAP DE MANUTENÇÃO (APENAS PARA NOVAS MOTOS) ─────────────────── */}
        {!editingId && step === 2 && (
          <div className="space-y-6 p-1">
            <div className="bg-[#243300] border border-[#6b9900] rounded-xl p-4">
              <p className="text-[13px] text-[#9e9e9e] leading-relaxed">
                Para o sistema prever as próximas revisões, informe a <strong className="text-[#f5f5f5]">última vez</strong> que cada item abaixo foi trocado ou revisado.
                <br /><span className="text-[12px] text-[#616161]">DICA: Se não souber, deixe em branco e o sistema marcará como "Revisão Imediata".</span>
              </p>
            </div>

            {/* LISTAGEM DOS ITENS DE MANUTENÇÃO PREVENTIVA */}
            <div className="space-y-3 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
              {BOOTSTRAP_MAINTENANCE_ITEMS.map((item) => (
                <div key={item.id} className="flex items-center gap-4 bg-[#282828] rounded-xl px-4 py-3 hover:bg-[#323232] transition-colors border border-transparent hover:border-[#323232]">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-[#f5f5f5]">{item.name}</p>
                    <p className="text-[12px] text-[#616161] font-medium">{item.hint}</p>
                  </div>
                  
                  {/* INPUT DINÂMICO: KM ou DATA dependendo do tipo da métrica */}
                  <div className="flex-shrink-0">
                    {item.type === 'km' ? (
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
              ))}
            </div>

            {/* FEEDBACK DE CONFIGURAÇÃO */}
            {Object.keys(bootstrapItems).filter((k) => bootstrapItems[k]).length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 bg-[#2d0363] border border-[#a880ff] rounded-xl">
                <div className="w-2 h-2 bg-[#a880ff] rounded-full animate-pulse" />
                <p className="text-[12px] text-[#a880ff] font-medium">
                  {Object.keys(bootstrapItems).filter((k) => bootstrapItems[k]).length} itens de manutenção serão programados automaticamente.
                </p>
              </div>
            )}

            {/* AÇÕES DE NAVEGAÇÃO DO WIZARD */}
            <div className="flex gap-4 justify-between pt-4 border-t border-[#323232]">
              <Button variant="ghost" onClick={() => setStep(1)} className="px-6">
                ← VOLTAR AOS DADOS
              </Button>
              <Button onClick={handleSubmitFinal} className="px-10" loading={saving}>
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
