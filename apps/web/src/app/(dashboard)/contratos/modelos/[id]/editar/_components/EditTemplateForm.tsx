'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Save, ArrowLeft, Trash2, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ContractTemplateEditor } from '../../../_components/ContractTemplateEditor'
import { updateContractTemplate, deleteContractTemplate } from '../../../actions'
import { Modal } from '@/components/ui/Modal'
import type { ContractTemplate } from '@gomoto/core'

interface Props {
  template: ContractTemplate
}

export function EditTemplateForm({ template }: Props) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [content, setContent] = useState<Record<string, unknown> | null>(
    template.content as Record<string, unknown> | null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleContentChange = useCallback((c: Record<string, unknown>) => {
    setContent(c)
  }, [])

  async function handleSave() {
    if (!name.trim()) { setError('O nome do modelo é obrigatório'); return }
    setSaving(true)
    setError(null)
    const res = await updateContractTemplate(template.id, {
      name: name.trim(),
      description: description.trim() || null,
      content: content ? JSON.parse(JSON.stringify(content)) : null,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    router.push(`/contratos/modelos/${template.id}`)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await deleteContractTemplate(template.id)
    setDeleting(false)
    if (res.error) { setError(res.error); setShowDeleteModal(false); return }
    router.push('/contratos/modelos')
  }

  return (
    // h-full preenche exatamente o <main> do LayoutShell (flex-1 min-h-0)
    <div className="h-full flex flex-col bg-bg overflow-hidden">

      {/* Header com metadados integrados */}
      <div className="shrink-0 bg-bg border-b border-surface-2 px-6 py-3 space-y-3">
        {/* Linha 1: navegação + ações */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/contratos/modelos/${template.id}`}
            className="flex items-center gap-1.5 text-[13px] text-fg-mute hover:text-fg transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Modelos
          </Link>
          <span className="text-border shrink-0">/</span>
          <span className="text-[13px] text-fg-mute truncate flex-1">{template.name}</span>

          <Button
            variant="secondary"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => setShowDeleteModal(true)}
          >
            <Trash2 className="w-4 h-4" />
            Excluir
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="gap-2 shrink-0"
            loading={saving}
            onClick={handleSave}
          >
            <Save className="w-4 h-4" />
            Salvar
          </Button>
        </div>

        {/* Linha 2: campos de metadados */}
        <div className="flex gap-3 items-center">
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            className={`h-9 flex-1 bg-surface border rounded-lg px-3 text-[14px] font-semibold text-fg placeholder:text-border focus:ring-1 outline-none transition-colors ${
              error ? 'border-danger focus:border-danger focus:ring-danger' : 'border-surface-2 focus:border-primary focus:ring-primary'
            }`}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Descrição (opcional)..."
            className="h-9 flex-1 bg-surface border border-surface-2 rounded-lg px-3 text-[13px] text-fg-soft placeholder:text-border focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
          />
        </div>

        {/* Erro inline */}
        {error && (
          <div className="flex items-center gap-2 text-[12px] text-danger">
            <Info className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Editor — flex-1 preenche todo o restante, sem scroll externo */}
      <div className="flex-1 min-h-0 p-4">
        <ContractTemplateEditor
          className="h-full"
          initialContent={content}
          onChange={handleContentChange}
        />
      </div>

      {/* Modal de exclusão */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Excluir modelo"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-fg-soft">
            Tem certeza que deseja excluir{' '}
            <strong className="text-fg">{template.name}</strong>?
            Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => setShowDeleteModal(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={deleting}
              onClick={handleDelete}
            >
              Excluir modelo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
