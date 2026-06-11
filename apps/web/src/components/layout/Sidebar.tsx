'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Bike, Users, FileText, DollarSign,
  TrendingUp, TrendingDown, AlertTriangle, Wrench,
  Clock, BarChart2, HelpCircle, Settings, LogOut, MoreVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard',     label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/fila',          label: 'Fila de Locadores', icon: Clock },
  { href: '/manutencao',    label: 'Manutenção',        icon: Wrench },
  { href: '/multas',        label: 'Multas',            icon: AlertTriangle },
  { href: '/despesas',      label: 'Despesas',          icon: TrendingDown },
  { href: '/entradas',      label: 'Entradas',          icon: TrendingUp },
  { href: '/cobrancas',     label: 'Cobranças',         icon: DollarSign },
  { href: '/motos',         label: 'Motos',             icon: Bike },
  { href: '/clientes',      label: 'Clientes',          icon: Users },
  { href: '/contratos',     label: 'Contratos',         icon: FileText },
  { href: '/relatorios',    label: 'Relatórios',        icon: BarChart2 },
  { href: '/processos',     label: 'Processos',         icon: HelpCircle },
  { href: '/configuracoes', label: 'Configurações',     icon: Settings },
]

/**
 * CSS Grid trick para animar o label de largura 0 → auto no hover da sidebar.
 * O span externo usa grid-template-columns: 0fr (colapsado) → 1fr (expandido).
 * O opacity + translate-x adicionam o efeito de slide suave.
 * O span interno com whitespace-nowrap impede quebra de linha durante a transição.
 */
const LABEL_CX =
  'inline-grid [grid-template-columns:0fr] group-hover:[grid-template-columns:1fr] ' +
  'transition-[grid-template-columns,opacity,transform] duration-300 ease-in-out ' +
  'opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 overflow-hidden'

export function Sidebar() {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    // Sidebar fixa com expansão hover-only via classe `group`.
    // Colapsada: 85px (apenas ícones). Expandida: 280px (ícones + labels).
    <aside className="group fixed inset-y-0 left-0 z-50 flex flex-col h-screen w-[85px] hover:w-[280px] bg-[#121212] border-r border-[#323232] overflow-hidden transition-all duration-300 ease-in-out">

      {/* Logo */}
      <div className="pt-6 px-5 pb-2 flex items-center w-[85px] group-hover:w-full overflow-hidden transition-all duration-300 ease-in-out">
        <Link href="/dashboard" className="flex items-center gap-3 outline-none rounded-full">
          <div className="w-10 h-10 flex-shrink-0 bg-[#BAFF1A] rounded-full flex items-center justify-center">
            <Bike className="w-6 h-6 text-[#121212]" />
          </div>
          <span className={LABEL_CX}>
            <span className="whitespace-nowrap overflow-hidden text-[#f5f5f5] text-[16px] font-bold">GoMoto</span>
          </span>
        </Link>
      </div>

      {/* Navegação */}
      <nav className="flex flex-1 flex-col min-h-0 overflow-hidden group-hover:overflow-y-auto pb-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <div key={href} className="px-4 mb-1">
            <Link
              href={href}
              className={cn(
                'flex items-center gap-2 px-4 h-10 w-full rounded-full text-[14px] transition-all duration-300',
                isActive(href)
                  ? 'bg-[#BAFF1A] text-[#000000] font-medium'
                  : 'text-[#c7c7c7] font-normal hover:bg-[#323232] hover:text-[#f5f5f5]'
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className={LABEL_CX}>
                <span className="whitespace-nowrap overflow-hidden">{label}</span>
              </span>
            </Link>
          </div>
        ))}
      </nav>

      {/* Footer: usuário + logout */}
      <div className="border-t border-[#323232] p-3 space-y-1">
        <button className="flex items-center w-full h-10 px-4 gap-2 rounded-full hover:bg-[#323232] transition-all duration-300">
          <div className="w-6 h-6 rounded-full bg-[#323232] border border-[#474747] flex-shrink-0 flex items-center justify-center">
            <span className="text-[#f5f5f5] text-[11px] font-bold">G</span>
          </div>
          <span className={cn(LABEL_CX, 'flex-1')}>
            <span className="whitespace-nowrap overflow-hidden flex flex-col text-left">
              <span className="text-[13px] font-medium text-[#f5f5f5] leading-none">GoMoto</span>
              <span className="text-[11px] text-[#9e9e9e] mt-0.5">Admin</span>
            </span>
          </span>
          <MoreVertical className="w-4 h-4 text-[#9e9e9e] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </button>

        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="flex items-center gap-2 px-4 h-10 w-full text-[#c7c7c7] rounded-full text-[14px] font-normal hover:bg-[#7c1c1c] hover:text-[#ff9c9a] transition-all duration-300"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className={LABEL_CX}>
              <span className="whitespace-nowrap overflow-hidden">Sair</span>
            </span>
          </button>
        </form>
      </div>
    </aside>
  )
}
