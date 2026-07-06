'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Bike, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { useMaintenanceRecordsByStatus } from '@gomoto/data'
import {
  DASHBOARD_NAV, DASHBOARD_NAV_BOTTOM,
  type NavLeaf, type NavBranch,
} from './sidebar-config'

// Largura da sidebar colapsada — usada para posicionar fly-outs e tooltips
const COLLAPSED_WIDTH = 64

// ─── LeafItem ────────────────────────────────────────────────────────────────

function LeafItem({
  item,
  expanded,
  isActive,
  badgeCount,
  indent = false,
}: {
  item: NavLeaf
  expanded: boolean
  isActive: (href: string) => boolean
  badgeCount: number
  indent?: boolean
}) {
  const active = isActive(item.href)
  const Icon = item.icon

  const triggerRef = useRef<HTMLDivElement>(null)
  const [tipVisible, setTipVisible] = useState(false)
  const [tipY, setTipY] = useState(0)

  function openTip() {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setTipY(r.top + r.height / 2)
    }
    setTipVisible(true)
  }

  return (
    <div
      ref={triggerRef}
      className="relative px-2"
      onMouseEnter={() => { if (!expanded) openTip() }}
      onMouseLeave={() => setTipVisible(false)}
    >
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 h-9 rounded-lg text-[13px] transition-colors duration-150',
          indent && 'pl-4',
          active
            ? 'bg-[#BAFF1A] text-[#000000] font-medium'
            : 'text-[#c7c7c7] hover:bg-[#202020] hover:text-[#f5f5f5]',
        )}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {expanded && <span className="flex-1 truncate">{item.label}</span>}
        {expanded && badgeCount > 0 && (
          <span className={cn(
            'h-5 min-w-[20px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0',
            active ? 'bg-[#121212] text-[#BAFF1A]' : 'bg-[#bf1d1e] text-white',
          )}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </Link>

      {/* Red dot badge when collapsed */}
      {!expanded && badgeCount > 0 && (
        <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-[#bf1d1e] pointer-events-none" />
      )}

      {/* Tooltip via portal — escapa do overflow:hidden do nav */}
      {!expanded && tipVisible && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', top: tipY, left: COLLAPSED_WIDTH + 8, transform: 'translateY(-50%)' }}
          className="z-[100] px-2.5 py-1.5 bg-[#2a2a2a] border border-[#323232] rounded-lg shadow-xl text-[12px] text-[#f5f5f5] whitespace-nowrap pointer-events-none"
        >
          {item.label}
          {badgeCount > 0 && (
            <span className="ml-1.5 text-[#BAFF1A] font-bold">{badgeCount}</span>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── BranchItem ──────────────────────────────────────────────────────────────

function BranchItem({
  item,
  expanded,
  isActive,
  isOpen,
  onToggle,
  getBadgeCount,
}: {
  item: NavBranch
  expanded: boolean
  isActive: (href: string) => boolean
  isOpen: boolean
  onToggle: () => void
  getBadgeCount: (l: NavLeaf) => number
}) {
  const Icon = item.icon
  const anyChildActive = item.children.some(c => isActive(c.href))
  const totalBadge = item.children.reduce((acc, c) => acc + getBadgeCount(c), 0)

  const triggerRef = useRef<HTMLDivElement>(null)
  const [flyVisible, setFlyVisible] = useState(false)
  const [flyY, setFlyY] = useState(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openFly() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (triggerRef.current) {
      setFlyY(triggerRef.current.getBoundingClientRect().top)
    }
    setFlyVisible(true)
  }

  function closeFly() {
    closeTimer.current = setTimeout(() => setFlyVisible(false), 80)
  }

  function keepFly() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  // ── Collapsed: fly-out via portal ──
  if (!expanded) {
    return (
      <div
        ref={triggerRef}
        className="relative px-2"
        onMouseEnter={openFly}
        onMouseLeave={closeFly}
      >
        <button
          className={cn(
            'flex items-center justify-center w-full h-9 rounded-lg transition-colors duration-150',
            anyChildActive
              ? 'bg-[#202020] text-[#BAFF1A]'
              : 'text-[#c7c7c7] hover:bg-[#202020] hover:text-[#f5f5f5]',
          )}
        >
          <Icon className="w-4 h-4" />
          {totalBadge > 0 && (
            <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-[#bf1d1e]" />
          )}
        </button>

        {flyVisible && typeof document !== 'undefined' && createPortal(
          <div
            style={{ position: 'fixed', top: flyY, left: COLLAPSED_WIDTH + 8 }}
            className="z-[100] w-[200px] bg-[#1a1a1a] border border-[#323232] rounded-xl shadow-2xl py-1"
            onMouseEnter={keepFly}
            onMouseLeave={closeFly}
          >
            <div className="px-3 py-2 border-b border-[#2a2a2a]">
              <span className="text-[11px] font-semibold text-[#9e9e9e] uppercase tracking-wider">
                {item.label}
              </span>
            </div>
            {item.children.map(child => {
              const childActive = isActive(child.href)
              const ChildIcon = child.icon
              const badge = getBadgeCount(child)
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={() => setFlyVisible(false)}
                  className={cn(
                    'flex items-center gap-3 mx-1 px-3 h-9 rounded-lg text-[13px] transition-colors',
                    childActive
                      ? 'bg-[#BAFF1A] text-[#000000] font-medium'
                      : 'text-[#c7c7c7] hover:bg-[#323232] hover:text-[#f5f5f5]',
                  )}
                >
                  <ChildIcon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 truncate">{child.label}</span>
                  {badge > 0 && (
                    <span className={cn(
                      'h-5 min-w-[20px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center',
                      childActive ? 'bg-[#121212] text-[#BAFF1A]' : 'bg-[#bf1d1e] text-white',
                    )}>
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>,
          document.body,
        )}
      </div>
    )
  }

  // ── Expanded: accordion ──
  return (
    <div className="px-2">
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-3 px-3 h-9 w-full rounded-lg text-[13px] transition-colors duration-150',
          anyChildActive
            ? 'text-[#BAFF1A]'
            : 'text-[#c7c7c7] hover:bg-[#202020] hover:text-[#f5f5f5]',
        )}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        {totalBadge > 0 && !isOpen && (
          <span className="h-5 min-w-[20px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center bg-[#bf1d1e] text-white flex-shrink-0">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
        <ChevronDown className={cn(
          'w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200',
          isOpen && 'rotate-180',
        )} />
      </button>

      {isOpen && (
        <div className="mt-0.5 ml-4 border-l border-[#2a2a2a] pl-1.5 space-y-0.5 pb-1">
          {item.children.map(child => (
            <LeafItem
              key={child.href}
              item={child}
              expanded
              isActive={isActive}
              badgeCount={getBadgeCount(child)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { expanded, toggle } = useSidebar()
  const pathname = usePathname()
  const [openBranches, setOpenBranches] = useState<Set<string>>(() => new Set())

  const pendingQuery = useMaintenanceRecordsByStatus('pending')
  const pendingCount = pendingQuery.data?.length ?? 0

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  const isBranchActive = (branch: NavBranch) =>
    branch.children.some(c => isActive(c.href))

  const isBranchOpen = (branch: NavBranch) =>
    openBranches.has(branch.label) || isBranchActive(branch)

  const toggleBranch = (label: string) =>
    setOpenBranches(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })

  const getBadgeCount = (leaf: NavLeaf) =>
    leaf.badge === 'pending-maintenance' ? pendingCount : 0

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-[#121212] border-r border-[#323232]',
        'transition-[width] duration-300 ease-in-out',
        expanded ? 'w-[256px]' : 'w-[64px]',
      )}
    >
      {/* Logo + toggle */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-[#323232] shrink-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-lg outline-none overflow-hidden min-w-0"
        >
          <div className="w-6 h-6 flex-shrink-0 bg-[#BAFF1A] rounded-full flex items-center justify-center">
            <Bike className="w-3.5 h-3.5 text-[#121212]" />
          </div>
          {expanded && (
            <span className="text-[#f5f5f5] text-[14px] font-bold whitespace-nowrap">GoMoto</span>
          )}
        </Link>
        <button
          onClick={toggle}
          className="p-1.5 rounded-lg text-[#9e9e9e] hover:text-[#f5f5f5] hover:bg-[#323232] transition-colors flex-shrink-0"
          title={expanded ? 'Recolher menu' : 'Expandir menu'}
        >
          {expanded
            ? <PanelLeftClose className="w-3.5 h-3.5" />
            : <PanelLeftOpen  className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {DASHBOARD_NAV.map((section, si) => (
          <div key={si} className={cn(si > 0 && 'mt-3')}>
            {section.label && (
              <div className="mb-1 px-4">
                {expanded ? (
                  <span className="text-[10px] font-semibold text-[#474747] uppercase tracking-widest">
                    {section.label}
                  </span>
                ) : (
                  <div className="h-px bg-[#2a2a2a]" />
                )}
              </div>
            )}

            <div className="space-y-0.5">
              {section.items.map(item =>
                item.kind === 'leaf' ? (
                  <LeafItem
                    key={item.href}
                    item={item}
                    expanded={expanded}
                    isActive={isActive}
                    badgeCount={getBadgeCount(item)}
                  />
                ) : (
                  <BranchItem
                    key={item.label}
                    item={item}
                    expanded={expanded}
                    isActive={isActive}
                    isOpen={isBranchOpen(item)}
                    onToggle={() => toggleBranch(item.label)}
                    getBadgeCount={getBadgeCount}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: Configurações */}
      <div className="border-t border-[#323232] py-2">
        {DASHBOARD_NAV_BOTTOM.map(item => (
          <LeafItem
            key={item.href}
            item={item}
            expanded={expanded}
            isActive={isActive}
            badgeCount={0}
          />
        ))}
      </div>
    </aside>
  )
}
