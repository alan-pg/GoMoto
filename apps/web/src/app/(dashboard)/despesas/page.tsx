'use client'

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PÁGINA: DESPESAS — Sistema GoMoto
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Objetivo:
 *   Controlar e exibir todas as saídas financeiras da empresa,
 *   agrupadas por categoria em um accordion interativo.
 *
 * Funcionalidades principais:
 *   • KPIs (cards de métricas) no topo: total do mês, lançamentos, ticket médio
 *     e maior categoria de gasto
 *   • Filtros combinados: abas pill por categoria + seletor de mês + busca textual
 *   • Accordion por categoria — só exibe as categorias que têm lançamentos no período
 *   • CRUD completo: Criar, Editar e Excluir despesas via modais
 *
 * Fluxo de dados:
 *   Supabase (tabela `expenses`) → estado `expenses` → `filteredExpenses` (mês + busca)
 *   → `groupedExpenses` (filtro de categoria + agrupamento) → accordion na tela
 *
 * Banco de dados (Supabase — projeto: hcnxbqunescfanqzmsha):
 *   • Tabela principal: `expenses`
 *   • Colunas: id, description, amount, category, date, observations, created_at
 *
 * Padrão de layout (idêntico às telas de Multas, Manutenção e Fila):
 *   Header → KPI cards → Barra de filtros → Accordion por categoria
 *
 * Design system: design-system-bonze.md (InfinitePay dark theme)
 *   bg tela: #121212 | cards: #202020 | borda: #474747 | thead: #323232
 *   texto primário: #f5f5f5 | secundário: #c7c7c7 | terciário: #9e9e9e | marca: #BAFF1A
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─── IMPORTAÇÕES ──────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react'

// Ícones do Lucide — cada um tem função específica na UI:
import {
  Plus,          // Botão "Nova Despesa" no header
  Edit2,         // Botão de edição nas linhas da tabela
  Trash2,        // Botão de exclusão nas linhas da tabela e no modal de confirmação
  TrendingDown,  // Ícone do KPI card "Total do Mês" — representa saída financeira
  Receipt,       // Ícone do KPI card "Lançamentos" e estado vazio da lista
  Activity,      // Ícone do KPI card "Ticket Médio" — representa média por despesa
  Tag,           // Ícone do KPI card "Maior Categoria" — representa classificação
  Search,        // Ícone na caixa de busca
  ChevronDown,   // Seta do accordion — rotaciona quando colapsado
  FileText,
  Paperclip,
  AlertCircle,
  ExternalLink,
  X
} from 'lucide-react'

// Infraestrutura do projeto
import { createClient }              from '@/lib/supabase/client'           // Cliente Supabase browser
import { Header }                    from '@/components/layout/Header'       // Header padrão do sistema
import { Button }                    from '@/components/ui/Button'           // Botão do design system
import { Input, Select, Textarea }   from '@/components/ui/Input'            // Campos de formulário
import { Modal }                     from '@/components/ui/Modal'            // Modal com backdrop
import { formatCurrency, formatDate } from '@/lib/utils'                     // Formatadores de moeda e data
import type { Expense, Motorcycle }  from '@/types'                          // Tipo da tabela `expenses`

// ─── TIPOS ────────────────────────────────────────────────────────────────────

/**
 * @type ExpenseFormData
 * @description Estrutura dos campos controlados do formulário de criação/edição.
 *
 * Por que usar strings para amount?
 *   O campo <input type="number"> sempre retorna string no React.
 *   A conversão para float ocorre apenas no momento do envio (handleSave),
 *   evitando erros de NaN durante a digitação.
 */
