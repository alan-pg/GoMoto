'use client'

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PÁGINA: MULTAS — Sistema GoMoto
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Objetivo:
 *   Controlar e exibir todas as multas de trânsito vinculadas à frota da locadora.
 *   Cada multa é associada a uma moto e, indiretamente, ao cliente que a estava
 *   conduzindo no momento da infração.
 *
 * Funcionalidades principais:
 *   • KPIs (cards de métricas) no topo: total, pendentes, vencidas, a vencer, pagas
 *   • Filtros: por status (abas pill), por moto (select) e por texto livre (busca)
 *   • Agrupamento em accordion por moto — pendentes na tabela principal e pagas
 *     em um histórico colapsável abaixo
 *   • CRUD completo: Criar, Editar, Marcar como Paga e Excluir multas
 *   • Preenchimento rápido com infrações mais comuns do CTB e seus valores tabelados
 *   • Auto-vinculação: selecionar cliente → preenche moto do contrato ativo (e vice-versa)
 *
 * Banco de dados (Supabase — projeto: hcnxbqunescfanqzmsha):
 *   • Tabela principal: `fines`
 *   • Joins utilizados: `customers` (nome e telefone) e `motorcycles` (placa, marca, modelo)
 *   • Dependência extra: `contracts` (apenas contratos ativos, para auto-vincular cliente ↔ moto)
 *
 * Padrão de layout:
 *   Segue o mesmo padrão das telas de Manutenção e Fila de Espera:
 *   Header → KPI cards → Barra de filtros → Accordion por moto
 *
 * Design system: design-system-bonze.md (InfinitePay dark theme)
 *   bg tela: #121212 | cards: #202020 | borda: #474747 | thead: #323232
 *   texto primário: #f5f5f5 | terciário: #9e9e9e | marca: #BAFF1A
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── IMPORTAÇÕES ──────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react'

// Ícones do Lucide — cada um tem função específica na UI:
import {
  Plus,          // Botão "Registrar Multa" no header
  Edit2,         // Botão de edição nas linhas da tabela
  Trash2,        // Botão de exclusão nas linhas da tabela
  CheckCircle,   // Botão "Marcar como Paga" e confirmação de pagamento
  AlertTriangle, // Ícone no KPI card de multas vencidas
  Search,        // Ícone na caixa de busca
  ChevronDown,   // Seta do accordion (rotaciona quando colapsado)
  Clock,         // Ícone no KPI card de pendentes
  Calendar,      // Ícone no KPI card "a vencer"
  FileText,      // Ícone no KPI card de total e no estado vazio
  CheckCircle2,  // Ícone no KPI card de pagas no mês
} from 'lucide-react'

// Infraestrutura do projeto
import { createClient } from '@/lib/supabase/client'  // Cliente Supabase para chamadas ao banco
import { Header }        from '@/components/layout/Header'  // Header padrão com título, subtítulo e ações
import { Button }        from '@/components/ui/Button'       // Botão do design system
import { Input, Select, Textarea } from '@/components/ui/Input'  // Campos de formulário
import { Modal }         from '@/components/ui/Modal'        // Modal com backdrop e fecha ao clicar fora
import { formatCurrency, formatDate } from '@/lib/utils'     // Formatadores de moeda (R$) e data (DD/MM/AAAA)

// ─── TIPOS ────────────────────────────────────────────────────────────────────

/**
 * Representa uma multa retornada do Supabase com todos os joins resolvidos.
 * Os campos opcionais (?) são colunas que podem ser nulas no banco.
 */
type FineWithRelations = {
  id: string                              // UUID da multa (PK no banco)
  customer_id: string                     // FK para a tabela customers
  motorcycle_id: string                   // FK para a tabela motorcycles
  description: string                     // Descrição textual da infração
  amount: number                          // Valor da multa em R$
  infraction_date: string                 // Data da infração (formato YYYY-MM-DD)
  due_date?: string | null               // Data de vencimento (formato YYYY-MM-DD) — opcional
  status: 'pending' | 'paid'             // Status atual: pendente ou paga
  payment_date?: string | null           // Data em que a multa foi paga — opcional
  responsible: 'customer' | 'company'    // Quem é responsável pelo pagamento
  observations?: string | null           // Observações livres: AIT, recurso, local etc.
  created_at: string                      // Timestamp de criação do registro
  customers: { name: string; phone: string } | null          // Dados do cliente via join
  motorcycles: { license_plate: string; model: string; make: string } | null  // Dados da moto via join
}

/**
 * Status calculado dinamicamente com base na data de vencimento.
 * É diferente do `status` salvo no banco, pois considera se a multa está
 * prestes a vencer ou já passou do prazo — sem precisar atualizar o banco.
 *
 *   overdue  → vencida (due_date < hoje)
 *   due_soon → vence em até 7 dias
 *   pending  → pendente sem urgência
 *   paid     → paga (status === 'paid' no banco)
 */
type FineStatus = 'overdue' | 'due_soon' | 'pending' | 'paid'

/**
 * Extensão do tipo base com o campo `_status` calculado no cliente.
 * O prefixo underscore indica que é um campo computado, não vindo do banco.
 */
type FineWithStatus = FineWithRelations & { _status: FineStatus }

// ─── MAPEAMENTOS DE ESTILO POR STATUS ─────────────────────────────────────────

/**
 * Cores de fundo + texto para os badges de status nas linhas da tabela.
 * Usa os tokens semânticos do design system (vermelho = erro, laranja = atenção,
 * roxo = informativo, verde = sucesso).
 */
const STATUS_BADGE: Record<FineStatus, { bg: string; text: string; label: string }> = {
  overdue:  { bg: 'bg-[#7c1c1c]',      text: 'text-[#ff9c9a]', label: 'Vencida'  },
  due_soon: { bg: 'bg-[#3a180f]',      text: 'text-[#e65e24]', label: 'A vencer' },
  pending:  { bg: 'bg-[#2d0363]',      text: 'text-[#a880ff]', label: 'Pendente' },
  paid:     { bg: 'bg-[#0e2f13]',      text: 'text-[#229731]', label: 'Paga'     },
}

