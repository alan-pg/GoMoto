import {
  LayoutDashboard, Bike, Users, FileText, DollarSign,
  TrendingUp, TrendingDown, AlertTriangle, Wrench,
  Clock, BarChart2, HelpCircle, Settings,
  ClipboardCheck, ClipboardList, ScrollText,
  type LucideIcon,
} from 'lucide-react'

export interface NavLeaf {
  kind: 'leaf'
  href: string
  label: string
  icon: LucideIcon
  badge?: 'pending-maintenance'
}

export interface NavBranch {
  kind: 'branch'
  label: string
  icon: LucideIcon
  children: NavLeaf[]
}

export type NavItem = NavLeaf | NavBranch

export interface NavSection {
  label?: string
  items: NavItem[]
}

export const DASHBOARD_NAV: NavSection[] = [
  {
    items: [
      { kind: 'leaf', href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Operações',
    items: [
      { kind: 'leaf', href: '/locacoes',  label: 'Locações',  icon: Clock },
      {
        kind: 'branch',
        label: 'Contratos',
        icon: FileText,
        children: [
          { kind: 'leaf', href: '/contratos',         label: 'Contratos',        icon: FileText },
          { kind: 'leaf', href: '/contratos/modelos', label: 'Modelos',          icon: ScrollText },
        ],
      },
      { kind: 'leaf', href: '/clientes',  label: 'Clientes',  icon: Users },
    ],
  },
  {
    label: 'Frota',
    items: [
      { kind: 'leaf', href: '/veiculos', label: 'Veículos', icon: Bike },
      {
        kind: 'branch',
        label: 'Manutenção',
        icon: Wrench,
        children: [
          { kind: 'leaf', href: '/manutencao',        label: 'Registros',  icon: Wrench },
          { kind: 'leaf', href: '/aprovacoes',        label: 'Aprovações', icon: ClipboardCheck, badge: 'pending-maintenance' },
          { kind: 'leaf', href: '/planos-manutencao', label: 'Planos',     icon: ClipboardList },
        ],
      },
      { kind: 'leaf', href: '/multas', label: 'Multas', icon: AlertTriangle },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { kind: 'leaf', href: '/despesas',  label: 'Despesas',  icon: TrendingDown },
      { kind: 'leaf', href: '/entradas',  label: 'Entradas',  icon: TrendingUp },
      { kind: 'leaf', href: '/cobrancas', label: 'Cobranças', icon: DollarSign },
    ],
  },
  {
    label: 'Análises',
    items: [
      { kind: 'leaf', href: '/relatorios', label: 'Relatórios', icon: BarChart2 },
      { kind: 'leaf', href: '/processos',  label: 'Processos',  icon: HelpCircle },
    ],
  },
]

export const DASHBOARD_NAV_BOTTOM: NavLeaf[] = [
  { kind: 'leaf', href: '/configuracoes', label: 'Configurações', icon: Settings },
]
