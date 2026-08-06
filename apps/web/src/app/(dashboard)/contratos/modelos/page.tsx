'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, FileText, Edit2, Trash2, Eye, Search, Clock } from 'lucide-react'
import { useContractTemplates } from '@gomoto/data'
import { Button } from '@/components/ui/Button'
import { PageTitle } from '@/components/layout/PageTitle'
import { Modal } from '@/components/ui/Modal'
import { deleteContractTemplate } from './actions'
import type { ContractTemplate } from '@gomoto/core'

function fmt(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function ModelosPage() {
  const { data: templates = [], isLoading } = useContractTemplates()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<ContractTemplate | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  async function handleDelete() {
    if (!deleting) return
    setIsDeleting(true)
    setDeleteError(null)
    const res = await deleteContractTemplate(deleting.id)
    setIsDeleting(false)
    if (res.error) { setDeleteError(res.error); return }
    setDeleting(null)
  }

  return (
    <div className="flex flex-col min-h-full bg-bg">
      <PageTitle
        title="Modelos de Contrato"
        actions={
          <Link href="/contratos/modelos/novo">
            <Button variant="primary" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Novo modelo
            </Button>
          </Link>
        }
      />

      <div className="p-6 space-y-5">

        {/* Busca */}
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-mute" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar modelo..."
            className="h-9 pl-9 pr-4 w-full bg-surface border border-border rounded-full text-[13px] text-fg placeholder:text-fg-mute focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 bg-surface rounded-2xl flex items-center justify-center">
              <FileText className="w-8 h-8 text-border" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-medium text-fg">
                {search ? 'Nenhum modelo encontrado' : 'Nenhum modelo cadastrado'}
              </p>
              <p className="text-[13px] text-fg-mute mt-1">
                {search
                  ? 'Tente outros termos de busca'
                  : 'Crie o primeiro modelo de contrato para começar'}
              </p>
            </div>
            {!search && (
              <Link href="/contratos/modelos/novo">
                <Button variant="primary" size="sm" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Criar primeiro modelo
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(tpl => (
              <div
                key={tpl.id}
                className="bg-surface border border-surface-2 rounded-xl p-5 flex flex-col gap-4 hover:border-border transition-colors"
              >
                {/* Ícone + nome */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-surface border border-surface-2 rounded-xl flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-fg truncate">{tpl.name}</p>
                    {tpl.description && (
                      <p className="text-[12px] text-fg-mute mt-0.5 line-clamp-2">{tpl.description}</p>
                    )}
                  </div>
                </div>

                {/* Indicador de conteúdo */}
                <div className={`flex items-center gap-1.5 text-[12px] ${tpl.content ? 'text-success' : 'text-fg-mute'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${tpl.content ? 'bg-success' : 'bg-fg-mute'}`} />
                  {tpl.content ? 'Conteúdo redigido' : 'Sem conteúdo'}
                </div>

                {/* Data de atualização */}
                <div className="flex items-center gap-1.5 text-[12px] text-fg-mute">
                  <Clock className="w-3.5 h-3.5" />
                  Atualizado em {fmt(tpl.updated_at)}
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-surface-2">
                  <Link href={`/contratos/modelos/${tpl.id}`} className="flex-1">
                    <Button variant="secondary" size="sm" className="w-full gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Visualizar
                    </Button>
                  </Link>
                  <Link href={`/contratos/modelos/${tpl.id}/editar`}>
                    <Button variant="secondary" size="sm" className="gap-1.5 w-9 p-0">
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="danger"
                    size="sm"
                    className="gap-1.5 w-9 p-0"
                    onClick={() => { setDeleting(tpl); setDeleteError(null) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal confirmação de exclusão */}
      <Modal
        open={!!deleting}
        onClose={() => { setDeleting(null); setDeleteError(null) }}
        title="Excluir modelo"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-fg-soft">
            Tem certeza que deseja excluir o modelo{' '}
            <strong className="text-fg">{deleting?.name}</strong>?
            Esta ação não pode ser desfeita.
          </p>
          {deleteError && (
            <p className="text-[13px] text-danger bg-[#2a0a0a] border border-danger rounded-lg px-3 py-2">
              {deleteError}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => { setDeleting(null); setDeleteError(null) }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={isDeleting}
              onClick={handleDelete}
            >
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
