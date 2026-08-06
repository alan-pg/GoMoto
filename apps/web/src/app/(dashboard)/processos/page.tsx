/**
 * @file src/app/(dashboard)/processos/page.tsx
 * @description Página de Gestão de Processos e Base de Conhecimento da GoMoto.
 */

'use client'

import { useState, useMemo } from 'react'
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp, BookOpen, Search } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useProcesses, useCreateProcess, useUpdateProcess, useDeleteProcess } from '@gomoto/data'
import type { Process } from '@gomoto/core'

type ProcessFormData = {
  question: string
  answer: string
  category: string
}

const categories: string[] = [
  'Locação',
  'Cobrança',
  'Manutenção',
  'Documentação',
  'Plano Fidelidade',
  'Procedimentos Internos',
  'Geral'
]

const categoryBadgeVariant: Record<string, 'success' | 'info' | 'warning' | 'muted' | 'brand' | 'danger'> = {
  Locação: 'brand',
  Cobrança: 'warning',
  Manutenção: 'info',
  Documentação: 'success',
  'Plano Fidelidade': 'danger',
  'Procedimentos Internos': 'info',
  Geral: 'muted',
}

const defaultForm: ProcessFormData = { question: '', answer: '', category: 'Geral' }

export default function ProcessesPage() {
  const { data: processes = [], isLoading } = useProcesses()
  const createProcess = useCreateProcess()
  const updateProcess = useUpdateProcess()
  const deleteProcess = useDeleteProcess()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [editingProcess, setEditingProcess] = useState<Process | null>(null)
  const [form, setForm] = useState<ProcessFormData>(defaultForm)
  const [search, setSearch] = useState<string>('')

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

  const groupedProcesses = useMemo(() => {
    return categories.reduce<Record<string, Process[]>>((acc, cat) => {
      const items = filteredProcesses.filter((p) => p.category === cat)
      if (items.length > 0) acc[cat] = items
      return acc
    }, {})
  }, [filteredProcesses])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      if (editingProcess) {
        await updateProcess.mutateAsync({
          id: editingProcess.id,
          payload: {
            question: form.question,
            answer: form.answer,
            category: form.category,
            order: editingProcess.order,
          },
        })
      } else {
        await createProcess.mutateAsync({
          question: form.question,
          answer: form.answer,
          category: form.category,
          order: processes.length + 1,
        })
      }
      setForm(defaultForm)
      setEditingProcess(null)
      setIsModalOpen(false)
    } catch {
      alert('Erro ao salvar o processo.')
    }
  }

  function handleEdit(process: Process): void {
    setEditingProcess(process)
    setForm({ question: process.question, answer: process.answer, category: process.category })
    setIsModalOpen(true)
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Tem certeza que deseja excluir este processo?')) return
    try {
      await deleteProcess.mutateAsync(id)
    } catch {
      alert('Erro ao excluir o processo.')
    }
  }

  function handleOpenModal(): void {
    setEditingProcess(null)
    setForm(defaultForm)
    setIsModalOpen(true)
  }

  function toggleExpand(id: string): void {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageTitle
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
          <div className="flex items-center gap-2 px-4 bg-surface-2 border border-border rounded-full h-10 w-64 focus-within:border-fg-mute">
            <Search className="w-4 h-4 text-fg-mute flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar pergunta ou resposta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-fg text-[13px] outline-none placeholder:text-fg-mute"
            />
          </div>

          <div className="w-px h-5 bg-fg-mute" />
          <BookOpen className="w-4 h-4 text-fg-mute" />

          <div className="flex flex-wrap border-b border-fg-mute">
            {[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c, label: c }))].map(
              (opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCategoryFilter(opt.value)}
                  className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${
                    categoryFilter === opt.value
                      ? 'border-primary text-fg'
                      : 'border-transparent text-fg-mute hover:text-fg'
                  }`}
                >
                  {opt.label}
                </button>
              )
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {Object.entries(groupedProcesses).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center gap-2 py-1">
                  <Badge variant={categoryBadgeVariant[category] ?? 'muted'}>{category}</Badge>
                  <span className="text-[13px] text-fg-mute">{items.length} processo(s)</span>
                </div>

                <div className="space-y-1">
                  {items.map((process) => (
                    <div key={process.id} className="bg-surface rounded-xl overflow-hidden">
                      <button
                        className="w-full min-h-[56px] flex items-center justify-between gap-4 p-4 text-left"
                        onClick={() => toggleExpand(process.id)}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {process.category === 'Procedimentos Internos' && (
                            <span className="mt-0.5 flex-shrink-0 px-2 py-0.5 rounded-full text-[13px] font-medium bg-info-bg text-info">
                              Interno
                            </span>
                          )}
                          <p className="font-medium text-fg text-[13px] leading-relaxed">
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
                            <ChevronUp className="w-4 h-4 text-fg-mute" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-fg-mute" />
                          )}
                        </div>
                      </button>

                      {expandedId === process.id && (
                        <div className="px-4 pb-4 border-t border-surface-2 pt-3">
                          <p className="text-[13px] text-fg-mute leading-relaxed whitespace-pre-wrap">
                            {process.answer}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {filteredProcesses.length === 0 && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <BookOpen className="w-12 h-12 text-fg-mute mx-auto mb-3" />
                  <p className="text-[13px] text-fg-mute">
                    {search ? `Nenhum resultado para "${search}"` : 'Nenhum processo encontrado'}
                  </p>
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="mt-2 text-[13px] text-primary hover:underline"
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
            <Button type="submit" disabled={createProcess.isPending || updateProcess.isPending}>
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