type ExpenseFormData = {
  description:  string   // Texto livre descrevendo a despesa
  amount:       string   // Valor como string; convertido para float antes de salvar
  date:         string   // Data no formato YYYY-MM-DD (padrão HTML date input)
  category:     string   // Uma das opções de EXPENSE_CATEGORIES
  observations: string   // Campo livre opcional (NF, comprovante, etc.)
  invoiceFile: File | null
  attachmentFile: File | null
  motorcycle_id: string
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

/**
 * @constant EXPENSE_CATEGORIES
 * @description Lista fixa de categorias disponíveis para classificação das despesas.
 *
 * Por que é fixa (não vem do banco)?
 *   Manter as categorias em código garante consistência dos dados e evita
 *   divergências causadas por digitação livre. Mudanças de categoria exigem
 *   atualização deliberada do código.
 *
 * Ordenadas por frequência de uso típico em locadoras de moto.
 */
const EXPENSE_CATEGORIES: string[] = [
  'Manutenção',
  'Combustível',
  'Aluguel',
  'Salário',
  'Impostos',
  'Seguro',
  'Marketing',
  'Outros',
]

/**
 * @constant DEFAULT_FORM
 * @description Estado inicial vazio do formulário de criação/edição.
 *
 * Por que fica fora do componente?
 *   Criar o objeto dentro do componente recriaria a referência a cada render,
 *   impossibilitando comparações de igualdade e causando renders desnecessários.
 *   Fora do componente, a referência é estável e pode ser reutilizada como
 *   valor de reset sem efeitos colaterais.
 *
 * O campo `date` é inicializado com a data atual para agilizar o preenchimento.
 */
const DEFAULT_FORM: ExpenseFormData = {
  description:  '',
  amount:       '',
  date:         new Date().toISOString().split('T')[0], // formato YYYY-MM-DD
  category:     '',
  observations: '',
  invoiceFile: null,
  attachmentFile: null,
  motorcycle_id: '',
}

/**
 * @constant CATEGORY_OPTIONS
 * @description Opções pré-formatadas para o componente Select do formulário.
 *
 * Por que fica fora do componente?
 *   O array é estático — nunca muda em runtime. Criá-lo fora do componente
 *   evita realocar memória a cada render sem necessidade.
 */
const CATEGORY_OPTIONS = [
  { value: '', label: 'Selecione a categoria' },
  ...EXPENSE_CATEGORIES.map(cat => ({ value: cat, label: cat })),
]

// ─── CLIENTE SUPABASE ─────────────────────────────────────────────────────────

/**
 * @constant supabase
 * @description Instância singleton do cliente Supabase para o browser.
 *
 * Por que fica fora do componente?
 *   Criado uma única vez ao carregar o módulo. Se estivesse dentro do componente,
 *   seria recriado a cada render, abrindo múltiplas conexões desnecessariamente.
 */
const supabase = createClient()

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

/**
 * @component KpiCard
 * @description Card de métrica reutilizável exibido no grid de KPIs.
 *
 * Renderiza um círculo colorido com ícone à esquerda e dois textos à direita:
 *   • label  → rótulo da métrica exibido como passado via prop (ex: "Total do Mês")
 *   • value  → valor principal em destaque (ex: "R$ 1.200,00")
 *   • sub    → texto de apoio opcional na cor do ícone com 70% de opacidade
 *
 * Por que fica fora do componente principal?
 *   Evita ser redefinido a cada render do pai. Como não tem estado próprio,
 *   é um componente puro — apenas renderiza o que recebe via props.
 *
 * @param icon  - Componente de ícone Lucide (ex: TrendingDown)
 * @param label - Rótulo da métrica exibido acima do valor
 * @param value - Valor principal da métrica (string ou número)
 * @param sub   - Texto secundário opcional abaixo do valor
 */
function KpiCard({ icon: Icon, label, value, sub }: { icon: React.ElementType, label: string, value: string | number, sub?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#202020] px-4 py-4">
      <div>
        <p className="text-[13px] text-[#9e9e9e]">{label}</p>
        <p className="text-2xl font-bold text-[#f5f5f5]">{value}</p>
        {sub && <p className="text-[12px] mt-0.5 text-[#9e9e9e]">{sub}</p>}
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232] text-[#BAFF1A]">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

/**
 * @component ExpensesPage
 * @description Página principal de controle de despesas do Sistema GoMoto.
 *
 * É um Client Component ('use client') pois depende de:
 *   • useState  — para gerenciar todos os estados locais (dados, filtros, modais)
 *   • useEffect — para disparar a busca de dados na montagem inicial
 *   • useMemo   — para evitar recálculos desnecessários de listas filtradas e KPIs
 *
 * Hierarquia de filtragem (executada em sequência nos useMemos):
 *   expenses → [mês + busca] → filteredExpenses → [categoria] → groupedExpenses
 */
export default function ExpensesPage() {

  // ── ESTADOS: Dados vindos do banco ──────────────────────────────────────────

  /**
   * Lista completa de despesas carregadas do Supabase.
   * Atualizada após cada operação de criar, editar ou excluir.
   * Todos os filtros são aplicados sobre este array via useMemo (sem re-fetch).
   */
  const [expenses, setExpenses] = useState<Expense[]>([])

  // ── ESTADOS: Controle de UI ─────────────────────────────────────────────────

  /**
   * Indica se o fetch inicial está em andamento.
   * Enquanto true, exibe o spinner no lugar do accordion.
   */
  const [loading, setLoading] = useState(true)

  /**
   * Controla a visibilidade do modal de criar/editar despesa.
   * O modo (criar vs. editar) é determinado pelo estado `editing`.
   */
  const [modalOpen, setModalOpen] = useState(false)

  /**
   * Despesa sendo editada no modal.
   * null  → modal no modo "nova despesa" (INSERT)
   * Expense → modal no modo "editar" (UPDATE), pré-popula o formulário
   */
  const [editing, setEditing] = useState<Expense | null>(null)

  /**
   * Despesa selecionada para exclusão.
   * null       → modal de confirmação fechado
   * Expense    → modal de confirmação aberto, exibe o nome da despesa
   */
  const [deleting, setDeleting] = useState<Expense | null>(null)

  /**
   * Indica se uma operação de escrita (INSERT, UPDATE ou DELETE) está em andamento.
   * Usado para exibir o estado de loading nos botões e bloquear duplo clique.
   */
  const [saving, setSaving] = useState(false)

  /**
   * Dados do formulário de criação/edição.
   * Todos os campos são strings — a conversão de tipos ocorre no handleSave.
   * Resetado para DEFAULT_FORM sempre que o modal é fechado.
   */
  const [form, setForm] = useState<ExpenseFormData>(DEFAULT_FORM)

  const [existingInvoiceUrl, setExistingInvoiceUrl] = useState<string | null>(null)
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(null)
  const [noInvoiceWarning, setNoInvoiceWarning] = useState(false)
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([])

  // ── ESTADOS: Filtros ────────────────────────────────────────────────────────

  /**
   * Texto digitado na busca.
   * Filtra simultaneamente em `description` e `observations` (case-insensitive).
   * String vazia = sem filtro de busca.
   */
  const [search, setSearch] = useState('')

  /**
   * Categoria ativa nas abas pill.
   * String vazia → aba "Todas" ativa (sem filtro de categoria).
   * Nome de categoria → filtra o accordion para exibir apenas aquela categoria.
   */
  const [categoryFilter, setCategoryFilter] = useState('')

  /**
   * Mês selecionado no filtro, no formato 'YYYY-MM'.
   * Inicializado com o mês atual via função lazy (evita new Date() a cada render).
   * Usado para filtrar `expenses` pelo campo `date` (startsWith).
   */
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date()
    // Formata como YYYY-MM — padStart garante zero à esquerda em meses < 10
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // ── ESTADOS: Accordion ──────────────────────────────────────────────────────

  /**
   * Set de nomes de categoria com o accordion colapsado.
   *
   * Lógica de presença no Set:
   *   • ID presente → grupo fechado (colapsado)
   *   • ID ausente  → grupo aberto (expandido) ← padrão inicial
   *
   * Usamos Set<string> para busca O(1) em vez de Array.includes() O(n).
   */
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // ─── BUSCA DE DADOS ────────────────────────────────────────────────────────

  /**
   * @function fetchExpenses
   * @description Busca todas as despesas do Supabase, ordenadas por data decrescente.
   *
   * Pré-condição: Cliente Supabase inicializado e autenticado via middleware.
   * Efeitos colaterais: Atualiza `expenses` e `loading`.
   *
   * Por que buscar todas as despesas de uma vez (sem paginação)?
   *   O volume esperado é baixo (locadora de 5 motos). Buscar tudo permite
   *   filtros instantâneos no cliente sem round-trips ao banco a cada filtro.
   */
  async function fetchExpenses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('date', { ascending: false }) // mais recentes primeiro

    if (!error) {
      setExpenses((data as Expense[]) ?? [])
    }

    const { data: motoData } = await supabase
      .from('motorcycles')
      .select('id, license_plate, model')
      .order('license_plate', { ascending: true })
    setMotorcycles((motoData as Motorcycle[]) ?? [])

    setLoading(false)
  }

  // Dispara o fetch uma única vez na montagem do componente
  useEffect(() => { fetchExpenses() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── HANDLER DE ACCORDION ─────────────────────────────────────────────────

  /**
   * @function toggleCategory
   * @description Alterna o estado expandido/colapsado de um grupo no accordion.
   *
   * Usa imutabilidade: cria um novo Set a cada chamada em vez de mutar o anterior.
   * Isso é obrigatório no React — mutar o estado diretamente não dispara re-render.
   *
   * @param category - Nome da categoria a alternar (ex: "Manutenção")
   */
  function toggleCategory(category: string) {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      // Se já está no Set (colapsado) → remove (expande). Caso contrário → adiciona (colapsa).
      next.has(category) ? next.delete(category) : next.add(category)
      return next
    })
  }

  // ─── HANDLERS DE MODAL ─────────────────────────────────────────────────────

  /**
   * @function handleOpenModal
   * @description Abre o modal no modo criação ou edição.
   *
   * Modo criação (sem argumento):
   *   • Limpa `editing` (null sinaliza INSERT no handleSave)
   *   • Reseta o formulário para DEFAULT_FORM
   *
   * Modo edição (com despesa):
   *   • Armazena a despesa em `editing` (sinaliza UPDATE no handleSave)
   *   • Pré-popula o formulário com os dados atuais da despesa
   *   • `amount` é convertido para string pois o input espera string
   *
   * @param expense - Despesa a editar (opcional — omitir para criar nova)
   */
  function handleOpenModal(expense?: Expense) {
    if (expense) {
      // Modo edição: pré-popula o formulário com os dados existentes
      setEditing(expense)
      setExistingInvoiceUrl(expense.invoice_url ?? null)
      setExistingAttachmentUrl(expense.attachment_url ?? null)
      setForm({
        description:  expense.description,
        amount:       expense.amount.toString(), // number → string para o input
        date:         expense.date,
        category:     expense.category,
        observations: expense.observations ?? '',
        invoiceFile: null,
        attachmentFile: null,
        motorcycle_id: expense.motorcycle_id ?? '',
      })
    } else {
      // Modo criação: limpa tudo
      setEditing(null)
      setExistingInvoiceUrl(null)
      setExistingAttachmentUrl(null)
      setForm(DEFAULT_FORM)
    }
    setModalOpen(true)
  }

  /**
   * @function handleCloseModal
   * @description Fecha o modal e garante que o formulário volta ao estado inicial.
   *
   * Por que resetar o formulário ao fechar (e não só ao abrir)?
   *   Se o usuário abre para editar, digita algo, depois fecha sem salvar e abre
   *   para criar novo, o formulário deve estar limpo — não com os dados anteriores.
   */
  function handleCloseModal() {
    setModalOpen(false)
    setEditing(null)
    setForm(DEFAULT_FORM)
    setExistingInvoiceUrl(null)
    setExistingAttachmentUrl(null)
    setNoInvoiceWarning(false)
  }

  // ─── OPERAÇÕES CRUD ────────────────────────────────────────────────────────

  async function uploadFile(file: File, prefix: string): Promise<string | null> {
    const ext = file.name.split('.').pop()
    const path = `expenses/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('expense-files').upload(path, file)
    if (error) { return null }
    const { data } = supabase.storage.from('expense-files').getPublicUrl(path)
    return data.publicUrl
  }

  /**
   * @function handleSave
   * @description Persiste a despesa no banco via INSERT ou UPDATE.
   *
   * Fluxo:
   *   1. Previne o comportamento padrão do form (reload da página)
   *   2. Valida campos obrigatórios — retorna silenciosamente se inválido
   *      (o HTML nativo já exibe as mensagens de erro via `required`)
   *   3. Monta o payload tipado para o Supabase (converte amount para float)
   *   4. Se `editing` → UPDATE na linha existente; senão → INSERT nova linha
   *   5. Fecha o modal e recarrega a lista
   *
   * @param e - Evento de submit do formulário (necessário para e.preventDefault())
   */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    // Validação client-side dos campos obrigatórios antes de chamar o banco
    if (!form.description || !form.amount || !form.date || !form.category) return

    // Se não há nota fiscal e o aviso ainda não foi confirmado, mostra o alerta
    const hasInvoice = !!form.invoiceFile || !!existingInvoiceUrl
    if (!hasInvoice && !noInvoiceWarning) {
      setNoInvoiceWarning(true)
      return
    }

    let invoiceUrl: string | null = existingInvoiceUrl
    let attachmentUrl: string | null = existingAttachmentUrl
    if (form.invoiceFile) {
      const url = await uploadFile(form.invoiceFile, 'invoice')
      if (url) invoiceUrl = url
    }
    if (form.attachmentFile) {
      const url = await uploadFile(form.attachmentFile, 'attachment')
      if (url) attachmentUrl = url
    }

    setSaving(true)

    // Monta o payload: converte amount (string) para float e trata observations vazia como null
    const payload = {
      description:  form.description,
      amount:       parseFloat(form.amount),       // "123.45" → 123.45
      date:         form.date,
      category:     form.category,
      observations: form.observations || null,     // string vazia → null no banco
      invoice_url: invoiceUrl,
      attachment_url: attachmentUrl,
      motorcycle_id: form.motorcycle_id || null,
    }

    if (editing) {
      // Modo edição: atualiza apenas a linha com o ID da despesa em edição
      await supabase.from('expenses').update(payload).eq('id', editing.id)
    } else {
      // Modo criação: insere nova linha na tabela expenses
      await supabase.from('expenses').insert(payload)
    }

    setSaving(false)
    handleCloseModal()
    await fetchExpenses() // recarrega a lista para refletir a mudança
  }

  /**
   * @function handleDelete
   * @description Remove permanentemente a despesa selecionada do banco.
   *
   * Pré-condição: `deleting` deve ser não-nulo (garantido pelo modal de confirmação).
   * Após a exclusão: limpa `deleting` (fecha o modal) e recarrega a lista.
   *
   * O `saving` é ativado durante a operação para exibir loading no botão de confirmação
   * e impedir cliques duplos enquanto a exclusão está em curso.
   */
  async function handleDelete() {
    if (!deleting) return

    setSaving(true)
    await supabase.from('expenses').delete().eq('id', deleting.id)

    setSaving(false)
    setDeleting(null)    // fecha o modal de confirmação
    await fetchExpenses() // recarrega a lista para remover o item excluído
  }

  // ─── DADOS COMPUTADOS (memoizados) ─────────────────────────────────────────

  /**
   * @memo filteredExpenses
   * @description Lista de despesas filtradas por mês e busca textual.
   *
   * É a base para todos os outros cálculos derivados (kpis, groupedExpenses,
   * categoryTabs). Ao centralizar o filtro aqui, evitamos repetir a lógica
   * de filtro em múltiplos lugares.
   *
   * Filtros aplicados (AND):
   *   • monthFilter → `date` começa com 'YYYY-MM' (ex: "2026-03")
   *   • search      → `description` ou `observations` contêm o termo (case-insensitive)
   *
   * Recalculado apenas quando `expenses`, `monthFilter` ou `search` mudam.
   */
  const filteredExpenses = useMemo(() => {
    const q = search.toLowerCase()
    return expenses.filter(e => {
      const matchesMonth  = e.date.startsWith(monthFilter)
      // Sem busca → passa tudo. Com busca → verifica description e observations
      const matchesSearch = !search || (
        e.description.toLowerCase().includes(q) ||
        (e.observations ?? '').toLowerCase().includes(q)
      )
      return matchesMonth && matchesSearch
    })
  }, [expenses, monthFilter, search])

  /**
   * @memo kpis
   * @description Métricas calculadas a partir de `filteredExpenses` em uma única passagem.
   *
   * Otimização: usa um único `reduce` para calcular simultaneamente:
   *   • monthTotal         — soma de todos os valores no período
   *   • totalsPerCategory  — mapa de { categoria: soma } para identificar a maior
   *
   * Após o reduce, derivamos monthCount, monthAverage, topCategoryName e
   * topCategoryTotal sem iterar novamente sobre o array.
   *
   * Recalculado apenas quando `filteredExpenses` muda.
   */
  const kpis = useMemo(() => {
    // Única passagem sobre o array: calcula total e agrega por categoria
    const { total, byCategory } = filteredExpenses.reduce(
      (acc, e) => {
        const amt = Number(e.amount)
        acc.total += amt
        acc.byCategory[e.category] = (acc.byCategory[e.category] ?? 0) + amt
        return acc
      },
      { total: 0, byCategory: {} as Record<string, number> }
    )

    const monthCount   = filteredExpenses.length
    const monthAverage = monthCount > 0 ? total / monthCount : 0

    // Encontra a categoria com maior gasto total no período
    let topCategoryName  = '—'
    let topCategoryTotal = 0
    for (const [cat, catTotal] of Object.entries(byCategory)) {
      if (catTotal > topCategoryTotal) {
        topCategoryTotal = catTotal
        topCategoryName  = cat
      }
    }

    return { monthTotal: total, monthCount, monthAverage, topCategoryName, topCategoryTotal }
  }, [filteredExpenses])

  /**
   * @memo groupedExpenses
   * @description Agrupa as despesas por categoria para renderização no accordion.
   *
   * Pipeline de transformação:
   *   1. Aplica `categoryFilter` (pill ativo) sobre `filteredExpenses`
   *   2. Para cada categoria de EXPENSE_CATEGORIES, coleta os itens e soma o total
   *      em uma única passagem com reduce (evita dois filter/reduce separados)
   *   3. Remove categorias sem lançamentos (não aparecem no accordion)
   *   4. Mantém a ordem original de EXPENSE_CATEGORIES (não ordena por total)
   *
   * Recalculado apenas quando `filteredExpenses` ou `categoryFilter` mudam.
   */
  const groupedExpenses = useMemo(() => {
    // Aplica o filtro de categoria pill (se ativo)
    const source = categoryFilter
      ? filteredExpenses.filter(e => e.category === categoryFilter)
      : filteredExpenses

    // Agrupa em um único reduce: { [categoria]: { items, total } }
    const grouped = source.reduce(
      (acc, e) => {
        if (!acc[e.category]) acc[e.category] = { items: [], total: 0 }
        acc[e.category].items.push(e)
        acc[e.category].total += Number(e.amount)
        return acc
      },
      {} as Record<string, { items: Expense[]; total: number }>
    )

    // Retorna na ordem canônica de EXPENSE_CATEGORIES, descartando categorias vazias
    return EXPENSE_CATEGORIES
      .filter(cat => grouped[cat]?.items.length > 0)
      .map(cat => ({ category: cat, ...grouped[cat] }))
  }, [filteredExpenses, categoryFilter])

  /**
   * @memo categoryTabs
   * @description Abas pill de filtro por categoria exibidas na barra de filtros.
   *
   * Inclui sempre a aba "Todas" no início, seguida das categorias que têm
   * ao menos 1 lançamento no período filtrado (mês + busca).
   *
   * A contagem exibida entre parênteses reflete o número de lançamentos
   * daquela categoria no período atual — ajuda o usuário a decidir qual filtrar.
   *
   * Otimização: usa um único reduce sobre `filteredExpenses` para contar por
   * categoria, evitando múltiplas chamadas a Array.filter.
   *
   * Recalculado apenas quando `filteredExpenses` muda.
   */
  const categoryTabs = useMemo(() => {
    const counts = filteredExpenses.reduce(
      (acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + 1; return acc },
      {} as Record<string, number>
    )
    return [
      { id: '', label: 'Todas', count: filteredExpenses.length },
      ...EXPENSE_CATEGORIES.map(cat => ({ id: cat, label: cat, count: counts[cat] ?? 0 })),
    ]
  }, [filteredExpenses])

  const motorcycleOptions = useMemo(() => [
    { value: '', label: 'Empresa (despesa geral)' },
    ...motorcycles.map(m => ({
      value: m.id,
      label: `${m.license_plate} — ${m.model}`,
    })),
  ], [motorcycles])

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">

      {/* ── Header ─────────────────────────────────────────────────────────
          Componente compartilhado com todas as telas do sistema.
          O botão "Nova Despesa" fica alinhado à direita via prop `actions`.
      ────────────────────────────────────────────────────────────────────── */}
      <Header
        title="Despesas"
        subtitle="Gerencie as saídas financeiras da sua frota"
        actions={
          <Button onClick={() => handleOpenModal()}>
            <Plus className="w-4 h-4" />
            Nova Despesa
          </Button>
        }
      />

      {/* ── Área de conteúdo ─────────────────────────────────────────────── */}
      <div className="p-6 space-y-5">

        {/* ── KPI CARDS ────────────────────────────────────────────────────
            Grid de 4 cards de métricas. Em mobile: 2 colunas. Em sm+: 4 colunas.
            Os valores refletem sempre o período e a busca ativos nos filtros.
        ─────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

          {/* Total do Mês: soma de todas as despesas no período filtrado */}
          <KpiCard
            icon={TrendingDown}
            label="Total do Mês"
            value={formatCurrency(kpis.monthTotal)}
            sub={`${kpis.monthCount} lançamento${kpis.monthCount !== 1 ? 's' : ''}`}
          />

          {/* Lançamentos: quantidade de despesas no período filtrado */}
          <KpiCard
            icon={Receipt}
            label="Lançamentos"
            value={kpis.monthCount}
            sub="no período selecionado"
          />

          {/* Ticket Médio: média de valor por despesa no período filtrado */}
          <KpiCard
            icon={Activity}
            label="Ticket Médio"
            value={formatCurrency(kpis.monthAverage)}
            sub="por despesa"
          />

          {/* Maior Categoria: nome e total da categoria com maior gasto */}
          <KpiCard
            icon={Tag}
            label="Maior Categoria"
            value={kpis.topCategoryName}
            sub={kpis.topCategoryTotal > 0 ? formatCurrency(kpis.topCategoryTotal) : undefined}
          />
        </div>

        {/* ── BARRA DE FILTROS ─────────────────────────────────────────────
            Layout responsivo: coluna em mobile, linha única em desktop.
            Esquerda: abas pill de categoria (dinâmicas — só exibe com lançamentos)
            Direita:  seletor de mês + campo de busca
        ─────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Abas pill de categoria — geradas dinamicamente pelo memo categoryTabs */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {categoryTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  categoryFilter === tab.id
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1.5 text-[#616161]">({tab.count})</span>}
              </button>
            ))}
          </div>

          {/* Filtros secundários: seletor de mês e busca textual */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Seletor de mês — filtra despesas pelo campo `date` (startsWith YYYY-MM) */}
            <input
              type="month"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            />

            {/* Campo de busca com ícone — filtra em description e observations */}
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

        {/* ── ACCORDION AGRUPADO POR CATEGORIA ─────────────────────────────
            Renderização condicional em 3 estados:
              1. loading     → spinner centralizado
              2. lista vazia → estado vazio com ícone e mensagem
              3. com dados   → lista de accordions (um por categoria)

            Estrutura de cada accordion:
              [cabeçalho clicável: nome da categoria | contagem | total]
              [tabela expandida: data | descrição | valor | ações]
        ─────────────────────────────────────────────────────────────────── */}
        {loading ? (
          // Estado 1: carregando — spinner verde-limão centralizado
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>

        ) : groupedExpenses.length === 0 ? (
          // Estado 2: sem resultados — orienta o usuário a ajustar filtros ou cadastrar
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Receipt className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhuma despesa encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou registre uma nova despesa.</p>
          </div>

        ) : (
          // Estado 3: lista de grupos por categoria
          <div className="space-y-2">
            {groupedExpenses.map(({ category, items, total }) => {
              // Verifica se este grupo está expandido (ID ausente no Set = expandido)
              const isExpanded = !collapsedCategories.has(category)

              return (
                <div key={category} className="overflow-hidden rounded-xl bg-[#202020]">

                  {/* ── Cabeçalho do accordion (clicável) ───────────────────
                      Ao clicar, toggleCategory alterna o Set de colapsados.
                      A seta ChevronDown rotaciona via CSS quando colapsado.
                  ────────────────────────────────────────────────────────── */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#323232] transition-colors text-left"
                  >
                    {/* Seta: rotaciona -90° quando colapsado (via classe Tailwind) */}
                    <ChevronDown className={`w-4 h-4 text-[#9e9e9e] shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />

                    {/* Nome da categoria em destaque */}
                    <span className="font-medium text-[#f5f5f5] text-[13px]">{category}</span>

                    {/* Contagem de lançamentos + valor total alinhados à direita */}
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#323232] text-[#9e9e9e]">
                        {items.length} lançamento{items.length !== 1 ? 's' : ''}
                      </span>
                      {/* Total da categoria em vermelho — representa saída financeira */}
                      <span className="text-[13px] font-bold text-[#ff9c9a] ml-1">
                        {formatCurrency(total)}
                      </span>
                    </div>
                  </button>

                  {/* ── Tabela de despesas (visível apenas quando expandido) ──
                      border-t separa o cabeçalho do conteúdo.
                      overflow-x-auto em div separado garante scroll horizontal
                      sem cortar o border-radius do card pai.
                  ────────────────────────────────────────────────────────── */}
                  {isExpanded && (
                    <div className="border-t border-[#323232]">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[13px] text-[#f5f5f5]">

                          {/* Cabeçalho da tabela — padrão do design system: sem bg, uppercase, cor secundária */}
                          <thead>
                            <tr className="border-b border-[#323232]">
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Data</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Descrição</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Valor</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e] text-right">Ações</th>
                            </tr>
                          </thead>

                          <tbody>
                            {items.map(item => {
                              /* Calcula a moto vinculada uma única vez por linha (evita 3x find) */
                              const moto = motorcycles.find(m => m.id === item.motorcycle_id)
                              return (
                              <tr key={item.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232]">

                                {/* Data: formatada para DD/MM/AAAA via formatDate */}
                                <td className="px-4">
                                  <p className="text-[#f5f5f5]">{formatDate(item.date)}</p>
                                </td>

                                {/* Descrição + observações opcionais em fonte menor */}
                                <td className="px-4 max-w-xs">
                                  <p className="font-medium text-[#f5f5f5]">{item.description}</p>
                                  {item.observations && (
                                    <p className="text-[12px] text-[#9e9e9e] mt-0.5 line-clamp-1">
                                      {item.observations}
                                    </p>
                                  )}
                                  {/* Placa e modelo da moto vinculada, se existir */}
                                  {moto && (
                                    <p className="text-[12px] text-[#9e9e9e] mt-0.5">
                                      {moto.license_plate}{' — '}{moto.model}
                                    </p>
                                  )}
                                  {/* Badge de aviso: despesa sem nota fiscal */}
                                  {!item.invoice_url && (
                                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#3a180f] text-[#e65e24] border border-[#e65e24]">
                                      <AlertCircle className="w-3 h-3" />
                                      Sem NF
                                    </span>
                                  )}
                                  {/* Links para arquivos já enviados ao Storage */}
                                  <div className="flex gap-2 mt-1 flex-wrap">
                                    {item.invoice_url && (
                                      <a href={item.invoice_url} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#243300] text-[#BAFF1A] border border-[#6b9900] transition-colors">
                                        <FileText className="w-3 h-3" />
                                        Nota Fiscal
                                      </a>
                                    )}
                                    {item.attachment_url && (
                                      <a href={item.attachment_url} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#2d0363] text-[#a880ff] border border-[#a880ff] transition-colors">
                                        <Paperclip className="w-3 h-3" />
                                        Anexo
                                      </a>
                                    )}
                                  </div>
                                </td>

                                {/* Valor em vermelho — destaca o impacto financeiro */}
                                <td className="px-4">
                                  <span className="font-medium text-[#ff9c9a]">
                                    {formatCurrency(Number(item.amount))}
                                  </span>
                                </td>

                                {/* Ações: Editar (secondary) e Excluir (danger) */}
                                <td className="px-4 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="secondary" size="sm" className="h-8 w-8 p-0"
                                      onClick={() => handleOpenModal(item)} title="Editar">
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                      onClick={() => setDeleting(item)} title="Excluir">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Criar / Editar Despesa ────────────────────────────────────
          Título e comportamento mudam dinamicamente com base no estado `editing`:
            • editing = null   → título "Nova Despesa"  | salva via INSERT
            • editing = objeto → título "Editar Despesa" | salva via UPDATE
      ────────────────────────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={editing ? 'Editar Despesa' : 'Nova Despesa'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-3">

          {/* Descrição: campo obrigatório — texto livre */}
          <Input
            label="Descrição"
            type="text"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Ex: Troca de óleo da ABC-1234"
            required
          />

          {/* Linha com Valor e Data lado a lado em telas maiores */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Valor (R$)"
              type="number"
              step="0.01"   // permite centavos
              min="0"       // impede valores negativos
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
              required
            />
            <Input
              label="Data"
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>

          {/* Categoria: select com opções fixas de EXPENSE_CATEGORIES */}
          <Select
            label="Categoria"
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            options={CATEGORY_OPTIONS}
            required
          />

          <Select
            label="Vínculo"
            value={form.motorcycle_id}
            onChange={e => setForm({ ...form, motorcycle_id: e.target.value })}
            options={motorcycleOptions}
          />

          {/* Observações: campo opcional — NF, comprovante, detalhes extras */}
          <Textarea
            label="Observações"
            value={form.observations}
            onChange={e => setForm({ ...form, observations: e.target.value })}
            placeholder="Detalhes adicionais, número de nota fiscal, etc. (opcional)"
          />

          {/* Seção de documentos — dois uploads lado a lado */}
          <div className="space-y-2">
            <p className="text-[13px] text-[#9e9e9e]">Documentos</p>
            <div className="grid grid-cols-2 gap-3">

            {/* Nota Fiscal */}
            <div className="space-y-1">
              <label className="text-[13px] text-[#9e9e9e] mb-1 block">
                Nota Fiscal
                <span className="ml-2 text-[#616161] text-[12px]">(PDF ou imagem)</span>
              </label>
              <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border rounded-lg h-12 transition-colors ${
                form.invoiceFile || existingInvoiceUrl
                  ? 'border-[#6b9900]'
                  : 'border-[#474747] hover:border-[#BAFF1A]'
              }`}>
                <FileText className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                  {form.invoiceFile
                    ? form.invoiceFile.name
                    : existingInvoiceUrl
                      ? 'Nota fiscal já anexada'
                      : 'Nenhum arquivo selecionado'}
                </span>
                {(form.invoiceFile || existingInvoiceUrl) && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, invoiceFile: null })
                      setExistingInvoiceUrl(null)
                    }}
                    className="text-[#9e9e9e] hover:text-[#ff9c9a] transition-colors shrink-0"
                    title="Remover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {existingInvoiceUrl && !form.invoiceFile && (
                  <a
                    href={existingInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[#BAFF1A] hover:text-[#a8e617] transition-colors shrink-0"
                    title="Ver arquivo"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => {
                    setNoInvoiceWarning(false)
                    setForm({ ...form, invoiceFile: e.target.files?.[0] ?? null })
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>

            {/* Arquivo Adicional */}
            <div className="space-y-1">
              <label className="text-[13px] text-[#9e9e9e] mb-1 block">
                Arquivo Adicional
                <span className="ml-2 text-[#616161] text-[12px]">(opcional)</span>
              </label>
              <div className={`relative flex items-center gap-3 px-4 bg-[#323232] border rounded-lg h-12 transition-colors ${
                form.attachmentFile || existingAttachmentUrl
                  ? 'border-[#a880ff]'
                  : 'border-[#474747] hover:border-[#BAFF1A]'
              }`}>
                <Paperclip className="w-4 h-4 text-[#9e9e9e] shrink-0" />
                <span className="flex-1 text-[13px] truncate text-[#9e9e9e]">
                  {form.attachmentFile
                    ? form.attachmentFile.name
                    : existingAttachmentUrl
                      ? 'Arquivo já anexado'
                      : 'Nenhum arquivo selecionado'}
                </span>
                {(form.attachmentFile || existingAttachmentUrl) && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, attachmentFile: null })
                      setExistingAttachmentUrl(null)
                    }}
                    className="text-[#9e9e9e] hover:text-[#ff9c9a] transition-colors shrink-0"
                    title="Remover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {existingAttachmentUrl && !form.attachmentFile && (
                  <a
                    href={existingAttachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[#a880ff] hover:text-[#c4a8ff] transition-colors shrink-0"
                    title="Ver arquivo"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => setForm({ ...form, attachmentFile: e.target.files?.[0] ?? null })}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>
            </div>{/* fim grid */}
          </div>

          {/* Alerta: despesa sem nota fiscal — aparece acima dos botões sem aumentar o modal */}
          {noInvoiceWarning && (
            <div className="bg-[#3a180f] border border-[#e65e24] rounded-xl p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#e65e24] shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-medium text-[#e65e24]">Despesa sem Nota Fiscal</p>
                <p className="text-[12px] text-[#e65e24] mt-0.5 leading-tight opacity-80">
                  Não recomendado para controle financeiro. Deseja realmente continuar?
                </p>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-3 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={handleCloseModal}>
              Cancelar
            </Button>
            {noInvoiceWarning ? (
              <Button type="submit" loading={saving} variant="danger">
                Cadastrar sem NF
              </Button>
            ) : (
              <Button type="submit" loading={saving}>
                {editing ? 'Salvar Alterações' : 'Criar Despesa'}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* ── Modal: Confirmar Exclusão ─────────────────────────────────────────
          Ação destrutiva e irreversível — exige confirmação explícita do usuário.
          Abre apenas quando `deleting` é não-nulo (ao clicar no botão de lixeira).
          O nome da despesa é exibido para o usuário confirmar o item correto.
      ────────────────────────────────────────────────────────────────────── */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir Despesa"
        size="sm"
      >
        <div className="space-y-4">
          {/* Texto de confirmação: exibe o nome da despesa a ser excluída */}
          <p className="text-[#9e9e9e] text-[13px]">
            Tem certeza que deseja excluir a despesa{' '}
            <span className="text-[#f5f5f5] font-medium">{deleting?.description}</span>?
            Esta ação removerá permanentemente o registro.
          </p>
          <div className="flex gap-3 justify-end">
            {/* Cancelar: fecha o modal sem nenhuma alteração */}
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            {/* Excluir: chama handleDelete e exibe loading enquanto processa */}
            <Button variant="danger" loading={saving} onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
