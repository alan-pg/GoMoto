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
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-[#202020] border border-[#323232] rounded-xl">
        <Variable className="w-8 h-8 text-[#474747]" />
        <p className="text-[14px] text-[#9e9e9e]">Este modelo ainda não possui conteúdo</p>
        <p className="text-[12px] text-[#616161]">Clique em "Editar" para redigir o contrato</p>
      </div>
    )
  }

  return (
    // h-full: ocupa o espaço que o pai (p-4, flex-1 min-h-0) concede
    <div className="h-full flex flex-col gap-3">

      {/* Barra de controles — shrink-0 */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-[#202020] border border-[#323232] rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode('template')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              mode === 'template'
                ? 'bg-[#323232] text-[#f5f5f5]'
                : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
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
                ? 'bg-[#323232] text-[#f5f5f5]'
                : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
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
        <div className="shrink-0 flex items-center gap-2 text-[12px] text-[#9e9e9e] bg-[#202020] border border-[#323232] rounded-lg px-4 py-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 text-[#616161]" />
          Dados de exemplo. Na utilização real, serão preenchidos com as informações da locação.
        </div>
      )}

      {/* Documento — flex-1 min-h-0, scroll interno */}
      <div className="flex-1 min-h-0 rounded-xl border border-[#323232] overflow-hidden">
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
