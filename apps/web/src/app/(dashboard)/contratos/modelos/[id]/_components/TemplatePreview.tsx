'use client'

import { useCallback, useState } from 'react'
import { generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import { Printer, Eye, Variable, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ContractTemplate } from '@gomoto/core'
import { buildSampleData, substituteVariables } from '../../_components/variables'
import { ContractDocument, ContractPage, wrapContentInPage } from '../../_components/contractPageExtension'

// Mesmo conjunto de extensões do editor — necessário para serializar page nodes corretamente
const EXTENSIONS = [
  StarterKit.configure({ document: false }),
  ContractDocument,
  ContractPage,
  Underline,
  TextStyle,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]

interface Props {
  template: ContractTemplate
}

type ViewMode = 'template' | 'preview'

export function TemplatePreview({ template }: Props) {
  const [mode, setMode] = useState<ViewMode>('template')
  const [printing, setPrinting] = useState(false)

  const normalizedContent = wrapContentInPage(template.content as Record<string, unknown> | null)
  const html = normalizedContent
    ? generateHTML(normalizedContent as Parameters<typeof generateHTML>[0], EXTENSIONS)
    : null

  const previewHtml = html ? substituteVariables(html, buildSampleData()) : null

  const handlePrint = useCallback(async () => {
    if (!previewHtml) return
    setPrinting(true)
    try {
      const iframe = document.createElement('iframe')
      Object.assign(iframe.style, {
        position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0',
      })
      document.body.appendChild(iframe)

      const doc = iframe.contentDocument
      if (!doc) throw new Error('Falha ao preparar impressão')

      doc.open()
      doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${template.name}</title>
        <style>
          @page { size: A4; margin: 2cm 2.5cm; }
          body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.7; color: #1a1a1a; }
          /* page nodes: reset visual — o @page cuida das margens na impressão */
          [data-type="page"] { margin: 0; padding: 0; min-height: unset; background: none; }
          h1 { font-size: 16pt; font-weight: 700; margin: 1em 0 0.5em; }
          h2 { font-size: 13pt; font-weight: 700; margin: 1em 0 0.5em; }
          h3 { font-size: 11pt; font-weight: 600; margin: 1em 0 0.4em; }
          p  { margin: 0 0 0.75em; }
          ul { list-style: disc;    padding-left: 1.5em; margin: 0.5em 0; }
          ol { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
          [style*="text-align: center"]  { text-align: center; }
          [style*="text-align: right"]   { text-align: right; }
          [style*="text-align: justify"] { text-align: justify; }
        </style>
      </head><body>${previewHtml}</body></html>`)
      doc.close()

      const win = iframe.contentWindow
      if (!win) throw new Error('Janela de impressão não encontrada')

      const cleanup = () => {
        try { document.body.removeChild(iframe) } catch { /* já removido */ }
      }
      win.addEventListener('afterprint', cleanup, { once: true })
      setTimeout(cleanup, 60_000)
      await new Promise(r => setTimeout(r, 200))
      win.focus()
      win.print()
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
