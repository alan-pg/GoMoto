'use client'

import { useCallback, useState } from 'react'
import { Printer, Eye, Variable, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ContractTemplate } from '@gomoto/core'
import { buildSampleData, substituteVariables } from '@gomoto/core'
import { renderContractTemplateHtml } from '@/lib/contract-render'
import { printHtmlDocument } from '@/lib/contract-print'

interface Props {
  template: ContractTemplate
}

type ViewMode = 'template' | 'preview'

export function TemplatePreview({ template }: Props) {
  const [mode, setMode] = useState<ViewMode>('template')
  const [printing, setPrinting] = useState(false)

  const html = renderContractTemplateHtml(template.content as Record<string, unknown> | null)
  const previewHtml = html ? substituteVariables(html, buildSampleData()) : null

  const handlePrint = useCallback(async () => {
    if (!previewHtml) return
    setPrinting(true)
    try {
      await printHtmlDocument(previewHtml, template.name)
    } finally {
      setPrinting(false)
    }
  }, [previewHtml, template.name])

  if (!template.content) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-surface border border-divider rounded-xl">
        <Variable className="w-8 h-8 text-border" />
        <p className="text-[14px] text-fg-mute">Este modelo ainda não possui conteúdo</p>
        <p className="text-[12px] text-fg-mute">Clique em "Editar" para redigir o contrato</p>
      </div>
    )
  }

  return (
    // h-full: ocupa o espaço que o pai (p-4, flex-1 min-h-0) concede
    <div className="h-full flex flex-col gap-3">

      {/* Barra de controles — shrink-0 */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-surface border border-divider rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode('template')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              mode === 'template'
                ? 'bg-surface-2 text-fg'
                : 'text-fg-mute hover:text-fg'
            }`}
          >
            <Variable className="w-3.5 h-3.5" />
            Com variáveis
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              mode === 'preview'
                ? 'bg-surface-2 text-fg'
                : 'text-fg-mute hover:text-fg'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Pré-visualização
          </button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="gap-2"
          loading={printing}
          onClick={handlePrint}
        >
          <Printer className="w-4 h-4" />
          Imprimir / PDF
        </Button>
      </div>

      {/* Nota sobre pré-visualização — shrink-0, condicional */}
      {mode === 'preview' && (
        <div className="shrink-0 flex items-center gap-2 text-[12px] text-fg-mute bg-surface border border-divider rounded-lg px-4 py-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 text-fg-mute" />
          Dados de exemplo. Na utilização real, serão preenchidos com as informações da locação.
        </div>
      )}

      {/* Documento — flex-1 min-h-0, scroll interno */}
      <div className="flex-1 min-h-0 rounded-xl border border-divider overflow-hidden">
        {/* Fundo cinza (mesa) — as .contract-page geradas pelo generateHTML são folhas brancas */}
        <div
          className="h-full overflow-y-auto contract-preview-canvas"
          style={{ background: '#c8cdd6', padding: '32px 0' }}
          dangerouslySetInnerHTML={{
            __html: mode === 'preview' ? (previewHtml ?? '') : (html ?? ''),
          }}
        />
      </div>
    </div>
  )
}
