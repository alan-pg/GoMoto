import { type ReactNode } from 'react'

interface PageTitleProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

/**
 * Cabeçalho padrão de página — sticky abaixo da Topbar (top-10).
 * Renderiza o h1 da tela, subtítulo opcional e slot de ações à direita.
 * Deve ser o primeiro filho do conteúdo da rota, não do layout.
 */
export function PageTitle({ title, subtitle, actions }: PageTitleProps) {
  return (
    <div className="sticky top-0 z-10 bg-bg border-b border-border px-6 flex items-center justify-between shrink-0 h-[60px]">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold text-fg leading-none truncate">{title}</h1>
        {subtitle && (
          <p className="text-[12px] text-fg-mute mt-1 leading-none truncate">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 ml-4 shrink-0">{actions}</div>
      )}
    </div>
  )
}
