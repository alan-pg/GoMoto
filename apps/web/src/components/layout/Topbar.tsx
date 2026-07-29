'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ChevronRight, LogOut } from 'lucide-react'
import { Fragment, useState } from 'react'

const SEGMENT_LABELS: Record<string, string> = {
  dashboard:           'Dashboard',
  locacoes:            'Locações',
  contratos:           'Contratos',
  manutencao:          'Manutenção',
  aprovacoes:          'Aprovações',
  'planos-manutencao': 'Planos de Manutenção',
  multas:              'Multas',
  despesas:            'Despesas',
  cobrancas:           'Cobranças',
  veiculos:            'Veículos',
  clientes:            'Clientes',
  relatorios:          'Relatórios',
  processos:           'Processos',
  configuracoes:       'Configurações',
  novo:                'Novo',
  editar:              'Editar',
  admin:               'Admin',
  empresas:            'Empresas',
  'platform-admins':   'Administradores',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function useBreadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: { label: string; href: string }[] = []
  let accHref = ''
  for (const seg of segments) {
    accHref += `/${seg}`
    // Skip raw UUIDs — the page's own title identifies the entity
    if (UUID_RE.test(seg)) continue
    crumbs.push({ label: SEGMENT_LABELS[seg] ?? seg, href: accHref })
  }
  return crumbs
}

interface TopbarProps {
  userName?: string
  userEmail?: string
}

export function Topbar({ userName, userEmail }: TopbarProps) {
  const breadcrumbs = useBreadcrumbs()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="shrink-0 z-20 h-10 flex items-center justify-between px-5 bg-[#121212] border-b border-[#2a2a2a]">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-0.5 text-[12px]" aria-label="Navegação">
        {breadcrumbs.map((crumb, i) => (
          <Fragment key={crumb.href}>
            {i > 0 && (
              <ChevronRight className="w-3 h-3 text-[#3a3a3a] flex-shrink-0 mx-0.5" />
            )}
            {i < breadcrumbs.length - 1 ? (
              <Link
                href={crumb.href}
                className="text-[#666] hover:text-[#c7c7c7] transition-colors px-1.5 py-0.5 rounded"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-[#c7c7c7] font-medium px-1.5">{crumb.label}</span>
            )}
          </Fragment>
        ))}
      </nav>

      {/* Global controls */}
      <div className="flex items-center gap-1">
        <button
          className="p-1.5 rounded-full text-[#555] hover:text-[#c7c7c7] hover:bg-[#232323] transition-colors"
          aria-label="Notificações"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-7 h-7 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] hover:border-[#BAFF1A] transition-colors flex items-center justify-center ml-1"
            aria-label="Menu do usuário"
          >
            <span className="text-[#c7c7c7] text-[11px] font-bold select-none">
              {userName ? userName[0].toUpperCase() : '?'}
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-40 w-[220px] bg-[#1a1a1a] border border-[#323232] rounded-xl shadow-2xl py-1">
                <div className="px-4 py-3 border-b border-[#2a2a2a]">
                  <p className="text-[13px] font-medium text-[#f5f5f5] truncate">
                    {userName ?? userEmail ?? '—'}
                  </p>
                  <p className="text-[11px] text-[#9e9e9e] mt-0.5 truncate">{userEmail ?? ''}</p>
                </div>
                <div className="p-1">
                  <form action="/auth/logout" method="post">
                    <button
                      type="submit"
                      className="flex items-center gap-2 w-full px-3 h-9 rounded-lg text-[13px] text-[#c7c7c7] hover:bg-[#7c1c1c] hover:text-[#ff9c9a] transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Sair
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
