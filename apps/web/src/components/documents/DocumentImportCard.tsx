'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, RotateCcw, X, AlertCircle, Loader2, type LucideIcon } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

const DEFAULT_PROCESSING_MESSAGES = ['Lendo o documento…']

export type DocumentImportCardStatus = 'idle' | 'loading' | 'success' | 'error'

interface DocumentImportCardProps {
  /** Ícone do card e da modal de processamento. */
  icon: LucideIcon
  /** Selo curto opcional ao lado do título, ex.: "IA". Omitido = sem selo. */
  badge?: string
  /** Título curto, ex.: "Preencher com IA" ou "Importar CRLV". */
  title: string
  /** Hint sobre o que o card faz. */
  description: string
  accept: string
  status: DocumentImportCardStatus
  /** Texto de erro (status='error') ou resumo de sucesso (status='success'). */
  message?: string
  /** Nome do arquivo pendente/já processado, pra preview. */
  fileName?: string | null
  /** Documento já salvo em modo edição, antes de qualquer nova importação nesta sessão. */
  existingUrl?: string | null
  processingMessages?: string[]
  onSelect: (file: File) => void
  onRetry?: () => void
  onDismissError?: () => void
  onClear?: () => void
}

/**
 * Card de importação de documento — entry point único no topo do formulário
 * (ou da seção), com modal de processamento próprio. Puramente apresentacional:
 * todo o estado (arquivo pendente, resultado, retry) é controlado pelo
 * formulário pai — este componente não sabe se a extração é via IA (CNH,
 * notificação de multa) ou parsing determinístico local (CRLV).
 */
export function DocumentImportCard({
  icon: Icon, badge, title, description, accept, status, message, fileName, existingUrl,
  processingMessages = DEFAULT_PROCESSING_MESSAGES,
  onSelect, onRetry, onDismissError, onClear,
}: DocumentImportCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (status !== 'loading') { setMessageIndex(0); return }
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % processingMessages.length)
    }, 1700)
    return () => clearInterval(interval)
  }, [status, processingMessages.length])

  const hasFile = !!fileName || !!existingUrl

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-surface p-6">
      <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary-contrast" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-bold text-fg">{title}</h2>
            {badge && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-tint text-primary text-[10px] font-bold uppercase tracking-wide">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[13px] text-fg-mute mt-1">{description}</p>

          <div className="mt-4">
            {status !== 'error' && hasFile && (
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-primary-tint">
                {status === 'loading' ? (
                  <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-fg truncate">{fileName ?? 'Documento anexado'}</p>
                  {status === 'success' && message && <p className="text-[12px] text-primary font-medium">{message}</p>}
                </div>
                <button
                  type="button"
                  disabled={status === 'loading'}
                  onClick={() => inputRef.current?.click()}
                  className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-fg-mute hover:text-fg transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Trocar
                </button>
                {onClear && (
                  <button
                    type="button"
                    disabled={status === 'loading'}
                    onClick={onClear}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-fg-mute hover:text-danger hover:bg-danger-bg transition-colors disabled:opacity-50"
                    title="Remover"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {status === 'error' && (
              <div className="flex items-start gap-2 px-3.5 py-3 bg-danger-bg border border-danger rounded-xl">
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-danger">{message}</p>
                  <div className="mt-1.5 flex gap-4">
                    <button
                      type="button"
                      className="text-[12px] font-medium text-danger underline"
                      onClick={() => (onRetry ? onRetry() : inputRef.current?.click())}
                    >
                      Tentar novamente
                    </button>
                    <button
                      type="button"
                      className="text-[12px] font-medium text-fg-mute underline"
                      onClick={onDismissError}
                    >
                      Preencher manualmente
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(status === 'idle' || status === 'loading') && !hasFile && (
              <button
                type="button"
                disabled={status === 'loading'}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center h-9 px-4 rounded-full bg-primary text-primary-contrast text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
              >
                {status === 'loading' ? 'Processando…' : 'Selecionar arquivo'}
              </button>
            )}

            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={accept}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f) }}
            />
          </div>
        </div>
      </div>

      <Modal open={status === 'loading'} onClose={() => {}} size="sm">
        <div className="flex flex-col items-center text-center py-4">
          <div className="relative w-16 h-16 mb-5">
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-lg shadow-primary/30">
              <Icon className="w-7 h-7 text-primary-contrast animate-ai-pulse" />
            </div>
          </div>

          <h3 className="text-[15px] font-bold text-fg">{processingMessages[messageIndex]}</h3>
          <p className="text-[12px] text-fg-mute mt-1.5">Só alguns segundos…</p>

          <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden mt-5">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer" />
          </div>
        </div>
      </Modal>
    </section>
  )
}