/**
 * Cor do ponto de status no cabeçalho do accordion.
 * Reflete o pior status dentre as multas pendentes da moto:
 *   vermelho → tem vencidas | laranja → tem a vencer | verde → todas em dia
 */
const STATUS_DOT: Record<'overdue' | 'due_soon' | 'ok', string> = {
  overdue:  'bg-[#ff3e3c]',
  due_soon: 'bg-[#e65e24]',
  ok:       'bg-[#28b438]',
}

// ─── DADOS ESTÁTICOS ──────────────────────────────────────────────────────────

/**
 * Lista das infrações mais comuns do CTB com valores tabelados.
 * Usada para o campo de preenchimento rápido no modal de cadastro.
 * Ordenada alfabeticamente para facilitar a localização pelo usuário.
 */
const COMMON_INFRACTIONS = [
  { description: 'Avançar sinal vermelho ou parada obrigatória',          amount: 293.47  },
  { description: 'Conduzir sem capacete de proteção',                      amount: 195.23  },
  { description: 'Conduzir sem documentos do veículo',                     amount: 130.16  },
  { description: 'Conduzir sem habilitação (CNH)',                         amount: 880.41  },
  { description: 'Embriaguez ao volante',                                  amount: 2934.70 },
  { description: 'Estacionamento irregular',                               amount: 195.23  },
  { description: 'Excesso de velocidade até 20% acima do limite',         amount: 88.38   },
  { description: 'Excesso de velocidade entre 20% e 50% acima do limite', amount: 195.23  },
  { description: 'Habilitação (CNH) vencida',                              amount: 293.47  },
  { description: 'Licenciamento do veículo vencido',                       amount: 293.47  },
  { description: 'Não sinalizar mudança de faixa',                         amount: 88.38   },
  { description: 'Uso de celular ao volante',                              amount: 293.47  },
]

/**
 * Opções fixas do select de responsável.
 * Definidas no nível de módulo pois são valores estáticos — não mudam entre renders.
 */
const RESPONSIBLE_OPTIONS = [
  { value: 'customer', label: 'Cliente'  },
  { value: 'company',  label: 'Empresa'  },
]

/**
 * Opções do select de preenchimento rápido.
 * Definidas no nível de módulo pois derivam de COMMON_INFRACTIONS, que é estático.
 */
const INFRACTION_QUICKFILL_OPTIONS = [
  { value: '', label: 'Selecione uma infração comum...' },
  ...COMMON_INFRACTIONS.map(i => ({
    value: i.description,
    label: `${i.description} — ${formatCurrency(i.amount)}`,
  })),
]

/**
 * Estado inicial do formulário de cadastro/edição.
 * Usado tanto para resetar o form ao fechar o modal quanto para
 * inicializar o estado sem precisar de valores undefined.
 */
const DEFAULT_FORM = {
  customer_id:     '',          // ID do cliente selecionado
  motorcycle_id:   '',          // ID da moto selecionada
  description:     '',          // Texto da infração
  amount:          '',          // Valor como string (vira number antes de salvar)
  infraction_date: '',          // Data da infração (YYYY-MM-DD)
  due_date:        '',          // Data de vencimento (YYYY-MM-DD) — opcional
  responsible:     'customer',  // Responsável padrão: o cliente
  observations:    '',          // Campo livre para anotações
}

// ─── CLIENTE SUPABASE ─────────────────────────────────────────────────────────

/**
 * Instância singleton do cliente Supabase para o browser.
 * Criada fora do componente para evitar recriar a conexão a cada render.
 */
const supabase = createClient()

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

/**
 * KpiCard — Card de métrica reutilizável exibido no grid de KPIs.
 *
 * Props:
 *   icon      → componente de ícone Lucide
 *   iconBg    → classe Tailwind de cor de fundo do círculo do ícone
 *   iconColor → classe Tailwind de cor do próprio ícone
 *   label     → texto da métrica (ex: "Vencidas")
 *   value     → valor principal (string ou número)
 *   sub       → texto secundário abaixo do valor (ex: valor em R$) — opcional
 */
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg = 'bg-[#323232]',
  iconColor = 'text-[#BAFF1A]',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  iconBg?: string
  iconColor?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
      <div>
        <p className="text-[13px] text-[#9e9e9e]">{label}</p>
        <p className="text-2xl font-bold text-[#f5f5f5]">{value}</p>
        {sub && <p className="text-[12px] mt-0.5 text-[#9e9e9e]">{sub}</p>}
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  )
}

// ─── FUNÇÃO AUXILIAR ──────────────────────────────────────────────────────────

/**
 * calcFineStatus — Calcula o status dinâmico de uma multa com base na data de vencimento.
 *
 * A lógica é puramente no cliente — o banco armazena apenas 'pending' ou 'paid'.
 * Esta função enriquece o dado para exibir urgência visual na UI.
 *
 * Ordem de prioridade:
 *   1. Se status === 'paid' → retorna 'paid' (independente de due_date)
 *   2. Se due_date < hoje → 'overdue' (prazo expirado)
 *   3. Se due_date - hoje <= 7 dias → 'due_soon' (urgente)
 *   4. Sem due_date ou prazo tranquilo → 'pending'
 *
 * A data é parseada manualmente (split por '-') em vez de `new Date(string)`
 * para evitar problemas de fuso horário, já que strings YYYY-MM-DD sem
 * horário são interpretadas como UTC pelo JavaScript.
 */
