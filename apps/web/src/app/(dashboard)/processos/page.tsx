/**
 * @file src/app/(dashboard)/processos/page.tsx
 * @description Página de Gestão de Processos e Base de Conhecimento da GoMoto.
 */

'use client'

import { useEffect, useState, useMemo } from 'react'
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp, BookOpen, Search } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import type { Process } from '@/types'

/**
 * @type ProcessFormData
 * @description Estrutura de dados para o formulário de criação/edição de processos.
 */
type ProcessFormData = {
  question: string
  answer: string
  category: string
}

/**
 * @constant categories
 * @description Lista fixa de categorias para classificar os processos da empresa.
 */
const categories: string[] = [
  'Locação',
  'Cobrança',
  'Manutenção',
  'Documentação',
  'Plano Fidelidade',
  'Procedimentos Internos',
  'Geral'
]

/**
 * @constant categoryBadgeVariant
 * @description Mapeamento de estilos visuais (cores do Badge) para cada categoria.
 */
const categoryBadgeVariant: Record<string, 'success' | 'info' | 'warning' | 'muted' | 'brand' | 'danger'> = {
  Locação: 'brand',
  Cobrança: 'warning',
  Manutenção: 'info',
  Documentação: 'success',
  'Plano Fidelidade': 'danger',
  'Procedimentos Internos': 'info',
  Geral: 'muted',
}

/**
 * @constant defaultForm
 * @description Estado inicial para o formulário de criação/edição de processos.
 */
const defaultForm: ProcessFormData = { 
  question: '', 
  answer: '', 
  category: 'Geral' 
}

/**
 * @component ProcessesPage
 * @description Componente principal que renderiza a lista de processos em formato de acordeão.
 */
export default function ProcessesPage() {
  const supabase = createClient()

  // --- Estado (State) ---

  /**
   * @state processes
   * @description Lista completa de processos carregada do banco de dados.
   */
  const [processes, setProcesses] = useState<Process[]>([])

  /**
   * @state loadingProcesses
   * @description Indica se a lista de processos está sendo carregada.
   */
  const [loadingProcesses, setLoadingProcesses] = useState<boolean>(true)

  /**
   * @state expandedId
   * @description ID do processo que está atualmente expandido no acordeão.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /**
   * @state categoryFilter
   * @description Categoria selecionada para filtrar a lista.
   */
  const [categoryFilter, setCategoryFilter] = useState<string>('')

  /**
   * @state isModalOpen
   * @description Controla a visibilidade do modal de cadastro/edição.
   */
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)

  /**
   * @state editingProcess
   * @description Objeto do processo que está sendo editado (null se for criação).
   */
  const [editingProcess, setEditingProcess] = useState<Process | null>(null)

  /**
   * @state form
   * @description Valores atuais do formulário no modal.
   */
  const [form, setForm] = useState<ProcessFormData>(defaultForm)

  /**
   * @state search
   * @description Texto digitado no campo de busca.
   */
  const [search, setSearch] = useState<string>('')

  // --- Efeitos (Effects) ---

  useEffect(() => {
    void fetchProcesses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Lógica de Filtro e Agrupamento ---

  /**
   * @memo filteredProcesses
   * @description Lista de processos após aplicar os filtros de categoria e busca.
   */
  const filteredProcesses = useMemo(() => {
    return processes.filter((p) => {
      const matchesCategory = !categoryFilter || p.category === categoryFilter
      const matchesSearch =
        !search ||
        p.question.toLowerCase().includes(search.toLowerCase()) ||
        p.answer.toLowerCase().includes(search.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [processes, categoryFilter, search])

  /**
   * @memo groupedProcesses
   * @description Processos filtrados e organizados por suas respectivas categorias.
   */
  const groupedProcesses = useMemo(() => {
    return categories.reduce<Record<string, Process[]>>((acc, cat) => {
      const items = filteredProcesses.filter((p) => p.category === cat)
      if (items.length > 0) acc[cat] = items
      return acc
    }, {})
  }, [filteredProcesses])

  // --- Manipuladores de Eventos (Handlers) ---

  /**
   * @function fetchProcesses
   * @description Busca a lista de processos no Supabase.
   */
  async function fetchProcesses(): Promise<void> {
    setLoadingProcesses(true)
    try {
      const { data, error } = await supabase
        .from('processes')
        .select('*')
        .order('order', { ascending: true })

      if (error) throw error

      setProcesses((data as Process[]) ?? [])
    } catch {
      alert('Erro ao carregar os processos.')
    } finally {
      setLoadingProcesses(false)
    }
  }

  /**
   * @function handleSubmit
   * @description Processa o envio do formulário (Insert ou Update).
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()

    try {
      if (editingProcess) {
        const { error } = await supabase
          .from('processes')
          .update({
            question: form.question,
            answer: form.answer,
            category: form.category,
            order: editingProcess.order,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingProcess.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('processes').insert([
          {
            question: form.question,
            answer: form.answer,
            category: form.category,
            order: processes.length + 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])

        if (error) throw error
      }

      setForm(defaultForm)
      setEditingProcess(null)
      setIsModalOpen(false)
      await fetchProcesses()
    } catch {
      alert('Erro ao salvar o processo.')
    }
  }

  /**
   * @function handleEdit
   * @description Prepara o estado para editar um processo existente.
   */
  function handleEdit(process: Process): void {
    setEditingProcess(process)
    setForm({ 
      question: process.question, 
      answer: process.answer, 
      category: process.category 
    })
    setIsModalOpen(true)
  }

  /**
   * @function handleDelete
   * @description Remove um processo definitivamente.
   */
  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Tem certeza que deseja excluir este processo?')) return

    try {
      const { error } = await supabase.from('processes').delete().eq('id', id)

      if (error) throw error

      await fetchProcesses()
    } catch {
      alert('Erro ao excluir o processo.')
    }
  }

  /**
   * @function handleOpenModal
   * @description Abre o modal em modo de criação.
   */
  function handleOpenModal(): void {
    setEditingProcess(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  /**
   * @function toggleExpand
   * @description Alterna o estado de expansão de um item do acordeão.
   */
  function toggleExpand(id: string): void {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // --- Renderização (Render) ---

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Processos da Empresa"
        subtitle={`${processes.length} processos cadastrados`}
        actions={
          <Button onClick={handleOpenModal}>
            <Plus className="w-4 h-4" />
            Adicionar Processo
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        {/* Filtros e Busca */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-4 bg-[#323232] border border-[#474747] rounded-full h-10 w-64 focus-within:border-[#616161]">
            <Search className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar pergunta ou resposta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[#f5f5f5] text-[13px] outline-none placeholder:text-[#616161]"
            />
          </div>

          <div className="w-px h-5 bg-[#616161]" />
          <BookOpen className="w-4 h-4 text-[#9e9e9e]" />

          <div className="flex flex-wrap border-b border-[#616161]">
            {[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c, label: c }))].map(
              (opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCategoryFilter(opt.value)}
                  className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${
                    categoryFilter === opt.value
                      ? 'border-[#BAFF1A] text-[#f5f5f5]'
                      : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                  }`}
                >
                  {opt.label}
                </button>
              )
            )}
          </div>
        </div>

        {loadingProcesses ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Listagem Agrupada por Categoria */}
            {Object.entries(groupedProcesses).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center gap-2 py-1">
                  <Badge variant={categoryBadgeVariant[category] ?? 'muted'}>{category}</Badge>
                  <span className="text-[13px] text-[#9e9e9e]">{items.length} processo(s)</span>
                </div>

                <div className="space-y-1">
                  {items.map((process) => (
                    <div
                      key={process.id}
                      className="bg-[#202020] rounded-xl overflow-hidden"
                    >
                      <button
                        className="w-full min-h-[56px] flex items-center justify-between gap-4 p-4 text-left"
                        onClick={() => toggleExpand(process.id)}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {process.category === 'Procedimentos Internos' && (
                            <span className="mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-[13px] font-medium bg-[#2d0363] text-[#a880ff]">
                              Interno
                            </span>
                          )}
                          <p className="font-medium text-[#f5f5f5] text-[13px] leading-relaxed">
                            {process.question}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEdit(process)
                            }}
                            title="Editar processo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDelete(process.id)
                            }}
                            title="Excluir processo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {expandedId === process.id ? (
                            <ChevronUp className="w-4 h-4 text-[#9e9e9e]" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-[#9e9e9e]" />
                          )}
                        </div>
                      </button>

                      {expandedId === process.id && (
                        <div className="px-4 pb-4 border-t border-[#323232] pt-3">
                          <p className="text-[13px] text-[#9e9e9e] leading-relaxed whitespace-pre-wrap">
                            {process.answer}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Feedback para lista vazia */}
            {filteredProcesses.length === 0 && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <BookOpen className="w-12 h-12 text-[#616161] mx-auto mb-3" />
                  <p className="text-[13px] text-[#9e9e9e]">
                    {search ? `Nenhum resultado para "${search}"` : 'Nenhum processo encontrado'}
                  </p>
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="mt-2 text-[13px] text-[#BAFF1A] hover:underline"
                    >
                      Limpar busca
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de Cadastro/Edição */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingProcess ? 'Editar Processo' : 'Adicionar Novo Processo'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Categoria"
            options={categories.map((c) => ({ value: c, label: c }))}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <Input
            label="Pergunta"
            placeholder="Ex: Como funciona o processo de locação?"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            required
          />
          <Textarea
            label="Resposta"
            placeholder="Descreva o processo de forma clara e objetiva..."
            rows={5}
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            required
          />
          
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">
              {editingProcess ? (
                <>
                  <Edit2 className="w-4 h-4" />
                  Salvar Alterações
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Adicionar Processo
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