function calcFineStatus(fine: FineWithRelations): FineStatus {
  // Multa já paga — sem necessidade de calcular datas
  if (fine.status === 'paid') return 'paid'

  if (fine.due_date) {
    // Zera o horário do "hoje" para comparar apenas as datas (sem horas)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Parse manual para evitar deslocamento de fuso horário
    const [year, month, day] = fine.due_date.split('-').map(Number)
    const dueDate = new Date(year, month - 1, day) // mês é 0-indexado no JS

    // Se o vencimento já passou → vencida
    if (dueDate < today) return 'overdue'

    // Diferença em dias: arredonda para cima para incluir o próprio dia do vencimento
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000)
    if (diffDays <= 7) return 'due_soon'
  }

  // Sem due_date ou prazo tranquilo → apenas pendente
  return 'pending'
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

/**
 * MultasPage — Página principal de controle de multas do Sistema GoMoto.
 *
 * É um Client Component ('use client') pois usa useState, useEffect e useMemo
 * para gerenciar estado local e interações do usuário.
 */
export default function MultasPage() {

  // ── ESTADOS: Dados vindos do banco ──────────────────────────────────────────

  /** Lista completa de multas com joins (customers + motorcycles) */
  const [fines, setFines] = useState<FineWithRelations[]>([])

  /** Clientes ativos disponíveis para seleção no formulário */
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])

  /** Motos disponíveis para seleção no formulário */
  const [motorcycles, setMotorcycles] = useState<{
    id: string; license_plate: string; model: string; make: string
  }[]>([])

  /**
   * Contratos ativos: usados para auto-vincular cliente ↔ moto no formulário.
   * Ao selecionar um cliente, buscamos o contrato ativo e preenchemos a moto, e vice-versa.
   */
  const [contracts, setContracts] = useState<{ customer_id: string; motorcycle_id: string }[]>([])

  // ── ESTADOS: Controle de UI ─────────────────────────────────────────────────

  /** Indica se está carregando dados do banco (exibe spinner) */
  const [loading, setLoading] = useState(true)

  /** Mensagem de erro global — exibida no topo da página se não nula */
  const [error, setError] = useState<string | null>(null)

  /** Indica se uma operação de escrita (save/delete) está em andamento */
  const [saving, setSaving] = useState(false)

  /** Controla a visibilidade do modal de criar/editar multa */
  const [modalOpen, setModalOpen] = useState(false)

  /**
   * ID da multa sendo editada. Null quando o modal está no modo "novo registro".
   * Usado para diferenciar INSERT de UPDATE na função handleSubmit.
   */
  const [editingId, setEditingId] = useState<string | null>(null)

  /** Dados do formulário de cadastro/edição — espelha os campos do banco */
  const [form, setForm] = useState(DEFAULT_FORM)

  /** Multa selecionada para exclusão — exibe o modal de confirmação quando não-nula */
  const [deleting, setDeleting] = useState<FineWithRelations | null>(null)

  /** Multa selecionada para marcar como paga — exibe o modal de pagamento quando não-nula */
  const [payingFine, setPayingFine] = useState<FineWithRelations | null>(null)

  /** Data de pagamento digitada no modal de confirmação de pagamento */
  const [paymentDateInput, setPaymentDateInput] = useState('')

  // ── ESTADOS: Filtros ────────────────────────────────────────────────────────

  /** Texto digitado na busca — filtra por descrição da infração ou nome do cliente */
  const [search, setSearch] = useState('')

  /**
   * Aba de status ativa nos filtros.
   * Valores possíveis: 'all' | 'overdue' | 'due_soon' | 'pending' | 'paid'
   */
  const [statusFilter, setStatusFilter] = useState('all')

  /** ID da moto selecionada no select de filtro. String vazia = todas as motos */
  const [motorcycleFilter, setMotorcycleFilter] = useState('')

  // ── ESTADOS: Accordion ──────────────────────────────────────────────────────

  /**
   * Set de IDs de motos com o accordion colapsado.
   * Se o ID está no Set → grupo fechado. Se não está → grupo aberto (padrão).
   * Usamos Set para busca O(1) em vez de array.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  /**
   * Set de IDs de motos com o histórico de multas pagas visível.
   * Por padrão o histórico fica oculto — aparece apenas quando o usuário clica.
   */
  const [historyGroups, setHistoryGroups] = useState<Set<string>>(new Set())

  // ─── BUSCA DE DADOS ────────────────────────────────────────────────────────

  /**
   * fetchAllData — Busca em paralelo todos os dados necessários para a página.
   *
   * Usa Promise.all para executar as 4 queries simultaneamente, reduzindo
   * o tempo de carregamento total (soma dos tempos → máximo dos tempos).
   *
   * Queries executadas:
   *   1. fines → todas as multas com joins de customers e motorcycles
   *   2. customers → clientes ativos ordenados por nome
   *   3. motorcycles → motos ordenadas por placa
   *   4. contracts → apenas contratos ativos (para auto-vincular cliente ↔ moto)
   */
  const fetchAllData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [finesRes, customersRes, motosRes, contractsRes] = await Promise.all([
        supabase
          .from('fines')
          .select('*, customers(name, phone), motorcycles(license_plate, model, make)')
          .order('infraction_date', { ascending: false }),  // mais recentes primeiro
        supabase.from('customers').select('id, name').eq('active', true).order('name'),
        supabase.from('motorcycles').select('id, license_plate, model, make').order('license_plate'),
        supabase.from('contracts').select('customer_id, motorcycle_id').eq('status', 'active'),
      ])

      // Propaga o primeiro erro encontrado (fail-fast)
      if (finesRes.error)     throw finesRes.error
      if (customersRes.error) throw customersRes.error
      if (motosRes.error)     throw motosRes.error
      if (contractsRes.error) throw contractsRes.error

      setFines(finesRes.data as FineWithRelations[])
      setCustomers(customersRes.data ?? [])
      setMotorcycles(motosRes.data ?? [])
      setContracts(contractsRes.data ?? [])
    } catch {
      setError('Não foi possível carregar os dados. Tente novamente.')
    } finally {
      // Sempre desativa o loading, mesmo em caso de erro
      setLoading(false)
    }
  }

  // Executa a busca apenas uma vez ao montar o componente
  useEffect(() => { fetchAllData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── HANDLERS DE ACCORDION ─────────────────────────────────────────────────

  /**
   * toggleGroup — Alterna o estado expandido/colapsado de um grupo (moto) no accordion.
   * Usa imutabilidade: cria um novo Set a cada chamada para disparar re-render.
   */
  function toggleGroup(id: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  /**
   * toggleHistory — Alterna a visibilidade do histórico de multas pagas de um grupo.
   * Mesmo padrão de imutabilidade do toggleGroup.
   */
  function toggleHistory(id: string) {
    setHistoryGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ─── HANDLERS DE MODAL ─────────────────────────────────────────────────────

  /**
   * openNew — Abre o modal no modo "novo registro".
   * Limpa o editingId e reseta o formulário para os valores padrão.
   */
  function openNew() {
    setEditingId(null)
    setForm(DEFAULT_FORM)
    setModalOpen(true)
  }

  /**
   * openEdit — Abre o modal no modo "edição" com os dados da multa selecionada.
   * Converte o amount (number) para string pois o campo de input é string.
   */
  function openEdit(row: FineWithRelations) {
    setEditingId(row.id)
    setForm({
      customer_id:     row.customer_id,
      motorcycle_id:   row.motorcycle_id,
      description:     row.description,
      amount:          String(row.amount),
      infraction_date: row.infraction_date,
      due_date:        row.due_date ?? '',
      responsible:     row.responsible,
      observations:    row.observations ?? '',
    })
    setModalOpen(true)
  }

  /**
   * handleCloseModal — Fecha o modal e reseta todos os estados relacionados.
   * Garante que ao reabrir o modal ele começa limpo.
   */
  function handleCloseModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(DEFAULT_FORM)
  }

  // ─── OPERAÇÕES CRUD ────────────────────────────────────────────────────────

  /**
   * handleSubmit — Persiste a multa no banco (INSERT ou UPDATE).
   *
   * Comportamento:
   *   • Se editingId existe → UPDATE na linha correspondente
   *   • Se editingId é null → INSERT com status inicial 'pending'
   *   • Após salvar: fecha o modal e recarrega os dados
   *   • Em caso de erro: exibe mensagem sem fechar o modal
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    // Monta o payload: converte amount de string para float e trata campos opcionais
    const payload = {
      customer_id:     form.customer_id,
      motorcycle_id:   form.motorcycle_id,
      description:     form.description,
      amount:          parseFloat(form.amount),
      infraction_date: form.infraction_date,
      due_date:        form.due_date || null,    // string vazia → null no banco
      responsible:     form.responsible,
      observations:    form.observations || null,
    }

    try {
      if (editingId) {
        // Modo edição: atualiza apenas a linha com o ID correspondente
        const { error: updateError } = await supabase
          .from('fines').update(payload).eq('id', editingId)
        if (updateError) throw updateError
      } else {
        // Modo criação: toda multa nova começa como 'pending'
        const { error: insertError } = await supabase
          .from('fines').insert({ ...payload, status: 'pending' })
        if (insertError) throw insertError
      }

      handleCloseModal()
      await fetchAllData()  // Recarrega para refletir as mudanças
    } catch {
      setError('Erro ao salvar. Verifique os dados e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * handleMarkAsPaid — Abre o modal de confirmação de pagamento.
   * Pré-preenche a data de pagamento com hoje para facilitar o fluxo.
   */
  function handleMarkAsPaid(row: FineWithRelations) {
    setPayingFine(row)
    setPaymentDateInput(new Date().toISOString().split('T')[0]) // hoje em YYYY-MM-DD
  }

  /**
   * confirmPayment — Persiste o pagamento no banco.
   * Atualiza status para 'paid' e registra a data do pagamento.
   */
  async function confirmPayment() {
    if (!payingFine) return
    setSaving(true)
    try {
      const { error: payError } = await supabase
        .from('fines')
        .update({ status: 'paid', payment_date: paymentDateInput })
        .eq('id', payingFine.id)
      if (payError) throw payError

      // Limpa o estado do modal de pagamento
      setPayingFine(null)
      setPaymentDateInput('')
      await fetchAllData()
    } catch {
    } finally {
      setSaving(false)
    }
  }

  /**
   * confirmDeletion — Remove permanentemente a multa do banco.
   * Só executa se `deleting` não for nulo (proteção contra chamadas acidentais).
   */
  async function confirmDeletion() {
    if (!deleting) return
    setSaving(true)
    try {
      const { error: deleteError } = await supabase
        .from('fines').delete().eq('id', deleting.id)
      if (deleteError) throw deleteError

      setDeleting(null)
      await fetchAllData()
    } catch {
    } finally {
      setSaving(false)
    }
  }

  // ─── DADOS COMPUTADOS (useMemo) ─────────────────────────────────────────────

  /**
   * kpis — Calcula todas as métricas exibidas nos KPI cards em uma única passagem.
   *
   * Utiliza um único forEach (O(n)) em vez de múltiplos filter/reduce,
   * evitando iterações redundantes sobre o array de multas.
   *
   * Métricas calculadas:
   *   total          → total de multas cadastradas
   *   pendingCount   → multas não pagas (overdue + due_soon + pending)
   *   pendingValue   → soma dos valores das não pagas
   *   overdueCount   → multas vencidas (due_date < hoje)
   *   overdueValue   → soma dos valores das vencidas
   *   dueSoonCount   → multas a vencer nos próximos 7 dias
   *   paidMonthCount → multas pagas no mês corrente
   *   paidMonthValue → soma dos valores pagos no mês corrente
   *   paidCount      → total de multas pagas (para o contador da aba)
   *
   * Recalculado apenas quando o array `fines` muda.
   */
  const kpis = useMemo(() => {
    // Prefixo do mês atual em formato YYYY-MM (ex: "2026-03")
    const currentMonth = new Date().toISOString().slice(0, 7)

    let total = 0, pendingCount = 0, pendingValue = 0
    let overdueCount = 0, overdueValue = 0, dueSoonCount = 0
    let paidMonthCount = 0, paidMonthValue = 0, paidCount = 0

    fines.forEach(fine => {
      total++
      const s = calcFineStatus(fine)

      if (s === 'overdue') {
        // Vencida: conta nos vencidos E nos pendentes (pois ainda está sem pagar)
        overdueCount++;  overdueValue  += Number(fine.amount)
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'due_soon') {
        // A vencer: conta nos pendentes mas não nos vencidos
        dueSoonCount++
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'pending') {
        // Pendente sem urgência
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'paid') {
        paidCount++
        // Pagas no mês atual: verifica se payment_date começa com o mês corrente
        if (fine.payment_date?.startsWith(currentMonth)) {
          paidMonthCount++;  paidMonthValue += Number(fine.amount)
        }
      }
    })

    return { total, pendingCount, pendingValue, overdueCount, overdueValue,
             dueSoonCount, paidMonthCount, paidMonthValue, paidCount }
  }, [fines])

  /**
   * groupedFines — Aplica filtros e agrupa as multas por moto.
   *
   * Pipeline de transformação:
   *   1. Enriquece cada multa com `_status` calculado dinamicamente
   *   2. Filtra por busca textual (descrição ou nome do cliente)
   *   3. Filtra por aba de status ativa
   *   4. Filtra por moto selecionada
   *   5. Agrupa em um Map keyed pelo motorcycle_id
   *   6. Ordena os itens de cada grupo por gravidade (overdue → due_soon → pending → paid)
   *   7. Ordena os grupos pelo pior status interno (motos com maior urgência primeiro)
   *
   * Recalculado apenas quando fines, search, statusFilter ou motorcycleFilter mudam.
   */
  const groupedFines = useMemo(() => {
    // Enriquece todas as multas com o status calculado
    let filtered: FineWithStatus[] = fines.map(f => ({ ...f, _status: calcFineStatus(f) }))

    // Filtro de busca textual — case-insensitive, busca em descrição e nome do cliente
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(f =>
        f.description.toLowerCase().includes(q) ||
        (f.customers?.name ?? '').toLowerCase().includes(q)
      )
    }

    // Filtro por aba de status — 'all' desativa o filtro
    if (statusFilter !== 'all') {
      filtered = filtered.filter(f => f._status === statusFilter)
    }

    // Filtro por moto específica — string vazia desativa o filtro
    if (motorcycleFilter) {
      filtered = filtered.filter(f => f.motorcycle_id === motorcycleFilter)
    }

    // Ordem numérica de gravidade para ordenação: menor = maior urgência
    const ORDER: Record<FineStatus, number> = { overdue: 0, due_soon: 1, pending: 2, paid: 3 }

    // Agrupa as multas filtradas por moto usando Map para preservar ordem de inserção
    const map = new Map<string, {
      motorcycle_id: string
      moto: FineWithRelations['motorcycles']
      items: FineWithStatus[]
    }>()

    filtered.forEach(fine => {
      if (!map.has(fine.motorcycle_id)) {
        map.set(fine.motorcycle_id, {
          motorcycle_id: fine.motorcycle_id,
          moto: fine.motorcycles,
          items: [],
        })
      }
      map.get(fine.motorcycle_id)!.items.push(fine)
    })

    const groups = Array.from(map.values())

    // Ordena os itens dentro de cada grupo por gravidade
    groups.forEach(g => g.items.sort((a, b) => ORDER[a._status] - ORDER[b._status]))

    // Ordena os grupos: motos com multas mais graves aparecem primeiro
    groups.sort((a, b) => {
      const worst = (items: FineWithStatus[]) =>
        items.reduce((min, i) => Math.min(min, ORDER[i._status]), 3)
      return worst(a.items) - worst(b.items)
    })

    return groups
  }, [fines, search, statusFilter, motorcycleFilter])

  // ─── OPÇÕES DOS SELECTS (memoizadas) ───────────────────────────────────────

  /**
   * Opções do select de cliente no formulário.
   * Inclui a opção vazia como placeholder (required no form).
   * Memoizado para não recriar o array a cada render.
   */
  const customerOptions = useMemo(() => [
    { value: '', label: 'Selecione um cliente' },
    ...customers.map(c => ({ value: c.id, label: c.name })),
  ], [customers])

  /**
   * Opções do select de moto no formulário.
   * Exibe placa + marca + modelo para fácil identificação.
   */
  const motorcycleOptions = useMemo(() => [
    { value: '', label: 'Selecione uma moto' },
    ...motorcycles.map(m => ({ value: m.id, label: `${m.license_plate} — ${m.make} ${m.model}` })),
  ], [motorcycles])

  /**
   * Definição das abas de filtro de status.
   * Calculada com base nos kpis para exibir contagens ao lado dos labels.
   * "Pendentes" exibe apenas os sem urgência (total pendentes - vencidas - a vencer).
   */
  const statusTabs = useMemo(() => [
    { id: 'all',      label: 'Todas',     count: kpis.total                                              },
    { id: 'overdue',  label: 'Vencidas',  count: kpis.overdueCount                                      },
    { id: 'due_soon', label: 'A vencer',  count: kpis.dueSoonCount                                      },
    { id: 'pending',  label: 'Pendentes', count: kpis.pendingCount - kpis.overdueCount - kpis.dueSoonCount },
    { id: 'paid',     label: 'Pagas',     count: kpis.paidCount                                          },
  ], [kpis])

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    // Container principal — ocupa toda a altura e usa o fundo padrão da tela
    <div className="flex flex-col min-h-full bg-[#121212]">

      {/* ── Header ─────────────────────────────────────────────────────────
          Componente compartilhado com todas as telas do sistema.
          O botão "Registrar Multa" fica alinhado à direita via prop `actions`.
      ────────────────────────────────────────────────────────────────────── */}
      <Header
        title="Multas"
        subtitle="Controle de infrações de trânsito"
        actions={
          <Button onClick={openNew}>
            <Plus className="w-4 h-4" />
            Registrar Multa
          </Button>
        }
      />

      {/* ── Área de conteúdo ─────────────────────────────────────────────── */}
      <div className="p-6 space-y-5">

        {/* Mensagem de erro global — exibida apenas quando há falha no carregamento ou save */}
        {error && (
          <div className="p-3 rounded-lg bg-[#7c1c1c] text-[13px] text-[#ff9c9a]">
            {error}
          </div>
        )}

        {/* ── KPI CARDS ────────────────────────────────────────────────────
            Grid de 5 cards de métricas. Em mobile: 2 colunas. Em sm+: 5 colunas.
            Cada card usa o sub-componente KpiCard para evitar repetição.
        ─────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {/* Total: todas as multas cadastradas */}
          <KpiCard
            icon={FileText}
            iconBg="bg-[#323232]"
            iconColor="text-[#9e9e9e]"
            label="Total"
            value={kpis.total}
          />

          {/* Pendentes: multas sem pagamento (inclui todas as urgências) */}
          <KpiCard
            icon={Clock}
            iconBg="bg-[#2d0363]"
            iconColor="text-[#a880ff]"
            label="Pendentes"
            value={kpis.pendingCount}
            sub={formatCurrency(kpis.pendingValue)}
          />

          {/* Vencidas: prazo expirado, requer ação imediata */}
          <KpiCard
            icon={AlertTriangle}
            iconBg="bg-[#7c1c1c]"
            iconColor="text-[#ff9c9a]"
            label="Vencidas"
            value={kpis.overdueCount}
            sub={formatCurrency(kpis.overdueValue)}
          />

          {/* A vencer: vencimento nos próximos 7 dias */}
          <KpiCard
            icon={Calendar}
            iconBg="bg-[#3a180f]"
            iconColor="text-[#e65e24]"
            label="A vencer (7d)"
            value={kpis.dueSoonCount}
          />

          {/* Pagas no mês: multas quitadas no mês atual */}
          <KpiCard
            icon={CheckCircle2}
            iconBg="bg-[#0e2f13]"
            iconColor="text-[#229731]"
            label="Pagas (mês)"
            value={kpis.paidMonthCount}
            sub={formatCurrency(kpis.paidMonthValue)}
          />
        </div>

        {/* ── BARRA DE FILTROS ─────────────────────────────────────────────
            Linha única em desktop, empilhada em mobile.
            Esquerda: abas de status pill | Direita: select de moto + busca
        ─────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Abas de status — chip pill conforme design system */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {statusTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  statusFilter === tab.id
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1.5 text-[#616161]">({tab.count})</span>}
              </button>
            ))}
          </div>

          {/* Filtros secundários: moto e busca por texto */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Select de filtro por moto específica */}
            <select
              value={motorcycleFilter}
              onChange={e => setMotorcycleFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="">Todas as motos</option>
              {motorcycles.map(m => (
                <option key={m.id} value={m.id} className="bg-[#202020]">
                  {m.license_plate} — {m.make} {m.model}
                </option>
              ))}
            </select>

            {/* Campo de busca com ícone de lupa */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-10 rounded-lg border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-44"
              />
            </div>
          </div>
        </div>

        {/* ── ACCORDION AGRUPADO POR MOTO ──────────────────────────────────
            Cada grupo representa uma moto com suas multas.
            Estrutura de cada grupo:
              [cabeçalho clicável: placa | modelo | badges de urgência | total]
              [tabela de pendentes]
              [toggle de histórico]
              [tabela de pagas — colapsável]
        ─────────────────────────────────────────────────────────────────── */}
        {loading ? (
          // Estado de carregamento: spinner centralizado
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>

        ) : groupedFines.length === 0 ? (
          // Estado vazio: exibido quando nenhum resultado passa pelos filtros
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <FileText className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhuma multa encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou registre uma nova multa.</p>
          </div>

        ) : (
          // Lista de grupos (um por moto)
          <div className="space-y-2">
            {groupedFines.map(({ motorcycle_id, moto, items }) => {
              // Determina visibilidade do grupo e do histórico via os Sets de estado
              const isExpanded  = !collapsedGroups.has(motorcycle_id)
              const showHistory = historyGroups.has(motorcycle_id)

              // Separa itens pendentes (qualquer status não-pago) dos pagos (histórico)
              const pendingItems = items.filter(i => i._status !== 'paid')
              const paidItems    = items.filter(i => i._status === 'paid')

              // Conta urgências para os badges no cabeçalho
              const nOverdue  = pendingItems.filter(i => i._status === 'overdue').length
              const nDueSoon  = pendingItems.filter(i => i._status === 'due_soon').length
              // Soma dos valores de todas as multas pendentes desta moto
              const pendingTotal = pendingItems.reduce((acc, i) => acc + Number(i.amount), 0)

              // Cor do ponto de status: reflete o pior caso dentre os pendentes
              const dotColor = nOverdue > 0
                ? STATUS_DOT.overdue
                : nDueSoon > 0
                  ? STATUS_DOT.due_soon
                  : STATUS_DOT.ok

              return (
                <div key={motorcycle_id} className="overflow-hidden rounded-xl bg-[#202020]">

                  {/* ── Cabeçalho do accordion (clicável) ───────────────── */}
                  <button
                    onClick={() => toggleGroup(motorcycle_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#323232] transition-colors text-left"
                  >
                    {/* Seta: rotaciona -90° quando colapsado */}
                    <ChevronDown className={`w-4 h-4 text-[#9e9e9e] shrink-0 transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`} />
                    {/* Ponto colorido indicador do pior status */}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                    {/* Placa em destaque monospace */}
                    <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">
                      {moto?.license_plate ?? '—'}
                    </span>
                    {/* Marca e modelo em texto terciário */}
                    <span className="text-[13px] text-[#9e9e9e]">{moto?.make} {moto?.model}</span>

                    {/* Badges e total alinhados à direita */}
                    <div className="ml-auto flex items-center gap-1.5">
                      {nOverdue > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#7c1c1c] text-[#ff9c9a]">
                          {nOverdue} vencida{nOverdue > 1 ? 's' : ''}
                        </span>
                      )}
                      {nDueSoon > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#3a180f] text-[#e65e24]">
                          {nDueSoon} a vencer
                        </span>
                      )}
                      {pendingTotal > 0 && (
                        <span className="text-[13px] font-medium text-[#ff9c9a] ml-1">
                          {formatCurrency(pendingTotal)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* ── Conteúdo (visível apenas quando isExpanded = true) ── */}
                  {isExpanded && (
                    <div className="border-t border-[#323232]">

                      {/* Tabela de multas pendentes */}
                      {pendingItems.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                            {/* Cabeçalho — sem fundo, apenas tipografia secundária */}
                            <thead>
                              <tr className="border-b border-[#323232]">
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Infração</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Data / Vencimento</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Valor</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Responsável</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Status</th>
                                <th className="h-9 px-4 text-right text-[#9e9e9e] text-[13px] font-medium">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pendingItems.map(item => {
                                // Extrai estilos de badge do mapa de constantes
                                const badge = STATUS_BADGE[item._status]
                                return (
                                  <tr key={item.id} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232]">

                                    {/* Infração: descrição principal + observação + cliente */}
                                    <td className="px-4 max-w-xs">
                                      <p className="font-medium text-[#f5f5f5]">{item.description}</p>
                                      {item.observations && (
                                        <p className="text-[12px] text-[#9e9e9e] mt-0.5 line-clamp-1">
                                          {item.observations}
                                        </p>
                                      )}
                                      {item.customers?.name && (
                                        <p className="text-[12px] text-[#616161] mt-0.5">
                                          {item.customers.name}
                                        </p>
                                      )}
                                    </td>

                                    {/* Datas: infração + vencimento (colorido se vencida) */}
                                    <td className="px-4">
                                      <p className="text-[#f5f5f5]">{formatDate(item.infraction_date)}</p>
                                      {item.due_date && (
                                        <p className={`text-[12px] mt-0.5 ${item._status === 'overdue' ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
                                          Venc: {formatDate(item.due_date)}
                                        </p>
                                      )}
                                    </td>

                                    {/* Valor em vermelho para destacar o impacto financeiro nas pendentes */}
                                    <td className="px-4">
                                      <span className="font-medium text-[#ff9c9a]">
                                        {formatCurrency(Number(item.amount))}
                                      </span>
                                    </td>

                                    {/* Badge de responsável: roxo = cliente | neutro = empresa */}
                                    <td className="px-4">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${
                                        item.responsible === 'customer'
                                          ? 'bg-[#2d0363] text-[#a880ff]'
                                          : 'bg-[#323232] text-[#9e9e9e]'
                                      }`}>
                                        {item.responsible === 'customer' ? 'Cliente' : 'Empresa'}
                                      </span>
                                    </td>

                                    {/* Badge de status: cores do mapa STATUS_BADGE */}
                                    <td className="px-4">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${badge.bg} ${badge.text}`}>
                                        {badge.label}
                                      </span>
                                    </td>

                                    {/* Ações: Editar | Pagar | Excluir (mesma ordem de todas as telas) */}
                                    <td className="px-4 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <Button variant="secondary" size="sm" className="h-8 w-8 p-0"
                                          onClick={() => openEdit(item)} title="Editar">
                                          <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button variant="primary" size="sm" className="h-8 w-8 p-0"
                                          onClick={() => handleMarkAsPaid(item)} title="Registrar pagamento">
                                          <CheckCircle className="h-4 w-4" />
                                        </Button>
                                        <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                          onClick={() => setDeleting(item)} title="Excluir">
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        // Mensagem quando não há pendentes (só há pagas)
                        <p className="text-center text-[#616161] py-5 text-[13px]">
                          Nenhuma multa pendente.
                        </p>
                      )}

                      {/* ── Histórico de multas pagas (colapsável) ─────── */}
                      {paidItems.length > 0 && (
                        <div className={pendingItems.length > 0 ? 'border-t border-[#323232]' : ''}>
                          {/* Toggle do histórico — texto e seta compactos */}
                          <button
                            onClick={() => toggleHistory(motorcycle_id)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-[12px] text-[#616161] hover:text-[#9e9e9e] transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${showHistory ? '' : '-rotate-90'}`} />
                            {showHistory
                              ? 'Ocultar histórico'
                              : `Ver histórico (${paidItems.length} paga${paidItems.length > 1 ? 's' : ''})`}
                          </button>

                          {/* Tabela compacta do histórico — visível apenas quando showHistory */}
                          {showHistory && (
                            <div className="border-t border-[#323232] overflow-x-auto">
                              <table className="w-full text-left text-[13px]">
                                <tbody>
                                  {paidItems.map(item => (
                                    /* opacity-80 no tr para diferenciar visualmente o histórico dos itens pendentes */
                                    <tr key={item.id} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] opacity-80">
                                      {/* Descrição + cliente */}
                                      <td className="px-4 w-1/2">
                                        <p className="text-[#9e9e9e]">{item.description}</p>
                                        {item.customers?.name && (
                                          <p className="text-[12px] text-[#616161]">{item.customers.name}</p>
                                        )}
                                      </td>
                                      {/* Data do pagamento */}
                                      <td className="px-4 text-[12px] text-[#9e9e9e]">
                                        {item.payment_date ? formatDate(item.payment_date) : '—'}
                                      </td>
                                      {/* Valor em verde (quitado) */}
                                      <td className="px-4 text-[13px] font-medium text-[#229731]">
                                        {formatCurrency(Number(item.amount))}
                                      </td>
                                      {/* Ações do histórico: sem botão "Pagar" (já está paga) */}
                                      <td className="px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Button variant="secondary" size="sm" className="h-8 w-8 p-0"
                                            onClick={() => openEdit(item)} title="Editar">
                                            <Edit2 className="h-4 w-4" />
                                          </Button>
                                          <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                            onClick={() => setDeleting(item)} title="Excluir">
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
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAIS — Renderizados fora do scroll principal para ficarem
          sobrepostos ao layout sem interferir no fluxo do documento.
      ═══════════════════════════════════════════════════════════════════ */}

      {/* ── Modal: Criar / Editar Multa ──────────────────────────────────
          Reutilizado para criação (editingId = null) e edição (editingId = ID).
          O título e o texto do botão de submit mudam automaticamente.
      ─────────────────────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={editingId ? 'Editar Multa' : 'Registrar Multa'}
        size="xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Linha 1: Cliente + Moto (auto-vinculados via contrato ativo) */}
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Cliente"
              options={customerOptions}
              value={form.customer_id}
              onChange={e => {
                const selectedCustomerId = e.target.value
                // Busca contrato ativo do cliente para auto-preencher a moto
                const contract = contracts.find(c => c.customer_id === selectedCustomerId)
                setForm({
                  ...form,
                  customer_id:   selectedCustomerId,
                  // Mantém a moto atual se o cliente não tiver contrato ativo
                  motorcycle_id: contract?.motorcycle_id ?? form.motorcycle_id,
                })
              }}
              required
            />
            <Select
              label="Moto"
              options={motorcycleOptions}
              value={form.motorcycle_id}
              onChange={e => {
                const selectedMotorcycleId = e.target.value
                // Busca contrato ativo da moto para auto-preencher o cliente
                const contract = contracts.find(c => c.motorcycle_id === selectedMotorcycleId)
                setForm({
                  ...form,
                  motorcycle_id: selectedMotorcycleId,
                  // Mantém o cliente atual se a moto não tiver contrato ativo
                  customer_id:   contract?.customer_id ?? form.customer_id,
                })
              }}
              required
            />
          </div>

          {/* Preenchimento rápido: seleciona infração do CTB e preenche descrição + valor */}
          <Select
            label="Infrações Comuns (CTB) — preenchimento rápido"
            options={INFRACTION_QUICKFILL_OPTIONS}
            // Sincroniza a seleção se a descrição atual bate com alguma infração da lista
            value={COMMON_INFRACTIONS.find(i => i.description === form.description)?.description ?? ''}
            onChange={e => {
              const selected = COMMON_INFRACTIONS.find(i => i.description === e.target.value)
              if (selected) setForm({ ...form, description: selected.description, amount: String(selected.amount) })
            }}
          />

          {/* Campo de descrição livre — editável mesmo após preenchimento rápido */}
          <Input
            label="Descrição da Infração"
            placeholder="Ex: Excesso de velocidade — Av. Paulista"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            required
          />

          {/* Linha 2: Data da infração + Data de vencimento */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Data da Infração"
              type="date"
              value={form.infraction_date}
              onChange={e => setForm({ ...form, infraction_date: e.target.value })}
              required
            />
            <Input
              label="Data de Vencimento"
              type="date"
              value={form.due_date}
              onChange={e => setForm({ ...form, due_date: e.target.value })}
              // Não obrigatório — multa pode ser registrada sem data de vencimento
            />
          </div>

          {/* Linha 3: Valor + Responsável */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Valor (R$)"
              type="number"
              step="0.01"
              min="0"
              placeholder="293.47"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              required
            />
            <Select
              label="Responsável"
              options={RESPONSIBLE_OPTIONS}
              value={form.responsible}
              onChange={e => setForm({ ...form, responsible: e.target.value })}
            />
          </div>

          {/* Observações livres: número do AIT, local, se está em recurso etc. */}
          <Textarea
            label="Observações (opcional)"
            placeholder="AIT nº, local da infração, recurso em andamento..."
            rows={3}
            value={form.observations}
            onChange={e => setForm({ ...form, observations: e.target.value })}
          />

          {/* Ações do formulário */}
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              {editingId ? 'Salvar Alterações' : 'Registrar Multa'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Modal: Confirmar Pagamento ────────────────────────────────────
          Exibe resumo da multa e pede a data do pagamento antes de confirmar.
          Pré-preenchida com a data de hoje para agilizar o fluxo.
      ─────────────────────────────────────────────────────────────────── */}
      <Modal
        open={!!payingFine}
        onClose={() => { setPayingFine(null); setPaymentDateInput('') }}
        title="Confirmar Pagamento"
        size="sm"
      >
        <div className="space-y-4">
          {/* Resumo da multa a ser paga */}
          <div className="p-3 bg-[#323232] rounded-lg space-y-1">
            <p className="text-[13px] text-[#9e9e9e]">
              Cliente: <span className="text-[#f5f5f5] font-medium">{payingFine?.customers?.name ?? '—'}</span>
            </p>
            <p className="text-[13px] text-[#9e9e9e]">
              Valor: <span className="text-[#ff9c9a] font-medium">
                {payingFine ? formatCurrency(Number(payingFine.amount)) : ''}
              </span>
            </p>
          </div>

          {/* Campo de data do pagamento */}
          <Input
            label="Data do Pagamento"
            type="date"
            value={paymentDateInput}
            onChange={e => setPaymentDateInput(e.target.value)}
            required
          />

          {/* Ações do modal de pagamento */}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setPayingFine(null); setPaymentDateInput('') }}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={confirmPayment}>
              <CheckCircle className="w-4 h-4" />
              Confirmar Pagamento
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Confirmar Exclusão ─────────────────────────────────────
          Ação destrutiva irreversível — pede confirmação explícita do usuário.
      ─────────────────────────────────────────────────────────────────── */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Excluir Multa" size="sm">
        <div className="space-y-4">
          <p className="text-[#9e9e9e] text-[13px]">
            Tem certeza que deseja excluir a multa{' '}
            <span className="text-[#f5f5f5] font-medium">{deleting?.description}</span>?
            Esta ação removerá permanentemente o histórico da infração.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={saving} onClick={confirmDeletion}>
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
